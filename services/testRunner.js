const newman = require('newman');
const fs = require('fs');
const path = require('path');
const { Collection, TestRun, TestResult, ApiSpec } = require('../models');

/**
 * Generate a random ID
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Merge multiple Postman collections into one
 * @param {Array<object>} collections - Array of Postman collection objects
 * @param {string} name - Name for merged collection
 * @returns {object} Merged Postman collection
 */
function mergeCollections(collections, name = 'Merged Collection') {
  if (collections.length === 0) {
    throw new Error('No collections to merge');
  }

  if (collections.length === 1) {
    return collections[0];
  }

  const merged = {
    info: {
      name: name,
      description: `Merged collection from ${collections.length} sources`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: []
  };

  // Merge items from all collections
  collections.forEach((collection, index) => {
    if (collection.item && Array.isArray(collection.item)) {
      collection.item.forEach(item => {
        // Add collection name prefix to avoid conflicts
        const prefixedItem = {
          ...item,
          name: item.name ? `${collection.info?.name || `Collection ${index + 1}`} - ${item.name}` : item.name
        };
        merged.item.push(prefixedItem);
      });
    }
  });

  // Merge auth if present
  if (collections[0].auth) {
    merged.auth = collections[0].auth;
  }

  // Merge variables if present (handle conflicts by keeping first occurrence)
  if (collections.some(c => c.variable)) {
    merged.variable = [];
    const seenVariables = new Set();
    
    collections.forEach(collection => {
      if (collection.variable && Array.isArray(collection.variable)) {
        collection.variable.forEach(variable => {
          // Only add if we haven't seen this variable key before
          if (!seenVariables.has(variable.key)) {
            merged.variable.push({ ...variable });
            seenVariables.add(variable.key);
          }
        });
      }
    });
  }

  return merged;
}

/**
 * Run Postman collection tests using Newman
 * @param {object} collection - Postman collection object
 * @param {object} options - Test execution options
 * @returns {Promise<object>} Test execution results
 */
function runNewmanTests(collection, options = {}) {
  return new Promise((resolve, reject) => {
    const results = {
      run: {
        executions: [],
        stats: {
          requests: { total: 0, pending: 0, failed: 0 },
          assertions: { total: 0, failed: 0 }
        }
      }
    };

    // Create temporary collection file
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Clean up old temp files (older than 1 hour)
    try {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 3600000) { // 1 hour
          fs.unlinkSync(filePath);
        }
      });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    const tempFile = path.join(tempDir, `collection-${generateId()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify(collection, null, 2));

    // Disable SSL certificate verification for this process
    // This is needed when APIs use certificates that don't match hostnames
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Newman supports both collection variables and environment files
    // Collection variables are automatically used from the collection JSON
    // Environment variables can be passed via options.environment or options.envVar
    const newmanOptions = {
      collection: tempFile,
      reporters: ['cli'],
      timeout: options.timeout || 60000, // Increased to 60 seconds
      timeoutRequest: options.timeoutRequest || 30000, // Increased to 30 seconds
      insecure: true, // Allow self-signed certificates
      ...options.newmanOptions
    };
    
    // If environment file is provided, use it
    if (options.environment) {
      newmanOptions.environment = options.environment;
    } else if (options.envVars && typeof options.envVars === 'object' && Object.keys(options.envVars).length > 0) {
      // Create a temporary Postman environment file from envVars
      const envId = generateId();
      const envObject = {
        id: envId,
        name: `Test Environment ${Date.now()}`,
        values: Object.entries(options.envVars).map(([key, value]) => ({
          key: key,
          value: String(value),
          type: 'string',
          enabled: true
        })),
        _postman_variable_scope: 'environment',
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: 'QA Testing Tool'
      };
      
      const envFile = path.join(tempDir, `environment-${envId}.json`);
      fs.writeFileSync(envFile, JSON.stringify(envObject, null, 2));
      newmanOptions.environment = envFile;
      
      // Clean up environment file after execution
      setTimeout(() => {
        try {
          if (fs.existsSync(envFile)) {
            fs.unlinkSync(envFile);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }, 5000);
    }

    newman.run(newmanOptions, (err, summary) => {
      // Restore original SSL verification setting
      if (originalRejectUnauthorized !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }

      if (err) {
        console.error('Newman execution error:', err);
        return reject(new Error(`Test execution failed: ${err.message || err}`));
      }

      // Check if summary exists
      if (!summary || !summary.run) {
        return reject(new Error('Invalid test execution result: no summary returned'));
      }

      // Parse Newman summary
      const parsedResults = {
        summary: {
          run: {
            stats: summary.run.stats,
            timings: summary.run.timings,
            failures: summary.run.failures || []
          },
          collection: summary.collection
        },
        executions: []
      };

      // Extract execution details
      if (summary.run && summary.run.executions) {
        summary.run.executions.forEach(execution => {
          const request = execution.request || {};
          const response = execution.response || {};
          
          // Handle URL extraction more robustly
          let url = '';
          if (request.url) {
            if (typeof request.url === 'string') {
              url = request.url;
            } else if (request.url.raw) {
              url = request.url.raw;
            } else if (request.url.toString) {
              url = request.url.toString();
            } else {
              // Try to reconstruct from host and path
              const host = request.url.host ? (Array.isArray(request.url.host) ? request.url.host.join('.') : request.url.host) : '';
              const path = request.url.path ? (Array.isArray(request.url.path) ? '/' + request.url.path.join('/') : request.url.path) : '';
              url = (host ? (request.url.protocol || 'http') + '://' + host : '') + path;
            }
          }
          
          // Extract response body more robustly
          let responseBody = '';
          if (response) {
            if (response.body) {
              responseBody = typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2);
            } else if (response.stream) {
              responseBody = Buffer.isBuffer(response.stream) ? response.stream.toString('utf8') : String(response.stream);
            } else if (response.text) {
              responseBody = response.text;
            }
          }
          
          // Check for failed assertions from test scripts
          let hasFailedAssertions = false;
          let errorMessage = null;
          if (execution.assertions && execution.assertions.length > 0) {
            const failedAssertions = execution.assertions.filter(a => a.error);
            if (failedAssertions.length > 0) {
              hasFailedAssertions = true;
              errorMessage = failedAssertions.map(a => a.error?.message || a.error).join('; ');
            }
          }
          
          // If no response but there's an error, capture it
          if (!response && execution.error) {
            errorMessage = execution.error.message || execution.error.toString();
          }
          
          // Determine status - consider connection errors AND assertion failures
          let status = 'failed';
          if (response) {
            const responseCode = response.code || 0;
            // Test fails if: HTTP error (4xx/5xx) OR any assertion failed
            if (hasFailedAssertions) {
              status = 'failed';
              // Error message already set from failed assertions above
            } else if (responseCode >= 200 && responseCode < 300) {
              status = 'passed';
            } else {
              status = 'failed';
              if (!errorMessage) {
                errorMessage = `HTTP ${responseCode}: ${response.status || 'Request failed'}`;
              }
            }
          } else if (execution.error) {
            status = 'failed';
            errorMessage = execution.error.message || 'Connection failed';
          } else if (hasFailedAssertions) {
            // Even if we got a response, failed assertions mean test failed
            status = 'failed';
          }
          
          const executionData = {
            item: {
              name: execution.item?.name || 'Unknown',
              request: {
                method: request.method || '',
                url: url,
                headers: request.headers || [],
                body: request.body ? (typeof request.body === 'string' ? request.body : JSON.stringify(request.body, null, 2)) : ''
              },
              response: response ? {
                code: response.code || 0,
                status: response.status || '',
                body: responseBody
              } : null,
              assertions: execution.assertions || [],
              error: execution.error ? {
                message: execution.error.message || execution.error.toString(),
                name: execution.error.name
              } : null
            },
            assertions: execution.assertions || [],
            status: status,
            errorMessage: errorMessage
          };

          parsedResults.executions.push(executionData);
        });
      }

      resolve(parsedResults);
    });
  });
}

/**
 * Get item from collection using nested path (array of indices)
 * @param {object} collection - Postman collection object
 * @param {Array<number>} path - Array of indices representing nested path (e.g., [0, 1, 2])
 * @returns {object|null} The item at the path, or null if not found
 */
function getItemByPath(collection, path) {
  if (!path || path.length === 0) return null;
  
  let current = collection.item;
  if (!current || !Array.isArray(current)) return null;
  
  for (let i = 0; i < path.length; i++) {
    const index = path[i];
    if (index < 0 || index >= current.length) return null;
    
    if (i === path.length - 1) {
      // Last index - return the item
      return current[index];
    } else {
      // Navigate deeper
      const item = current[index];
      if (item.item && Array.isArray(item.item)) {
        current = item.item;
      } else {
        return null; // Path doesn't exist
      }
    }
  }
  
  return null;
}

/**
 * Filter collection items based on selected paths (nested indices)
 * Creates a flat list of selected items in the order specified
 * @param {object} collection - Postman collection object
 * @param {Array<Array<number>>} selectedPaths - Array of path arrays in execution order (e.g., [[0, 1], [0, 2]])
 * @returns {object} Filtered collection with only selected items in specified order
 */
function filterCollectionItems(collection, selectedPaths) {
  if (!selectedPaths || selectedPaths.length === 0) {
    return collection; // Return all items if no filter specified
  }

  const filtered = {
    ...collection,
    item: []
  };

  // Extract selected items in the order they were selected
  selectedPaths.forEach(path => {
    const item = getItemByPath(collection, path);
    if (item) {
      // Deep clone the item to avoid modifying the original
      const clonedItem = JSON.parse(JSON.stringify(item));
      filtered.item.push(clonedItem);
    }
  });

  return filtered;
}

/**
 * Execute tests for selected collections and save results
 * @param {number} projectId - Project ID
 * @param {string} testRunName - Name for the test run
 * @param {object} options - Test execution options (environment, envVars, selectedTests, collectionIds)
 * @returns {Promise<object>} Test run results
 */
async function executeTests(projectId, testRunName, options = {}) {
  try {
    let collectionIds;
    let selectedTests = null;

    // Determine which collections to fetch
    if (options.selectedTests) {
      // New format: selectedTests is an object mapping collectionId -> [itemIndices]
      collectionIds = Object.keys(options.selectedTests).map(id => parseInt(id));
      selectedTests = options.selectedTests;
    } else if (options.collectionIds) {
      // Legacy format: run all items in specified collections
      collectionIds = options.collectionIds;
    } else {
      throw new Error('Either selectedTests or collectionIds must be provided in options');
    }

    // Fetch collections from database
    const collections = await Collection.findAll({
      where: { id: collectionIds },
      include: [{
        model: ApiSpec,
        as: 'apiSpec',
        attributes: ['id', 'name']
      }]
    });

    if (collections.length === 0) {
      throw new Error('No collections found');
    }

    // Filter and get collection JSONs
    const collectionObjects = collections.map(c => {
      const collectionJson = c.collection_json;
      
      // If selectedTests is provided, filter items for this collection
      if (selectedTests && selectedTests[c.id]) {
        return filterCollectionItems(collectionJson, selectedTests[c.id]);
      }
      
      // Otherwise return the full collection
      return collectionJson;
    });

    // Merge collections if multiple
    const mergedCollection = mergeCollections(collectionObjects, testRunName);

    // Run tests with options (environment variables, etc.)
    const newmanResults = await runNewmanTests(mergedCollection, options);

    // Create test run record with placeholder values (will be updated after counting results)
    const testRun = await TestRun.create({
      name: testRunName,
      status: 'running', // Temporary status
      project_id: projectId,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });

    // Create test result records and determine their status
    const testResults = [];
    for (const execution of newmanResults.executions) {
      // Try to find which collection this test belongs to
      let collection = null;
      let apiSpecId = null;
      
      for (const coll of collections) {
        const items = coll.collection_json?.item || [];
        const itemName = execution.item.name;
        if (items.some(i => itemName.includes(i.name) || i.name === itemName)) {
          collection = coll;
          apiSpecId = coll.api_spec_id;
          break;
        }
      }

      // Determine status from execution data
      // Priority: execution.status (from parsed results, which includes assertion checks) > response code > default to failed
      const responseCode = execution.item.response?.code || 0;
      let status = 'failed'; // Default to failed
      
      // Check for failed assertions from test scripts
      const hasFailedAssertions = execution.assertions && execution.assertions.some(a => a.error);
      
      // Use status from execution data if available (this is set in runNewmanTests and includes assertion checks)
      if (execution.status) {
        status = execution.status;
      } else if (hasFailedAssertions) {
        // If any assertion failed, test is failed regardless of HTTP status
        status = 'failed';
      } else if (execution.item.response) {
        // If we have a response and no failed assertions, check the status code
        status = (responseCode >= 200 && responseCode < 300) ? 'passed' : 'failed';
      } else if (execution.item.error) {
        // If there's an error but no response, it's failed
        status = 'failed';
      }
      
      // Get error message
      let errorMessage = execution.errorMessage || null;
      
      // If no error message but status is failed, provide default
      if (!errorMessage && status === 'failed') {
        if (hasFailedAssertions) {
          // Error message should already be set from failed assertions in runNewmanTests
          const failedAssertions = execution.assertions.filter(a => a.error);
          if (failedAssertions.length > 0) {
            errorMessage = failedAssertions.map(a => a.error?.message || a.error).join('; ');
          }
        }
        if (!errorMessage) {
          if (execution.item.error) {
            errorMessage = execution.item.error.message || 'Request failed';
          } else if (responseCode >= 400) {
            errorMessage = `HTTP ${responseCode}: ${execution.item.response?.status || 'Request failed'}`;
          } else if (responseCode === 0) {
            errorMessage = 'Connection failed or timeout';
          } else {
            errorMessage = 'Test failed';
          }
        }
      }

      const testResult = await TestResult.create({
        test_run_id: testRun.id,
        test_name: execution.item.name,
        endpoint: execution.item.request?.url || '',
        method: execution.item.request?.method || '',
        status: status,
        duration_ms: 0, // Newman doesn't provide per-request timing easily
        request_body: execution.item.request?.body || '',
        response_body: execution.item.response?.body || '',
        response_code: responseCode || null,
        assertions: execution.assertions || [],
        error_message: errorMessage,
        api_spec_id: apiSpecId
      });

      testResults.push(testResult);
    }

    // Calculate statistics from actual test results (not from Newman's summary)
    const totalTests = testResults.length;
    const passedTests = testResults.filter(tr => tr.status === 'passed').length;
    const failedTests = testResults.filter(tr => tr.status === 'failed').length;
    const duration = newmanResults.summary.run.timings?.completed - newmanResults.summary.run.timings?.started || 0;

    // Update test run record with correct counts
    await testRun.update({
      status: failedTests > 0 ? 'failed' : 'passed',
      total_tests: totalTests,
      passed_tests: passedTests,
      failed_tests: failedTests,
      duration_ms: duration
    });

    return {
      testRun,
      testResults,
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        duration: duration
      }
    };
  } catch (error) {
    throw new Error(`Test execution failed: ${error.message}`);
  }
}

module.exports = {
  mergeCollections,
  runNewmanTests,
  executeTests
};


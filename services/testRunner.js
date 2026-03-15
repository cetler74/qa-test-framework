const newman = require('newman');
const fs = require('fs');
const path = require('path');
const { Collection, TestRun, TestResult, ApiSpec, ProjectTest, ProjectTestStat } = require('../models');

// In-memory set of test run IDs that have been requested to cancel (API runs only).
// Runner checks this so it can stop after the current collection and mark run as cancelled.
const cancelledTestRunIds = new Set();

function isTestRunCancelled(id) {
  return id != null && cancelledTestRunIds.has(Number(id));
}

function requestCancelTestRun(id) {
  if (id != null) cancelledTestRunIds.add(Number(id));
}

function clearCancelTestRun(id) {
  if (id != null) cancelledTestRunIds.delete(Number(id));
}

/**
 * Remove duplicate leading protocol from a URL string (e.g. "https://https://api.example.com" -> "https://api.example.com").
 * Used for base URL and similar env vars so requests are not sent to malformed URLs.
 * @param {string} value - Raw string (env var value)
 * @returns {string} Normalized string
 */
function normalizeBaseUrl(value) {
  if (value == null || typeof value !== 'string') return value === undefined ? '' : String(value);
  const s = value.trim();
  // Fix double protocol: https://https://... or http://https://... etc.
  const doubleProtocol = /^(https?:\/\/)\s*(https?:\/\/)/i;
  if (doubleProtocol.test(s)) return s.replace(doubleProtocol, '$2');
  return s;
}

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
 * Format error messages from failed assertions into a readable format
 * @param {Array} failedAssertions - Array of assertion objects with error properties
 * @returns {string} Formatted error message
 */
function formatAssertionErrors(failedAssertions) {
  if (!failedAssertions || failedAssertions.length === 0) {
    return null;
  }

  // If only one assertion failed, return it directly (cleaned up)
  if (failedAssertions.length === 1) {
    const error = failedAssertions[0].error;
    const errorMsg = error?.message || String(error || 'Assertion failed');
    return errorMsg.trim();
  }

  // For multiple failures, format as a numbered list with better structure
  const errors = failedAssertions.map((assertion, index) => {
    const error = assertion.error;
    const errorMsg = error?.message || String(error || 'Assertion failed');
    let cleanedMsg = errorMsg.trim();
    
    // Clean up common patterns for better readability
    // Handle "expected X to deeply equal Y" -> "Expected X to equal Y"
    cleanedMsg = cleanedMsg.replace(/expected\s+/gi, 'Expected ');
    cleanedMsg = cleanedMsg.replace(/\s+to\s+deeply\s+equal\s+/gi, ' to equal ');
    cleanedMsg = cleanedMsg.replace(/\s+to\s+have\s+property\s+/gi, ' to have property ');
    
    return `${index + 1}. ${cleanedMsg}`;
  });

  return `Failed Assertions (${failedAssertions.length}):\n${errors.join('\n')}`;
}

/**
 * Build full error string from an error object (message + cause when present).
 * Ensures proxy/tunneling errors like "tunneling socket could not be established, cause=connect ETIMEDOUT ..." are captured fully.
 * @param {Error|object} err - Error object (may have .message, .cause)
 * @returns {string} Full error message for storage in test results and reports
 */
function getFullErrorMessage(err) {
  if (!err) return '';
  const msg = err.message || (err.toString && err.toString()) || String(err);
  const cause = err.cause;
  if (cause) {
    const causeStr = typeof cause === 'string' ? cause : (cause.message || (cause.toString && cause.toString()) || '');
    if (causeStr) return `${msg.trim()}${msg.includes('cause=') ? '' : `, cause=${causeStr}`}`;
  }
  return msg.trim();
}

/**
 * Normalize network/connection error messages for clear display in test results and reports.
 * Maps common Node/Newman error codes to readable "Network error: ..." or "Timeout: ..." text.
 * Preserves full message for proxy/tunneling errors so they appear verbatim in test results and reports.
 * @param {string} message - Raw error message (e.g. "connect ECONNREFUSED 127.0.0.1:8080" or "tunneling socket could not be established, cause=connect ETIMEDOUT 10.162.2.24:3128")
 * @returns {string} Human-readable message for results and reports
 */
function normalizeNetworkError(message) {
  if (!message || typeof message !== 'string') return 'No HTTP response';
  const m = message.trim();
  // Preserve full proxy/tunneling errors so they appear in test results and reports
  if (m.match(/\btunneling\s+socket\b/i) || (m.match(/\bcause\s*=\s*connect\s+/i) && m.match(/\b(ETIMEDOUT|ECONNREFUSED|ECONNRESET)\b/i))) {
    return m;
  }
  if (m.match(/\bECONNREFUSED\b/i)) return `Network error: Connection refused (no server at host:port)`;
  if (m.match(/\bETIMEDOUT\b/i)) return `Network error: Request timeout`;
  if (m.match(/\bECONNRESET\b/i)) return `Network error: Connection reset by peer`;
  if (m.match(/\bENOTFOUND\b/i)) return `Network error: Host not found (DNS lookup failed)`;
  if (m.match(/\bENETUNREACH\b/i)) return `Network error: Network unreachable`;
  if (m.match(/\bEAI_AGAIN\b/i)) return `Network error: DNS temporary failure`;
  if (m.match(/\bESOCKETTIMEDOUT\b/i)) return `Network error: Socket timeout`;
  if (m.match(/\btimeout\b/i) && !m.match(/assertion|expected/i)) return `Network error: Request timeout`;
  return m;
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
 * Get all request item names from a Postman collection (flatten folders so we match execution results correctly).
 * @param {object} collectionJson - Postman collection JSON (with item array; items can be requests or folders)
 * @returns {string[]} Array of request names
 */
function getAllRequestNamesFromCollection(collectionJson) {
  const names = [];
  function walk(items) {
    if (!items || !Array.isArray(items)) return;
    for (const i of items) {
      if (i.request && i.name) names.push(i.name);
      if (i.item) walk(i.item);
    }
  }
  walk(collectionJson?.item);
  return names;
}

/**
 * Find which collection (and its api_spec_id) an execution item belongs to by matching item name.
 * Uses flattened request names so folder-based collections match correctly.
 * @param {Array<{ collection_json: object, api_spec_id: number }>} collections - Collection model instances
 * @param {string} executionItemName - execution.item.name from Newman
 * @returns {{ apiSpecId: number | null }} apiSpecId if a collection matched
 */
function findCollectionForExecution(collections, executionItemName) {
  for (const coll of collections) {
    const names = getAllRequestNamesFromCollection(coll.collection_json);
    const matched = names.some(
      (name) => executionItemName === name || executionItemName.includes(name)
    );
    if (matched) {
      return { apiSpecId: coll.api_spec_id };
    }
  }
  return { apiSpecId: null };
}

/**
 * Ensure a ProjectTest and ProjectTestStat exist for a given API TestResult
 * and update aggregated stats.
 * Stable key for API tests: api:<method>:<test_name>
 * @param {import('../models/TestRun')} testRun
 * @param {import('../models/TestResult')} testResult
 * @returns {Promise<void>}
 */
async function updateProjectTestStatsForApiResult(testRun, testResult) {
  try {
    if (!testRun || !testRun.project_id) return;
    const method = (testResult.method || '').toString().trim() || 'GET';
    const name = (testResult.test_name || '').toString().trim() || testResult.endpoint || 'Request';
    const stableKey = `api:${method}:${name}`;

    const [projectTest] = await ProjectTest.findOrCreate({
      where: {
        project_id: testRun.project_id,
        stable_key: stableKey
      },
      defaults: {
        test_type: 'api',
        name,
        endpoint: testResult.endpoint || null,
        method,
        source_id: null,
        source_kind: 'postman_item',
        is_active: true
      }
    });

    // Keep basic fields up to date in case name/endpoint changed
    await projectTest.update({
      name,
      endpoint: testResult.endpoint || projectTest.endpoint,
      method,
      is_active: true
    });

    const [stats] = await ProjectTestStat.findOrCreate({
      where: { project_test_id: projectTest.id },
      defaults: {
        total_runs: 0,
        last_status: 'not_run'
      }
    });

    const newTotalRuns = (stats.total_runs || 0) + 1;
    await stats.update({
      total_runs: newTotalRuns,
      last_status: testResult.status || stats.last_status || 'not_run',
      last_run_at: new Date(),
      last_run_source: 'api',
      last_run_type: 'api',
      last_run_id: testRun.id
    });
  } catch (err) {
    // Do not break test execution if catalogue update fails
    console.error('[testRunner] Failed to update project test stats for API result:', err.message || err);
  }
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

    // Newman supports collection variables (initial values from collection JSON) and environment variables.
    // Note: pm.collectionVariables.set() at runtime is NOT reliably supported by Newman (see postmanlabs/newman#2190, #2631).
    // For dynamic values (e.g. tokens, IDs from responses), use pm.environment.set() and pass an environment (envVars or environment file).
    const newmanOptions = {
      collection: tempFile,
      reporters: ['cli'],
      timeout: options.timeout || 60000, // Increased to 60 seconds
      timeoutRequest: options.timeoutRequest || 30000, // Increased to 30 seconds
      insecure: true, // Allow self-signed certificates
      ...options.newmanOptions
    };
    
    // Add delayRequest if specified (in milliseconds)
    // Newman's delayRequest adds a delay between each request in the collection
    // Note: CLI uses --delay-request, but Node.js API uses delayRequest (camelCase)
    // IMPORTANT: Set delayRequest AFTER spreading options.newmanOptions to ensure it takes precedence
    if (options.delayRequest !== undefined && options.delayRequest !== null) {
      const delayMs = Number(options.delayRequest);
      if (!isNaN(delayMs) && delayMs >= 0) {
        newmanOptions.delayRequest = delayMs;
        console.log(`[testRunner] Setting Newman delayRequest option: ${delayMs}ms (${delayMs/1000}s)`);
      } else {
        console.log(`[testRunner] Invalid delayRequest value: ${options.delayRequest} (parsed as ${delayMs})`);
      }
    } else {
      console.log(`[testRunner] No delayRequest option provided (options.delayRequest = ${options.delayRequest})`);
    }
    
    // Log final newmanOptions for debugging (excluding sensitive data)
    console.log(`[testRunner] Newman options:`, {
      collection: newmanOptions.collection ? 'set' : 'missing',
      delayRequest: newmanOptions.delayRequest,
      timeout: newmanOptions.timeout,
      timeoutRequest: newmanOptions.timeoutRequest,
      hasEnvironment: !!newmanOptions.environment,
      insecure: newmanOptions.insecure
    });
    
    // Always pass an environment so pm.environment.set() in scripts works (Newman does not reliably support pm.collectionVariables.set()).
    if (options.environment) {
      newmanOptions.environment = options.environment;
    } else {
      // Build environment from envVars or use empty so scripts can still call pm.environment.set()
      const envVars = (options.envVars && typeof options.envVars === 'object') ? options.envVars : {};
      const envId = generateId();
      const envObject = {
        id: envId,
        name: `Test Environment ${Date.now()}`,
        values: Object.entries(envVars).map(([key, value]) => ({
          key: key,
          value: normalizeBaseUrl(String(value)),
          type: 'string',
          enabled: true
        })),
        _postman_variable_scope: 'environment',
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: 'DEO/EPS -- QA Testing Tool'
      };
      const envFile = path.join(tempDir, `environment-${envId}.json`);
      fs.writeFileSync(envFile, JSON.stringify(envObject, null, 2));
      newmanOptions.environment = envFile;
      setTimeout(() => {
        try {
          if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
        } catch (e) { /* ignore */ }
      }, 5000);
    }

    // Apply project proxy for this run (Newman/postman-request respect HTTP_PROXY/HTTPS_PROXY)
    const proxy = options.proxy && (options.proxy.http || options.proxy.https) ? options.proxy : null;
    const savedEnv = {};
    if (proxy) {
      const httpUrl = proxy.http || proxy.https || '';
      const httpsUrl = proxy.https || proxy.http || '';
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
        savedEnv[key] = process.env[key];
      }
      process.env.HTTP_PROXY = httpUrl;
      process.env.HTTPS_PROXY = httpsUrl;
      process.env.NO_PROXY = proxy.bypass || '';
      process.env.http_proxy = httpUrl;
      process.env.https_proxy = httpsUrl;
      process.env.no_proxy = proxy.bypass || '';
    }

    newman.run(newmanOptions, (err, summary) => {
      // Restore proxy env
      if (proxy) {
        for (const [key, val] of Object.entries(savedEnv)) {
          if (val !== undefined) process.env[key] = val;
          else delete process.env[key];
        }
      }
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

      // Some transport/proxy failures (e.g. tunneling socket ETIMEDOUT) are reported at run-level (summary.run.failures)
      // and may not be attached to each individual execution. Capture the first such failure so we can surface it per test.
      const runLevelFailure = (summary.run.failures || []).find(f => {
        const e = f && (f.error || f);
        const msg = getFullErrorMessage(e) || (e && e.message) || (typeof e === 'string' ? e : '');
        return !!msg && (
          /tunneling\s+socket/i.test(msg) ||
          /\b(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH)\b/i.test(msg)
        );
      }) || null;

      const runLevelErrorObj = (() => {
        if (!runLevelFailure) return null;
        const e = runLevelFailure.error || runLevelFailure;
        const full = getFullErrorMessage(e) || (e && e.message) || (typeof e === 'string' ? e : '');
        const codeFromObj = (e && (e.code || e.errno)) || null;
        const codeFromMsg = !codeFromObj && full
          ? (full.match(/\b(ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH)\b/i)?.[1] || null)
          : null;
        return {
          message: full,
          name: (e && e.name) || 'Error',
          code: codeFromObj || codeFromMsg
        };
      })();

      // Extract execution details
      if (summary.run && summary.run.executions) {
        summary.run.executions.forEach(execution => {
          const request = execution.request || {};
          // IMPORTANT: keep null when there's no HTTP response (Newman may provide undefined)
          const response = execution.response || null;
          
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
              errorMessage = formatAssertionErrors(failedAssertions);
            }
          }
          
          // If no response but there's an error, capture it (network/timeout/connection errors, including proxy/tunneling)
          if (!response && execution.error) {
            const rawErr = getFullErrorMessage(execution.error);
            errorMessage = normalizeNetworkError(rawErr || (execution.error.message || execution.error.toString()));
          }
          // If Newman reported a run-level transport error (proxy/timeout/etc) but execution has none, attach it
          if (!response && !execution.error && runLevelErrorObj) {
            errorMessage = normalizeNetworkError(runLevelErrorObj.message || '') || runLevelErrorObj.message || errorMessage;
          }
          
          // Determine status - consider connection errors AND assertion failures
          // Priority: Test script assertions are authoritative - if all pass, test passes regardless of HTTP status
          const hasAssertions = execution.assertions && execution.assertions.length > 0;
          let status = 'failed';
          if (response) {
            const responseCode = response.code || 0;
            if (hasAssertions) {
              // Test has assertions - use them as the source of truth
              if (hasFailedAssertions) {
                status = 'failed';
                // Error message already set from failed assertions above
              } else {
                // All assertions passed - test is passed regardless of HTTP status code
                // This allows tests that validate error responses (4xx/5xx) to pass
                status = 'passed';
              }
            } else {
              // No assertions - fall back to HTTP status code logic
              status = (responseCode >= 200 && responseCode < 300) ? 'passed' : 'failed';
              if (status === 'failed' && !errorMessage) {
                errorMessage = `HTTP ${responseCode}: ${response.status || 'Request failed'}`;
              }
            }
          } else if (execution.error) {
            status = 'failed';
            if (!errorMessage) errorMessage = normalizeNetworkError(getFullErrorMessage(execution.error) || execution.error.message || execution.error.toString()) || 'Connection failed';
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
                message: getFullErrorMessage(execution.error) || execution.error.message || execution.error.toString(),
                name: execution.error.name,
                // Preserve low-level error code for proxy/timeouts/etc (e.g. ETIMEDOUT, ECONNRESET, ESOCKETTIMEDOUT)
                code: execution.error.code || execution.error.errno || null
              } : ((!response && runLevelErrorObj) ? {
                message: runLevelErrorObj.message,
                name: runLevelErrorObj.name,
                code: runLevelErrorObj.code || null
              } : null)
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
function filterCollectionItems(collection, selectedPaths, testDelaysForCollection = {}) {
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
      const pathString = path.join('.');
      if (testDelaysForCollection && typeof testDelaysForCollection[pathString] !== 'undefined') {
        clonedItem._delaySeconds = Number(testDelaysForCollection[pathString]);
      }
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
    // Log received options for debugging
    console.log('[testRunner] executeTests called with options:', {
      hasDelayBetweenTests: typeof options.delayBetweenTests !== 'undefined',
      delayBetweenTests: options.delayBetweenTests,
      hasSelectedTestsOrdered: !!options.selectedTestsOrdered,
      hasTestDelays: !!options.testDelays
    });
    
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

    // Get or create test run record FIRST (before calculating totals)
    let testRun;
    if (options.testRunId) {
      // Test run was already created by the API route
      testRun = await TestRun.findByPk(options.testRunId);
      if (!testRun) {
        throw new Error(`Test run with ID ${options.testRunId} not found`);
      }
      if (isTestRunCancelled(testRun.id)) {
        await testRun.update({ status: 'cancelled' });
        clearCancelTestRun(testRun.id);
        return { testRun, testResults: [], summary: { total: 0, passed: 0, failed: 0, duration: 0 } };
      }
    } else {
      // Create test run record with placeholder values (will be updated after counting results)
      testRun = await TestRun.create({
        name: testRunName,
        status: 'running', // Temporary status
        project_id: projectId,
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0,
        run_by_user_id: options.runByUserId ?? null
      });
    }

    // Calculate total tests count early for progress tracking
    let totalTestsToRun = 0;
    
    // If caller provided an explicit ordered list of tests, honor that order across collections
    let mergedCollection;
    // Map to track test_id and execution_order for each test item
    // Maps item name -> { testId, executionOrder }
    const testIdMap = new Map();
    const selectedTestsOrderedArray = options.selectedTestsOrdered || [];
    
    if (selectedTestsOrderedArray && Array.isArray(selectedTestsOrderedArray) && selectedTestsOrderedArray.length > 0) {
      totalTestsToRun = selectedTestsOrderedArray.length;
      const ordered = [];
      const delays = options.testDelays || {};

      // Build ordered list of items using provided sequence
      for (let orderIndex = 0; orderIndex < options.selectedTestsOrdered.length; orderIndex++) {
        const entry = options.selectedTestsOrdered[orderIndex];
        const cid = entry.collectionId;
        const path = entry.path;
        const testId = entry.testId || `TEST-${orderIndex + 1}`;
        // Find the collection object by id (support string/number)
        const coll = collections.find(c => String(c.id) === String(cid) || c.id === cid);
        if (!coll) continue;

        const item = getItemByPath(coll.collection_json, path);
        if (!item) continue;

        const cloned = JSON.parse(JSON.stringify(item));
        const pathString = path.join('.');
        const delaysForCollection = delays[cid] || delays[String(cid)] || {};
        if (delaysForCollection && typeof delaysForCollection[pathString] !== 'undefined') {
          cloned._delaySeconds = Number(delaysForCollection[pathString]);
        }
        
        // Store test_id and execution_order mapping
        const itemName = cloned.name || cloned.request?.url || `Item-${orderIndex}`;
        testIdMap.set(itemName, { testId, executionOrder: orderIndex + 1 });

        ordered.push(cloned);
      }

      // Merge variables and auth from original collections (preserve first occurrence semantics)
      const mergedVars = [];
      const seenVariables = new Set();
      collections.forEach(c => {
        if (c.collection_json && c.collection_json.variable && Array.isArray(c.collection_json.variable)) {
          c.collection_json.variable.forEach(v => {
            if (!seenVariables.has(v.key)) {
              mergedVars.push({ ...v });
              seenVariables.add(v.key);
            }
          });
        }
      });

      mergedCollection = {
        info: { name: testRunName, description: `Ordered selection merged from ${collections.length} sources`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: ordered
      };
      if (mergedVars.length > 0) mergedCollection.variable = mergedVars;
      if (collections[0] && collections[0].collection_json && collections[0].collection_json.auth) mergedCollection.auth = collections[0].collection_json.auth;

      console.log('[testRunner] Executing tests in explicit ordered sequence provided by client. Total items:', ordered.length);
    } else {
      // Filter and get collection JSONs (legacy/grouped by collection behavior)
      const collectionObjects = collections.map(c => {
        const collectionJson = c.collection_json;

        // Determine per-collection delays mapping (supports numeric keys or string keys)
        const delaysForCollection = (options.testDelays && (options.testDelays[c.id] || options.testDelays[String(c.id)])) ? (options.testDelays[c.id] || options.testDelays[String(c.id)]) : {};
        
        // If selectedTests is provided, filter items for this collection and inject per-item delays
        if (selectedTests && selectedTests[c.id]) {
          return filterCollectionItems(collectionJson, selectedTests[c.id], delaysForCollection);
        }

        // If per-item delays are provided for the whole collection (legacy flow), apply them in-place
        if (delaysForCollection && Object.keys(delaysForCollection).length > 0) {
          const cloned = JSON.parse(JSON.stringify(collectionJson));
          function applyDelays(items, parentPath = []) {
            if (!items || !Array.isArray(items)) return;
            items.forEach((item, index) => {
              const path = [...parentPath, index];
              const pathString = path.join('.');
              if (item.request && typeof delaysForCollection[pathString] !== 'undefined') {
                item._delaySeconds = Number(delaysForCollection[pathString]);
              }
              if (item.item && Array.isArray(item.item)) {
                applyDelays(item.item, path);
              }
            });
          }
          applyDelays(cloned.item || []);
          console.log('[testRunner] Applied per-item delays for collection', c.id, delaysForCollection);
          return cloned;
        }
        
        // Otherwise return the full collection
        return collectionJson;
      });

      // Merge collections if multiple
      mergedCollection = mergeCollections(collectionObjects, testRunName);
      // Count total items in merged collection
      const countItems = (items) => {
        let count = 0;
        items.forEach(item => {
          if (item.request) {
            count++;
          } else if (item.item && Array.isArray(item.item)) {
            count += countItems(item.item);
          }
        });
        return count;
      };
      totalTestsToRun = countItems(mergedCollection.item || []);
    }
    
    // Update total tests count early so frontend can show progress
    await testRun.update({
      total_tests: totalTestsToRun
    });

    // Run tests with options (environment variables, etc.)
    // Use Newman's delayRequest option for delays between tests
    // Convert delayBetweenTests to number and validate
    const delayBetweenTestsNum = (typeof options.delayBetweenTests !== 'undefined' && options.delayBetweenTests !== null) 
      ? Number(options.delayBetweenTests) 
      : undefined;
    const hasGlobalDelay = delayBetweenTestsNum !== undefined && !isNaN(delayBetweenTestsNum) && delayBetweenTestsNum > 0;
    const hasPerItemDelay = (mergedCollection.item || []).some(it => typeof it._delaySeconds !== 'undefined' && it._delaySeconds !== null);

    // Log debug information about delay configuration
    console.log('[testRunner] hasGlobalDelay=', !!hasGlobalDelay, 'delayBetweenTests=', options.delayBetweenTests, 'delayBetweenTestsNum=', delayBetweenTestsNum, 'hasPerItemDelay=', hasPerItemDelay, 'mergedItems=', (mergedCollection.item || []).length);

    let newmanResults;
    let skipDuplicateSave = false; // Flag to skip duplicate save when results are saved incrementally
    
    // Run sequentially if we have any delays (per-item or global) to enable progress tracking
    // Otherwise, run all tests in parallel for speed
    if (hasPerItemDelay || hasGlobalDelay) {
      // Sequential execution with delays - enables real-time progress tracking
      // IMPORTANT: Create a shared environment file so every sequential run has an environment.
      // This allows pm.environment.set() in scripts to persist between tests (we also sync from response body below).
      const tempDir = path.join(__dirname, '..', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const sharedEnvVars = { ...(options.envVars || {}) };
      const envId = generateId();
      const sharedEnvObject = {
        id: envId,
        name: `Shared Test Environment ${testRunName}`,
        values: Object.entries(sharedEnvVars).map(([key, value]) => ({
          key: key,
          value: normalizeBaseUrl(String(value)),
          type: 'string',
          enabled: true
        })),
        _postman_variable_scope: 'environment',
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: 'DEO/EPS -- QA Testing Tool'
      };
      const sharedEnvFile = path.join(tempDir, `shared-env-${testRun.id || envId}.json`);
      fs.writeFileSync(sharedEnvFile, JSON.stringify(sharedEnvObject, null, 2));
      console.log(`[testRunner] Created shared environment file for sequential execution: ${sharedEnvFile}`);
      
      const combinedExecutions = [];
      const started = Date.now();

      for (let i = 0; i < (mergedCollection.item || []).length; i++) {
        const item = mergedCollection.item[i];
        const singleCollection = {
          info: mergedCollection.info || { name: testRunName },
          item: [JSON.parse(JSON.stringify(item))]
        };

        // Determine delay for this item (will be applied before next test)
        // Priority: per-item delay > global delay > no delay
        const delaySec = (typeof item._delaySeconds !== 'undefined' && item._delaySeconds !== null) 
          ? Number(item._delaySeconds) 
          : (hasGlobalDelay ? delayBetweenTestsNum : 0);
        
        // Create options for this single test run
        const testOptions = { ...options };
        // Set delayRequest to 0 for individual tests (we'll handle delay between tests manually)
        testOptions.delayRequest = 0;
        
        // Use shared environment file for all sequential runs (always set; file created above)
        testOptions.environment = sharedEnvFile;
        delete testOptions.envVars;

        // Run single item as its own collection
        const currentTestName = item.name || item.request?.method || 'Unnamed';
        console.log(`[testRunner] Executing item ${i + 1}/${(mergedCollection.item || []).length}:`, currentTestName);
        
        const parsed = await runNewmanTests(singleCollection, testOptions);
        
        // After each test, try to extract variables from the response and update the shared environment
        // This allows variables set by test scripts to persist to the next test
        if (sharedEnvFile && fs.existsSync(sharedEnvFile) && parsed && parsed.executions && parsed.executions.length > 0) {
          const execution = parsed.executions[0];
          const responseBody = execution.item.response?.body;
          
          if (responseBody) {
            try {
              // Try to parse JSON response
              const responseJson = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
              
              // Common patterns: extract auth_req_id, access_token, token, etc. from response
              // Update shared environment with any variables found in response
              const envContent = JSON.parse(fs.readFileSync(sharedEnvFile, 'utf8'));
              let envUpdated = false;
              
              // Check for common variable names in response (include validResourceId for collection scripts that set it from response)
              const variablePatterns = ['auth_req_id', 'access_token', 'token', 'bearer_token', 'id', 'request_id', 'validResourceId'];
              variablePatterns.forEach(varName => {
                const val = responseJson[varName];
                if (val !== undefined && val !== null) {
                  const strVal = String(val);
                  const existingVar = envContent.values.find(v => v.key === varName);
                  if (existingVar) {
                    if (existingVar.value !== strVal) {
                      existingVar.value = strVal;
                      envUpdated = true;
                      console.log(`[testRunner] Updated shared environment variable: ${varName} = ${strVal}`);
                    }
                  } else {
                    envContent.values.push({
                      key: varName,
                      value: strVal,
                      type: 'string',
                      enabled: true
                    });
                    envUpdated = true;
                    console.log(`[testRunner] Added shared environment variable: ${varName} = ${strVal}`);
                  }
                }
              });
              
              // Also check for nested properties (e.g., data.auth_req_id, data.validResourceId)
              if (responseJson.data) {
                variablePatterns.forEach(varName => {
                  const dataVal = responseJson.data[varName];
                  if (dataVal !== undefined && dataVal !== null) {
                    const strVal = String(dataVal);
                    const existingVar = envContent.values.find(v => v.key === varName);
                    if (existingVar) {
                      if (existingVar.value !== strVal) {
                        existingVar.value = strVal;
                        envUpdated = true;
                        console.log(`[testRunner] Updated shared environment variable from data: ${varName} = ${strVal}`);
                      }
                    } else {
                      envContent.values.push({
                        key: varName,
                        value: strVal,
                        type: 'string',
                        enabled: true
                      });
                      envUpdated = true;
                      console.log(`[testRunner] Added shared environment variable from data: ${varName} = ${strVal}`);
                    }
                  }
                });
              }
              
              if (envUpdated) {
                fs.writeFileSync(sharedEnvFile, JSON.stringify(envContent, null, 2));
                console.log(`[testRunner] Updated shared environment file with new variables`);
              }
            } catch (parseError) {
              // Response is not JSON or parsing failed - skip variable extraction
              // This is expected for non-JSON responses
            }
          }
        }
        let executionResult;
        if (parsed && parsed.executions && parsed.executions.length > 0) {
          executionResult = parsed.executions[0];
          combinedExecutions.push(executionResult);
        } else {
          // Fallback execution record when Newman doesn't return expected execution
          executionResult = {
            item: { name: item.name || 'Unknown', request: item.request || {} },
            status: 'failed',
            errorMessage: 'No execution result returned'
          };
          combinedExecutions.push(executionResult);
        }
        
        // Save this test result immediately for progress tracking
        // This allows frontend to see progress incrementally during sequential execution
        try {
          // Find collection and apiSpecId for this test
          let collection = null;
          let apiSpecId = null;
          for (const coll of collections) {
            const items = coll.collection_json?.item || [];
            const itemName = executionResult.item.name;
            if (items.some(i => itemName.includes(i.name) || i.name === itemName)) {
              collection = coll;
              apiSpecId = coll.api_spec_id;
              break;
            }
          }
          
          // Get test_id and execution_order from the mapping
          const itemName = executionResult.item.name;
          let testInfo = testIdMap.get(itemName);
          if (!testInfo && selectedTestsOrderedArray && i < selectedTestsOrderedArray.length) {
            const entry = selectedTestsOrderedArray[i];
            testInfo = { testId: entry.testId || `TEST-${i + 1}`, executionOrder: i + 1 };
          }
          
          // Determine status using the same logic as the main save loop
          // Priority: Test script assertions are authoritative - if all pass, test passes regardless of HTTP status
          const hasFailedAssertions = executionResult.assertions && executionResult.assertions.some(a => a.error);
          const hasAssertions = executionResult.assertions && executionResult.assertions.length > 0;
          const responseCode = executionResult.item.response?.code || 0;
          let status = 'failed'; // Default to failed
          
          // Use status from executionResult if available (set in runNewmanTests)
          if (executionResult.status) {
            status = executionResult.status;
          } else if (executionResult.item.response) {
            if (hasAssertions) {
              // Test has assertions - use them as the source of truth
              if (hasFailedAssertions) {
                status = 'failed';
              } else {
                // All assertions passed - test passed regardless of HTTP status code
                status = 'passed';
              }
            } else {
              // No assertions - fall back to HTTP status code logic
              status = (responseCode >= 200 && responseCode < 300) ? 'passed' : 'failed';
            }
          } else if (executionResult.item.error) {
            status = 'failed';
          }
          
          // Get error message if status is failed (include network errors when no HTTP response)
          let errorMessage = executionResult.errorMessage || null;
          if (!errorMessage && status === 'failed' && hasFailedAssertions) {
            const failedAssertions = executionResult.assertions.filter(a => a.error);
            if (failedAssertions.length > 0) {
              errorMessage = formatAssertionErrors(failedAssertions);
            }
          }
          if (!errorMessage && status === 'failed' && executionResult.item.error) {
            const rawErr = getFullErrorMessage(executionResult.item.error);
            errorMessage = normalizeNetworkError(rawErr || executionResult.item.error.message || executionResult.item.error.toString()) || 'No HTTP response';
          }
          // If assertions failed because there was no response (common when proxy/timeouts happen),
          // append the underlying transport error so the UI/report makes the root cause obvious.
          if (!executionResult.item.response && executionResult.item.error) {
            const fullErr = getFullErrorMessage(executionResult.item.error) || executionResult.item.error.message || executionResult.item.error.toString();
            const normalizedErr = normalizeNetworkError(fullErr);
            const errCode = executionResult.item.error.code || executionResult.item.error.errno || null;
            const transportLine = `Request error${errCode ? ` (${errCode})` : ''}: ${normalizedErr || fullErr || 'No HTTP response'}`;
            if (errorMessage) {
              if (!errorMessage.includes('Request error')) errorMessage = `${errorMessage}\n\n${transportLine}`;
            } else {
              errorMessage = transportLine;
            }
          }
          // When there is no HTTP response (timeout, connection refused, proxy/tunneling, etc.), include error in response_body so reports show it
          const rawErrForBody = executionResult.item.error ? (getFullErrorMessage(executionResult.item.error) || executionResult.item.error?.message) : null;
          const rawResponseBodySeq = executionResult.item.response?.body != null
            ? (typeof executionResult.item.response.body === 'string' ? executionResult.item.response.body : JSON.stringify(executionResult.item.response.body, null, 2))
            : (() => {
              if (executionResult.item.error) {
                const fullErr = rawErrForBody || '';
                const normalizedErr = normalizeNetworkError(fullErr);
                const errCode = executionResult.item.error.code || executionResult.item.error.errno || null;
                const lines = ['No HTTP response received.'];
                if (errCode) lines.push(`Error code: ${errCode}`);
                lines.push(`Error: ${normalizedErr || fullErr || 'Unknown network error'}`);
                return lines.join('\n');
              }
              return 'No HTTP response';
            })();
          const formattedResponseSeq = executionResult.item.response
            ? `Status: ${executionResult.item.response.code || ''} ${executionResult.item.response.status || ''}\n\nBody:\n${rawResponseBodySeq}`
            : rawResponseBodySeq;
          
          // Create test result record immediately
          const testResultData = {
            test_run_id: testRun.id,
            test_name: executionResult.item.name,
            endpoint: executionResult.item.request?.url || '',
            method: executionResult.item.request?.method || '',
            status: status,
            duration_ms: 0,
            request_body: executionResult.item.request?.body != null ? (typeof executionResult.item.request.body === 'string' ? executionResult.item.request.body : JSON.stringify(executionResult.item.request.body, null, 2)) : '',
            response_body: formattedResponseSeq,
            response_code: responseCode || null,
            assertions: executionResult.assertions || [],
            error_message: errorMessage,
            api_spec_id: apiSpecId
          };
          
          if (testInfo) {
            testResultData.execution_order = testInfo.executionOrder;
            testResultData.test_id = testInfo.testId;
          }
          
          let testResult;
          try {
            testResult = await TestResult.create(testResultData);
          } catch (createError) {
            if (createError.message && createError.message.includes('execution_order')) {
              const { execution_order, test_id, ...dataWithoutNewFields } = testResultData;
              testResult = await TestResult.create(dataWithoutNewFields);
            } else {
              throw createError;
            }
          }
          
          // Update catalogue stats and progress after each test completes
          await updateProjectTestStatsForApiResult(testRun, testResult);
          // Count passed/failed based on saved test results, not execution results
          // This ensures we use the correct status determination logic
          const savedResults = await TestResult.findAll({
            where: { test_run_id: testRun.id }
          });
          const completedTests = savedResults.length;
          const passedCount = savedResults.filter(tr => tr.status === 'passed').length;
          const failedCount = savedResults.filter(tr => tr.status === 'failed').length;
          
          await testRun.update({
            passed_tests: passedCount,
            failed_tests: failedCount
          });
          
          console.log(`[testRunner] Progress: ${completedTests}/${totalTestsToRun} tests completed (${passedCount} passed, ${failedCount} failed)`);
        } catch (saveError) {
          console.error(`[testRunner] Error saving test result for ${currentTestName}:`, saveError);
          // Continue execution even if saving fails
        }

        // Apply delay before next test (if not the last item)
        if (delaySec > 0 && i < (mergedCollection.item || []).length - 1) {
          console.log(`[testRunner] Waiting ${delaySec} seconds before next test (per-item delay)`);
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        }
      }

      const completed = Date.now();
      newmanResults = { summary: { run: { timings: { started: started, completed: completed } } }, executions: combinedExecutions };
      
      // Clean up shared environment file after sequential execution completes
      if (sharedEnvFile && fs.existsSync(sharedEnvFile)) {
        setTimeout(() => {
          try {
            fs.unlinkSync(sharedEnvFile);
            console.log(`[testRunner] Cleaned up shared environment file: ${sharedEnvFile}`);
          } catch (cleanupError) {
            console.warn(`[testRunner] Error cleaning up shared environment file:`, cleanupError);
          }
        }, 5000);
      }
      
      // Test results were already saved incrementally above for progress tracking
      // Skip the duplicate save loop below
      skipDuplicateSave = true;
    } else {
      // No delays: run all tests normally
      newmanResults = await runNewmanTests(mergedCollection, options);
    }

    if (isTestRunCancelled(testRun.id)) {
      await testRun.update({ status: 'cancelled' });
      clearCancelTestRun(testRun.id);
      return { testRun, testResults: [], summary: { total: 0, passed: 0, failed: 0, duration: 0 } };
    }

    // Test run was already initialized earlier, total_tests was already updated

    // Create test result records and determine their status
    // Skip if results were already saved incrementally (per-item delays)
    let testResults = [];
    if (!skipDuplicateSave) {
      // Only save results if they weren't already saved during sequential execution
      for (let execIndex = 0; execIndex < newmanResults.executions.length; execIndex++) {
      const execution = newmanResults.executions[execIndex];
      // Find which collection (api_spec_id) this test belongs to (flatten folders so we match request names)
      const { apiSpecId } = findCollectionForExecution(collections, execution.item.name);

      // Get test_id and execution_order from the mapping
      // Try to match by item name first, then fall back to execution index
      const itemName = execution.item.name;
      let testInfo = testIdMap.get(itemName);
      
      // If not found by exact name, try to get from selectedTestsOrdered array by index
      if (!testInfo && selectedTestsOrderedArray && execIndex < selectedTestsOrderedArray.length) {
        const entry = selectedTestsOrderedArray[execIndex];
        testInfo = {
          testId: entry.testId || `TEST-${execIndex + 1}`,
          executionOrder: execIndex + 1
        };
      }
      
      // Final fallback
      if (!testInfo) {
        testInfo = {
          testId: `TEST-${execIndex + 1}`,
          executionOrder: execIndex + 1
        };
      }

      // Determine status from execution data
      // Priority: execution.status (from parsed results, which includes assertion checks) > response code > default to failed
      let responseCode = execution.item.response?.code ?? null;
      // Try to extract HTTP code from execution error message when response is missing
      if (!responseCode && execution.item.error && execution.item.error.message) {
        const m = execution.item.error.message.match(/HTTP\s*(\d{3})/i);
        if (m) responseCode = parseInt(m[1], 10);
      }
      let status = 'failed'; // Default to failed
      
      // Check for failed assertions from test scripts
      const hasFailedAssertions = execution.assertions && execution.assertions.some(a => a.error);
      const hasAssertions = execution.assertions && execution.assertions.length > 0;
      
      // Use status from execution data if available (this is set in runNewmanTests and includes assertion checks)
      // Priority: Test script assertions are authoritative - if all pass, test passes regardless of HTTP status
      if (execution.status) {
        status = execution.status;
      } else if (hasAssertions) {
        // Test has assertions - use them as the source of truth
        if (hasFailedAssertions) {
          // If any assertion failed, test is failed regardless of HTTP status
          status = 'failed';
        } else if (execution.item.response) {
          // All assertions passed - test passed regardless of HTTP status code
          // This allows tests that validate error responses (4xx/5xx) to pass
          status = 'passed';
        } else {
          status = 'failed';
        }
      } else if (execution.item.response) {
        // No assertions - fall back to HTTP status code logic
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
            errorMessage = formatAssertionErrors(failedAssertions);
          }
        }
        if (!errorMessage) {
          if (execution.item.error) {
            const rawErr = getFullErrorMessage(execution.item.error);
            errorMessage = normalizeNetworkError(rawErr || execution.item.error.message || execution.item.error.toString()) || 'Request failed';
          } else if (responseCode >= 400) {
            errorMessage = `HTTP ${responseCode}: ${execution.item.response?.status || 'Request failed'}`;
          } else if (responseCode === 0) {
            errorMessage = 'Connection failed or timeout';
          } else {
            errorMessage = 'Test failed';
          }
        }
      }
      
      // If assertions failed due to missing response, also show the underlying transport error/code.
      if (!execution.item.response && execution.item.error) {
        const fullErr = getFullErrorMessage(execution.item.error) || execution.item.error.message || execution.item.error.toString();
        const normalizedErr = normalizeNetworkError(fullErr);
        const errCode = execution.item.error.code || execution.item.error.errno || null;
        const transportLine = `Request error${errCode ? ` (${errCode})` : ''}: ${normalizedErr || fullErr || 'No HTTP response'}`;
        if (errorMessage) {
          if (!errorMessage.includes('Request error')) errorMessage = `${errorMessage}\n\n${transportLine}`;
        } else {
          errorMessage = transportLine;
        }
      }

      // Ensure response body is set even when only an error message is available (include full proxy/tunneling errors)
      const rawErrForResponse = execution.item.error ? (getFullErrorMessage(execution.item.error) || execution.item.error?.message) : null;
      const rawResponseBody = execution.item.response?.body || (() => {
        if (execution.item.error) {
          const fullErr = rawErrForResponse || '';
          const normalizedErr = normalizeNetworkError(fullErr);
          const errCode = execution.item.error.code || execution.item.error.errno || null;
          const lines = ['No HTTP response received.'];
          if (errCode) lines.push(`Error code: ${errCode}`);
          lines.push(`Error: ${normalizedErr || fullErr || 'Unknown network error'}`);
          return lines.join('\n');
        }
        return (errorMessage ? `Error: ${errorMessage}` : '');
      })();

      // Build readable request details (method, url, headers, body)
      const rawReqHeaders = execution.item.request?.headers || [];
      const reqHeadersStr = Array.isArray(rawReqHeaders) ? rawReqHeaders.map(h => `${h.key || h.name || ''}: ${h.value || h.value || ''}`).join('\n') : '';
      const requestTextParts = [];
      requestTextParts.push(`${execution.item.request?.method || ''} ${execution.item.request?.url || ''}`);
      requestTextParts.push('');
      requestTextParts.push('Headers:');
      requestTextParts.push(reqHeadersStr || 'None');
      requestTextParts.push('');
      requestTextParts.push('Body:');
      requestTextParts.push(execution.item.request?.body || '');
      const formattedRequest = requestTextParts.join('\n');

      // Build readable response details (status, headers, body)
      const rawRespHeaders = execution.item.response?.headers || [];
      const respHeadersStr = Array.isArray(rawRespHeaders) ? rawRespHeaders.map(h => `${h.key || h.name || ''}: ${h.value || ''}`).join('\n') : '';
      const responseTextParts = [];
      if (execution.item.response) {
        responseTextParts.push(`Status: ${execution.item.response.code || ''} ${execution.item.response.status || ''}`);
        responseTextParts.push('');
        responseTextParts.push('Headers:');
        responseTextParts.push(respHeadersStr || 'None');
        responseTextParts.push('');
        responseTextParts.push('Body:');
        responseTextParts.push(rawResponseBody || '');
      } else if (execution.item.error) {
        responseTextParts.push('No HTTP response received.');
        if (execution.item.error.code || execution.item.error.errno) responseTextParts.push(`Error code: ${execution.item.error.code || execution.item.error.errno}`);
        responseTextParts.push(`Error: ${normalizeNetworkError(getFullErrorMessage(execution.item.error) || execution.item.error.message || '')}`);
      } else {
        responseTextParts.push(rawResponseBody || 'No response');
      }
      const formattedResponse = responseTextParts.join('\n');

      // Build test result data
      const testResultData = {
        test_run_id: testRun.id,
        test_name: execution.item.name,
        endpoint: execution.item.request?.url || '',
        method: execution.item.request?.method || '',
        status: status,
        duration_ms: 0, // Newman doesn't provide per-request timing easily
        request_body: formattedRequest,
        response_body: formattedResponse,
        response_code: responseCode || null,
        assertions: execution.assertions || [],
        error_message: errorMessage,
        api_spec_id: apiSpecId,
        execution_order: testInfo.executionOrder,
        test_id: testInfo.testId
      };

      // Try to create with new fields, fallback if columns don't exist
      let testResult;
      try {
        testResult = await TestResult.create(testResultData);
      } catch (createError) {
        // If error is about missing columns, retry without them
        if (createError.message && createError.message.includes('execution_order')) {
          console.log('[testRunner] execution_order/test_id columns not found. Running without them. Please run: node scripts/migrate.js');
          const { execution_order, test_id, ...dataWithoutNewFields } = testResultData;
          testResult = await TestResult.create(dataWithoutNewFields);
        } else {
          throw createError;
        }
      }

      testResults.push(testResult);
      
      // Update catalogue stats and progress after each test completes
      await updateProjectTestStatsForApiResult(testRun, testResult);
      const completedTests = testResults.length;
      const passedCount = testResults.filter(tr => tr.status === 'passed').length;
      const failedCount = testResults.filter(tr => tr.status === 'failed').length;
      
      await testRun.update({
        passed_tests: passedCount,
        failed_tests: failedCount
      });
      }
      
      // For sequential execution (per-item or global delays), fetch the already-saved results
      if (skipDuplicateSave) {
        testResults = await TestResult.findAll({
          where: { test_run_id: testRun.id },
          order: [['execution_order', 'ASC'], ['created_at', 'ASC']]
        });
      }
    }

    // Calculate statistics from actual test results (not from Newman's summary)
    // If testResults is empty, fetch from database as fallback
    if (!testResults || testResults.length === 0) {
      testResults = await TestResult.findAll({
        where: { test_run_id: testRun.id },
        order: [['execution_order', 'ASC'], ['created_at', 'ASC']]
      });
    }
    
    const totalTests = testResults.length;
    const passedTests = testResults.filter(tr => tr.status === 'passed').length;
    const failedTests = testResults.filter(tr => tr.status === 'failed').length;
    const duration = newmanResults.summary.run.timings?.completed - newmanResults.summary.run.timings?.started || 0;
    
    console.log(`[testRunner] Final statistics: ${totalTests} total, ${passedTests} passed, ${failedTests} failed`);

    if (isTestRunCancelled(testRun.id)) {
      await testRun.update({ status: 'cancelled', total_tests: totalTests, passed_tests: passedTests, failed_tests: failedTests, duration_ms: duration });
      clearCancelTestRun(testRun.id);
      return { testRun, testResults, summary: { total: totalTests, passed: passedTests, failed: failedTests, duration } };
    }

    // Update test run record with correct counts (partial_failed when some pass and some fail)
    await testRun.update({
      status: (failedTests > 0 && passedTests > 0) ? 'partial_failed' : (failedTests > 0 ? 'failed' : 'passed'),
      total_tests: totalTests,
      passed_tests: passedTests,
      failed_tests: failedTests,
      duration_ms: duration
    });

    clearCancelTestRun(testRun.id);
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
  executeTests,
  requestCancelTestRun,
  isTestRunCancelled,
  clearCancelTestRun
};


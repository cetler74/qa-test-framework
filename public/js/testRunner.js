// Test execution functions

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('run-tests-btn')?.addEventListener('click', showRunTestsModal);
});

// Helper function to flatten nested Postman collection items and track their paths
function flattenCollectionItems(items, parentPath = [], collectionId, flatList = []) {
  items.forEach((item, index) => {
    const currentPath = [...parentPath, index];
    const pathString = currentPath.join('.');
    
    // Check if this item has a request (it's a test) or has nested items (it's a folder/group)
    if (item.request) {
      // This is a test item
      flatList.push({
        item: item,
        path: currentPath,
        pathString: pathString,
        collectionId: collectionId,
        name: item.name,
        method: item.request?.method || 'GET',
        url: item.request?.url ? (typeof item.request.url === 'string' ? item.request.url : item.request.url.raw || '') : '',
        isTest: true
      });
    } else if (item.item && Array.isArray(item.item)) {
      // This is a folder/group - add it to the list and recurse
      flatList.push({
        item: item,
        path: currentPath,
        pathString: pathString,
        collectionId: collectionId,
        name: item.name,
        isTest: false,
        isGroup: true,
        children: []
      });
      
      // Recurse into nested items
      flattenCollectionItems(item.item, currentPath, collectionId, flatList);
    }
  });
  
  return flatList;
}

// Helper function to build nested HTML structure
function buildNestedTestHTML(items, collectionId, parentPath = [], level = 0) {
  let html = '';
  
  items.forEach((item, index) => {
    const currentPath = [...parentPath, index];
    const pathString = currentPath.join('.');
    const indent = level * 20;
    
    if (item.request) {
      // This is a test item
      const method = item.request?.method || 'GET';
      const url = item.request?.url ? (typeof item.request.url === 'string' ? item.request.url : item.request.url.raw || '') : '';
      
      html += `
        <div class="test-item" style="padding-left: ${indent}px;" data-path="${pathString}">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" class="test-checkbox" 
                   data-collection-id="${collectionId}" 
                   data-path="${pathString}"
                   value="${collectionId}">
            <span class="method-badge ${method}">${method}</span>
            <span class="test-item-name">${item.name || 'Unnamed Test'}</span>
          </label>
          <div class="test-item-endpoint">${url}</div>
        </div>
      `;
    } else if (item.item && Array.isArray(item.item)) {
      // This is a folder/group
      const groupId = `group-${collectionId}-${pathString}`;
      const hasTests = item.item.some(i => i.request);
      
      if (hasTests) {
        html += `
          <div class="test-group" style="padding-left: ${indent}px;" data-path="${pathString}">
            <div class="test-group-header" style="display: flex; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 4px; margin: 5px 0;">
              <label style="display: flex; align-items: center; cursor: pointer; flex: 1;">
                <input type="checkbox" class="group-checkbox" 
                       data-collection-id="${collectionId}" 
                       data-path="${pathString}"
                       data-group-id="${groupId}">
                <strong style="margin-left: 8px;">📁 ${item.name || 'Unnamed Group'}</strong>
                <span style="margin-left: 10px; font-size: 12px; color: #666;">(${item.item.filter(i => i.request).length} tests)</span>
              </label>
              <button type="button" class="btn btn-sm btn-secondary toggle-group" data-group-id="${groupId}" style="padding: 4px 8px; font-size: 11px;">Expand</button>
            </div>
            <div class="test-group-items" id="${groupId}" style="display: none; margin-left: 20px;">
              ${buildNestedTestHTML(item.item, collectionId, currentPath, level + 1)}
            </div>
          </div>
        `;
      } else {
        // Group has only nested groups, recurse
        html += buildNestedTestHTML(item.item, collectionId, currentPath, level);
      }
    }
  });
  
  return html;
}

// Show Run Tests Modal
function showRunTestsModal() {
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');
  
  if (!projectId) {
    alert('Please select a project first');
    return;
  }
  
  // Load project collections
  apiRequest(`/projects/${projectId}/collections`).then(collections => {
    if (collections.length === 0) {
      alert('No collections available in this project. Add API specs or upload Postman collections first.');
      return;
    }
    
    // Step 1: Collection Selection
    const collectionOptions = collections.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join('');
    
    const content = `
      <form id="run-tests-form">
        <div class="form-group">
          <label for="test-run-name">Test Run Name *</label>
          <input type="text" id="test-run-name" placeholder="e.g., Release 1.0" required>
        </div>
        <div class="form-group">
          <label for="collection-select">Select API Collection *</label>
          <select id="collection-select" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <option value="">Choose a collection...</option>
            ${collectionOptions}
          </select>
        </div>
        <div class="form-group" id="test-selection-section" style="display: none;">
          <label>Select Tests to Run</label>
          <div style="margin-bottom: 10px;">
            <button type="button" class="btn btn-sm btn-secondary" id="select-all-tests">Select All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="deselect-all-tests">Deselect All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="expand-all-groups">Expand All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="collapse-all-groups">Collapse All</button>
          </div>
          <div id="test-selection-container" style="max-height: 500px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 15px; background: #fafafa;">
            <!-- Tests will be loaded here -->
          </div>
          <div id="selected-tests-order" style="margin-top: 15px;">
            <label>Selected Tests Order (drag to reorder):</label>
            <div id="selected-tests-list" style="min-height: 50px; border: 1px solid #ddd; border-radius: 4px; padding: 10px; background: white; margin-top: 5px;">
              <p style="color: #999; font-style: italic;">No tests selected</p>
            </div>
          </div>
        </div>
        <div class="form-group" id="collection-vars-section" style="display: none;">
          <label>Collection Variables *</label>
          <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
            These variables are required by the selected collection. Please provide values for all variables.
          </p>
          <div id="collection-vars-list" style="padding: 15px; background: #f8f9fa; border-radius: 4px; border: 1px solid #ddd;">
            <!-- Collection variables will be populated here -->
          </div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="show-env-vars" onchange="toggleEnvVars()">
            Configure Additional Environment Variables (Optional)
          </label>
          <div id="env-vars-section" style="display: none; margin-top: 10px; padding: 15px; background: #f8f9fa; border-radius: 4px;">
            <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
              Set additional environment variables that will override collection variables during test execution.
            </p>
            <div id="env-vars-list">
              <div class="env-var-item" style="display: flex; gap: 10px; margin-bottom: 10px;">
                <input type="text" placeholder="Variable name" class="env-var-key" style="flex: 1; padding: 8px;">
                <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px;">
                <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
              </div>
            </div>
            <button type="button" class="btn btn-secondary" onclick="addEnvVar()" style="margin-top: 10px;">Add Variable</button>
          </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run Tests</button>
        </div>
      </form>
    `;
    
    showModal('Run Tests', content);
    
    let selectedCollection = null;
    let selectedTestsOrder = []; // Array of {collectionId, path, name, method}
    
    // Helper function to extract variables from collection
    function extractCollectionVariables(collection) {
      const allVariables = new Set();
      const scriptSetVariables = new Set(); // Variables set by test scripts
      const collectionJson = collection.collection_json || {};
      
      // Get variables from collection.variable array
      if (collectionJson.variable && Array.isArray(collectionJson.variable)) {
        collectionJson.variable.forEach(v => {
          if (v.key) allVariables.add(v.key);
        });
      }
      
      // Extract variables from URLs and request bodies using regex
      function extractVariablesFromString(str) {
        if (!str || typeof str !== 'string') return;
        const matches = str.match(/\{\{([^}]+)\}\}/g);
        if (matches) {
          matches.forEach(match => {
            const varName = match.replace(/\{\{|\}\}/g, '');
            allVariables.add(varName);
          });
        }
      }
      
      // Extract variables set by test scripts and pre-request scripts
      function extractScriptSetVariables(items) {
        if (!items || !Array.isArray(items)) return;
        items.forEach(item => {
          // Check both test scripts and pre-request scripts
          if (item.event && Array.isArray(item.event)) {
            item.event.forEach(event => {
              // Check both 'test' and 'prerequest' event types
              if ((event.listen === 'test' || event.listen === 'prerequest') && event.script && event.script.exec) {
                const scriptLines = Array.isArray(event.script.exec) 
                  ? event.script.exec 
                  : [event.script.exec];
                
                scriptLines.forEach(line => {
                  if (typeof line === 'string') {
                    // Match pm.collectionVariables.set("variableName", ...)
                    const setMatches = line.match(/pm\.collectionVariables\.set\(["']([^"']+)["']/g);
                    if (setMatches) {
                      setMatches.forEach(match => {
                        const varName = match.match(/["']([^"']+)["']/)[1];
                        scriptSetVariables.add(varName);
                      });
                    }
                    // Match pm.environment.set("variableName", ...)
                    const envMatches = line.match(/pm\.environment\.set\(["']([^"']+)["']/g);
                    if (envMatches) {
                      envMatches.forEach(match => {
                        const varName = match.match(/["']([^"']+)["']/)[1];
                        scriptSetVariables.add(varName);
                      });
                    }
                  }
                });
              }
            });
          }
          
          // Recurse into nested items
          if (item.item && Array.isArray(item.item)) {
            extractScriptSetVariables(item.item);
          }
        });
      }
      
      // Recursively search for variables in collection items
      function searchItems(items) {
        if (!items || !Array.isArray(items)) return;
        items.forEach(item => {
          if (item.request) {
            // Check URL
            if (item.request.url) {
              if (typeof item.request.url === 'string') {
                extractVariablesFromString(item.request.url);
              } else if (item.request.url.raw) {
                extractVariablesFromString(item.request.url.raw);
              } else if (item.request.url.host) {
                if (Array.isArray(item.request.url.host)) {
                  item.request.url.host.forEach(h => extractVariablesFromString(h));
                } else {
                  extractVariablesFromString(item.request.url.host);
                }
              }
              if (item.request.url.path && Array.isArray(item.request.url.path)) {
                item.request.url.path.forEach(p => extractVariablesFromString(p));
              }
            }
            // Check headers
            if (item.request.header && Array.isArray(item.request.header)) {
              item.request.header.forEach(h => {
                if (h.value) extractVariablesFromString(h.value);
              });
            }
            // Check body
            if (item.request.body) {
              if (typeof item.request.body === 'string') {
                extractVariablesFromString(item.request.body);
              } else if (item.request.body.raw) {
                extractVariablesFromString(item.request.body.raw);
              }
            }
            // Check auth
            if (item.request.auth) {
              if (item.request.auth.bearer && Array.isArray(item.request.auth.bearer)) {
                item.request.auth.bearer.forEach(b => {
                  if (b.value) extractVariablesFromString(b.value);
                });
              }
            }
          }
          // Recurse into nested items
          if (item.item && Array.isArray(item.item)) {
            searchItems(item.item);
          }
        });
      }
      
      // First, extract all variables that are used
      searchItems(collectionJson.item);
      
      // Then, identify which ones are set by scripts
      extractScriptSetVariables(collectionJson.item);
      
      // Return only variables that are NOT set by scripts (user must provide these)
      const userProvidedVariables = Array.from(allVariables).filter(v => !scriptSetVariables.has(v));
      
      return {
        userProvided: userProvidedVariables.sort(),
        scriptSet: Array.from(scriptSetVariables).sort()
      };
    }
    
    // Handle collection selection
    document.getElementById('collection-select').addEventListener('change', (e) => {
      const collectionId = parseInt(e.target.value);
      if (!collectionId) {
        document.getElementById('test-selection-section').style.display = 'none';
        document.getElementById('collection-vars-section').style.display = 'none';
        return;
      }
      
      selectedCollection = collections.find(c => c.id === collectionId);
      if (!selectedCollection) return;
      
      // Extract and display collection variables
      const collectionVars = extractCollectionVariables(selectedCollection);
      if (collectionVars.userProvided && collectionVars.userProvided.length > 0) {
        const varsHTML = collectionVars.userProvided.map(varName => {
          // Get existing value from collection variables if available
          const collectionJson = selectedCollection.collection_json || {};
          const existingVar = collectionJson.variable?.find(v => v.key === varName);
          const defaultValue = existingVar?.value || '';
          
          return `
            <div class="env-var-item" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
              <label style="min-width: 150px; font-weight: 500;">${varName}:</label>
              <input type="text" class="collection-var-value" data-var-name="${varName}" 
                     placeholder="Enter value for ${varName}" 
                     value="${defaultValue}"
                     style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
          `;
        }).join('');
        
        // Add info about script-set variables if any
        let scriptVarsInfo = '';
        if (collectionVars.scriptSet && collectionVars.scriptSet.length > 0) {
          scriptVarsInfo = `
            <div style="margin-top: 15px; padding: 10px; background: #e3f2fd; border-radius: 4px; font-size: 12px; color: #1976d2;">
              <strong>Note:</strong> The following variables are automatically set by test scripts and don't require input:
              <code style="background: rgba(255,255,255,0.7); padding: 2px 6px; border-radius: 3px; margin-left: 5px;">
                ${collectionVars.scriptSet.join(', ')}
              </code>
            </div>
          `;
        }
        
        document.getElementById('collection-vars-list').innerHTML = varsHTML + scriptVarsInfo;
        document.getElementById('collection-vars-section').style.display = 'block';
      } else {
        document.getElementById('collection-vars-section').style.display = 'none';
      }
      
      // Build nested test structure
      const items = selectedCollection.collection_json?.item || [];
      const testHTML = buildNestedTestHTML(items, collectionId);
      
      document.getElementById('test-selection-container').innerHTML = testHTML;
      document.getElementById('test-selection-section').style.display = 'block';
      selectedTestsOrder = [];
      updateSelectedTestsList();
      
      // Setup event listeners for groups and tests
      setupTestSelectionHandlers(collectionId);
    });
    
    // Setup test selection handlers
    function setupTestSelectionHandlers(collectionId) {
      // Group checkbox handlers
      document.querySelectorAll('.group-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const groupId = e.target.getAttribute('data-group-id');
          const groupContainer = document.getElementById(groupId);
          const isChecked = e.target.checked;
          
          // Select/deselect all tests in this group
          groupContainer.querySelectorAll('.test-checkbox').forEach(cb => {
            cb.checked = isChecked;
            handleTestSelection(cb, isChecked);
          });
        });
      });
      
      // Individual test checkbox handlers
      document.querySelectorAll('.test-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          handleTestSelection(e.target, e.target.checked);
        });
      });
      
      // Toggle group expand/collapse
      document.querySelectorAll('.toggle-group').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const groupId = e.target.getAttribute('data-group-id');
          const groupContainer = document.getElementById(groupId);
          const isExpanded = groupContainer.style.display !== 'none';
          
          groupContainer.style.display = isExpanded ? 'none' : 'block';
          e.target.textContent = isExpanded ? 'Expand' : 'Collapse';
        });
      });
    }
    
    // Handle individual test selection
    function handleTestSelection(checkbox, isChecked) {
      const collectionId = parseInt(checkbox.getAttribute('data-collection-id'));
      const path = checkbox.getAttribute('data-path');
      const testItem = checkbox.closest('.test-item');
      const name = testItem.querySelector('.test-item-name').textContent;
      const method = testItem.querySelector('.method-badge').textContent.trim();
      
      if (isChecked) {
        // Add to selected tests order if not already there
        if (!selectedTestsOrder.find(t => t.collectionId === collectionId && t.path === path)) {
          selectedTestsOrder.push({
            collectionId: collectionId,
            path: path,
            name: name,
            method: method
          });
        }
      } else {
        // Remove from selected tests order
        selectedTestsOrder = selectedTestsOrder.filter(t => 
          !(t.collectionId === collectionId && t.path === path)
        );
      }
      
      updateSelectedTestsList();
    }
    
    // Update selected tests list display
    function updateSelectedTestsList() {
      const listContainer = document.getElementById('selected-tests-list');
      
      if (selectedTestsOrder.length === 0) {
        listContainer.innerHTML = '<p style="color: #999; font-style: italic;">No tests selected</p>';
        return;
      }
      
      listContainer.innerHTML = selectedTestsOrder.map((test, index) => `
        <div class="selected-test-item" data-index="${index}" style="display: flex; align-items: center; padding: 8px; margin: 5px 0; background: #f0f0f0; border-radius: 4px; cursor: move;">
          <span style="margin-right: 10px; color: #666;">${index + 1}.</span>
          <span class="method-badge ${test.method}">${test.method}</span>
          <span style="flex: 1; margin-left: 10px;">${test.name}</span>
          <button type="button" class="btn btn-sm btn-secondary move-up" data-index="${index}" style="padding: 2px 8px; margin: 0 2px;">↑</button>
          <button type="button" class="btn btn-sm btn-secondary move-down" data-index="${index}" style="padding: 2px 8px; margin: 0 2px;">↓</button>
          <button type="button" class="btn btn-sm btn-danger remove-test" data-index="${index}" style="padding: 2px 8px; margin-left: 5px;">×</button>
        </div>
      `).join('');
      
      // Add event listeners for reordering and removal
      listContainer.querySelectorAll('.move-up').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.getAttribute('data-index'));
          if (index > 0) {
            [selectedTestsOrder[index], selectedTestsOrder[index - 1]] = 
            [selectedTestsOrder[index - 1], selectedTestsOrder[index]];
            updateSelectedTestsList();
          }
        });
      });
      
      listContainer.querySelectorAll('.move-down').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.getAttribute('data-index'));
          if (index < selectedTestsOrder.length - 1) {
            [selectedTestsOrder[index], selectedTestsOrder[index + 1]] = 
            [selectedTestsOrder[index + 1], selectedTestsOrder[index]];
            updateSelectedTestsList();
          }
        });
      });
      
      listContainer.querySelectorAll('.remove-test').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.getAttribute('data-index'));
          const test = selectedTestsOrder[index];
          
          // Uncheck the checkbox
          const checkbox = document.querySelector(`.test-checkbox[data-collection-id="${test.collectionId}"][data-path="${test.path}"]`);
          if (checkbox) checkbox.checked = false;
          
          // Remove from order
          selectedTestsOrder.splice(index, 1);
          updateSelectedTestsList();
        });
      });
    }
    
    // Select all / Deselect all buttons
    document.getElementById('select-all-tests')?.addEventListener('click', () => {
      document.querySelectorAll('.test-checkbox').forEach(cb => {
        if (!cb.checked) {
          cb.checked = true;
          handleTestSelection(cb, true);
        }
      });
    });
    
    document.getElementById('deselect-all-tests')?.addEventListener('click', () => {
      document.querySelectorAll('.test-checkbox').forEach(cb => {
        if (cb.checked) {
          cb.checked = false;
          handleTestSelection(cb, false);
        }
      });
    });
    
    document.getElementById('expand-all-groups')?.addEventListener('click', () => {
      document.querySelectorAll('.test-group-items').forEach(container => {
        container.style.display = 'block';
      });
      document.querySelectorAll('.toggle-group').forEach(btn => {
        btn.textContent = 'Collapse';
      });
    });
    
    document.getElementById('collapse-all-groups')?.addEventListener('click', () => {
      document.querySelectorAll('.test-group-items').forEach(container => {
        container.style.display = 'none';
      });
      document.querySelectorAll('.toggle-group').forEach(btn => {
        btn.textContent = 'Expand';
      });
    });
    
    // Form submission
    document.getElementById('run-tests-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const testRunName = document.getElementById('test-run-name').value;
      const collectionId = parseInt(document.getElementById('collection-select').value);
      
      if (!collectionId) {
        alert('Please select a collection');
        return;
      }
      
      if (selectedTestsOrder.length === 0) {
        alert('Please select at least one test to run');
        return;
      }
      
      // Validate collection variables are filled
      const missingVars = [];
      document.querySelectorAll('.collection-var-value').forEach(input => {
        const varName = input.getAttribute('data-var-name');
        const value = input.value.trim();
        if (varName && !value) {
          missingVars.push(varName);
        }
      });
      
      if (missingVars.length > 0) {
        alert(`Please provide values for the following required variables:\n${missingVars.join(', ')}`);
        return;
      }
      
      // Convert selected tests order to the format expected by backend
      // Group by collection ID and collect paths
      const selectedTests = {};
      selectedTestsOrder.forEach(test => {
        if (!selectedTests[test.collectionId]) {
          selectedTests[test.collectionId] = [];
        }
        // Convert path string back to array of indices
        const pathIndices = test.path.split('.').map(p => parseInt(p));
        selectedTests[test.collectionId].push(pathIndices);
      });
      
      // Collect collection variables (required)
      const collectionVars = {};
      document.querySelectorAll('.collection-var-value').forEach(input => {
        const varName = input.getAttribute('data-var-name');
        const value = input.value.trim();
        if (varName) {
          if (!value) {
            alert(`Please provide a value for collection variable: ${varName}`);
            throw new Error(`Missing value for variable: ${varName}`);
          }
          collectionVars[varName] = value;
        }
      });
      
      // Collect additional environment variables if configured
      const envVars = { ...collectionVars }; // Start with collection variables
      const envVarItems = document.querySelectorAll('.env-var-item');
      envVarItems.forEach(item => {
        const key = item.querySelector('.env-var-key').value.trim();
        const value = item.querySelector('.env-var-value').value.trim();
        if (key && value) {
          envVars[key] = value; // Additional vars override collection vars
        }
      });
      
      hideModal();
      
      // Show loading
      const loadingContent = `
        <div class="loading">
          <h3>Running Tests...</h3>
          <p>Please wait while tests are executed.</p>
        </div>
      `;
      showModal('Running Tests', loadingContent);
      
      try {
        const requestBody = {
          projectId: parseInt(projectId),
          selectedTests: selectedTests, // Format: { collectionId: [[path1], [path2], ...] }
          name: testRunName
        };
        
        // Add environment variables if any were set
        if (Object.keys(envVars).length > 0) {
          requestBody.envVars = envVars;
        }
        
        const result = await apiRequest('/test-runs/execute', {
          method: 'POST',
          body: requestBody
        });
        
        hideModal();
        alert(`Tests completed! ${result.summary.passed} passed, ${result.summary.failed} failed.`);
        
        // Navigate to test runs view
        showView('test-runs');
        loadTestRuns();
      } catch (error) {
        hideModal();
        alert('Error running tests: ' + error.message);
      }
    });
  }).catch(error => {
    alert('Error loading collections: ' + error.message);
  });
}

// Environment variable management functions
function toggleEnvVars() {
  const checkbox = document.getElementById('show-env-vars');
  const section = document.getElementById('env-vars-section');
  if (section) {
    section.style.display = checkbox.checked ? 'block' : 'none';
  }
}

function addEnvVar() {
  const envVarsList = document.getElementById('env-vars-list');
  if (envVarsList) {
    const newItem = document.createElement('div');
    newItem.className = 'env-var-item';
    newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px;';
    newItem.innerHTML = `
      <input type="text" placeholder="Variable name (e.g., bearer_token)" class="env-var-key" style="flex: 1; padding: 8px;">
      <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px;">
      <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
    `;
    envVarsList.appendChild(newItem);
  }
}

function removeEnvVar(button) {
  const item = button.closest('.env-var-item');
  if (item) {
    item.remove();
  }
}

// Make functions available globally
window.toggleEnvVars = toggleEnvVars;
window.addEnvVar = addEnvVar;
window.removeEnvVar = removeEnvVar;

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
        <div class="test-item" data-path="${pathString}">
          <div class="test-item-left">
            <input type="checkbox" class="test-checkbox" 
                   data-collection-id="${collectionId}" 
                   data-path="${pathString}"
                   value="${collectionId}">
          </div>
          <div class="test-item-body" style="padding-left: ${indent}px;">
            <div class="test-item-row">
              <span class="test-item-name">${item.name || 'Unnamed Test'}</span>
              <span class="method-badge ${method}">${method}</span>
              <input type="number" class="test-delay-input" placeholder="Delay s" min="0" style="width:70px; padding:4px; margin-left:8px;" title="Delay after this test (seconds)">
            </div>
            <div class="test-item-endpoint">${url}</div>
          </div>
        </div>
      `;
    } else if (item.item && Array.isArray(item.item)) {
      // This is a folder/group
      const groupId = `group-${collectionId}-${pathString}`;
      const hasTests = item.item.some(i => i.request);
      
      if (hasTests) {
        html += `
          <div class="test-group" style="padding-left: ${indent}px;" data-path="${pathString}">
            <div class="test-group-header">
              <div class="test-item-left">
                <input type="checkbox" class="group-checkbox" 
                       data-collection-id="${collectionId}" 
                       data-path="${pathString}"
                       data-group-id="${groupId}">
              </div>
              <div class="test-item-body">
                <div class="group-title-row">
                  <strong>📁 ${item.name || 'Unnamed Group'}</strong>
                  <span class="group-count">(${item.item.filter(i => i.request).length} tests)</span>
                </div>
                <div style="margin-top:6px;">
                  <button type="button" class="btn btn-sm btn-secondary toggle-group" data-group-id="${groupId}">Expand</button>
                </div>
              </div>
            </div>
            <div class="test-group-items" id="${groupId}" style="display: none; padding-left: 20px;">
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
        <div class="form-group">
          <label for="env-select">Select Environment (optional)</label>
          <div style="display:flex; gap:10px; align-items: center;">
            <select id="env-select" style="flex: 1; padding:8px; border:1px solid #ddd; border-radius:4px;">
              <option value="">Choose environment...</option>
            </select>
            <button type="button" class="btn btn-sm btn-secondary" id="manage-envs-btn">Manage</button>
            <button type="button" class="btn btn-sm btn-secondary" id="create-env-btn">Create</button>
          </div>
          <p style="font-size:12px; color:#666; margin-top:6px;">Environments store values for <code>{{endpoint}}</code>, <code>{{version}}</code> and <code>{{ixs}}</code>. Selecting one will pre-fill these variables.</p>
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
        <div class="form-group">
          <label for="delay-between-tests">Delay between tests (seconds)</label>
          <input type="number" id="delay-between-tests" min="0" placeholder="e.g., 2" style="width: 120px; padding: 6px;">
          <p style="font-size:12px; color:#666; margin-top:6px;">If set, waits this many seconds before running the next test. Per-test delays override this value.</p>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run Tests</button>
        </div>
      </form>
    `;
    
    showModal('Run Tests', content);
    populateEnvSelect();
    
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
      // Support multiple pm.*.set variants and capture variable names robustly
      function extractScriptSetVariables(items) {
        if (!items || !Array.isArray(items)) return;
        items.forEach(item => {
          // Check both test scripts and pre-request scripts
          if (item.event && Array.isArray(item.event)) {
            item.event.forEach(event => {
              // Consider any script events (test or prerequest)
              if (event.script && event.script.exec) {
                const scriptLines = Array.isArray(event.script.exec) 
                  ? event.script.exec 
                  : [event.script.exec];
                
                scriptLines.forEach(line => {
                  if (typeof line === 'string') {
                    // Generic regex for pm.<scope>.set("varName" or 'varName')
                    const genericMatches = line.match(/pm\.(?:collectionVariables|environment|variables|globals)\.set\(["']([^"']+)["']/g);
                    if (genericMatches) {
                      genericMatches.forEach(match => {
                        const varName = match.match(/["']([^"']+)["']/)[1];
                        scriptSetVariables.add(varName);
                      });
                    }

                    // Also detect pm.collectionVariables.set with different spacing/format
                    const altMatches = line.match(/pm\.collectionVariables\.set\([^,\n\r]+/g);
                    if (altMatches) {
                      altMatches.forEach(m => {
                        const mm = m.match(/["']([^"']+)["']/);
                        if (mm && mm[1]) scriptSetVariables.add(mm[1]);
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
      
      // Normalize and allow certain vars to be provided via environment instead
      const envAllowedLower = new Set(['token','endpoint','version','ixs','ixs2']);
      // Variables we assume are produced by the collection scripts and should NOT block running
      const assumedScriptVarsLower = new Set(['alertid','msisdn','msisdn2','user','ixs2']);
      
      // Build lowercase set for script-set variables
      const scriptSetLower = new Set(Array.from(scriptSetVariables).map(v => v.toLowerCase()));
      // Add assumed script vars so they are not considered required
      assumedScriptVarsLower.forEach(v => scriptSetLower.add(v));
      
      // Filter user-provided variables (case-insensitive) and exclude envAllowed
      const userProvided = Array.from(allVariables).filter(v => {
        const vl = v.toLowerCase();
        if (scriptSetLower.has(vl)) return false;
        if (envAllowedLower.has(vl)) return false;
        return true;
      });
      
      return {
        userProvided: userProvided.sort(),
        scriptSet: Array.from(scriptSetVariables).sort(),
        // All variables detected in the collection (used to populate optional env vars)
        allVars: Array.from(allVariables).sort()
      };
    }
    
    // Handle collection selection
    document.getElementById('collection-select').addEventListener('change', (e) => {
      const collectionId = e.target.value; // treat as string (IDs may be UUIDs)
      if (!collectionId) {
        document.getElementById('test-selection-section').style.display = 'none';
        document.getElementById('collection-vars-section').style.display = 'none';
        return;
      }
      
      selectedCollection = collections.find(c => String(c.id) === String(collectionId));
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
            <div class="collection-var-item" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
              <label style="min-width: 150px; font-weight: 500;">${varName}:</label>
              <input type="text" class="collection-var-value" data-var-name="${varName}" 
                     placeholder="Enter value for ${varName}" 
                     value="${defaultValue}"
                     style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
              <span class="collection-var-source" style="font-size:12px;color:#1976d2;margin-left:8px;display:none;"></span>
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

        // Only add variables that the collection actually uses. Remove empty placeholder env entries first.
        const envList = document.getElementById('env-vars-list');
        if (envList) {
          const showEnvCheckbox = document.getElementById('show-env-vars');
          // Remove empty placeholder entries (both key and value blank)
          Array.from(envList.querySelectorAll('.env-var-item')).forEach(it => {
            const keyInput = it.querySelector('.env-var-key');
            const valInput = it.querySelector('.env-var-value');
            if ((!keyInput || !keyInput.value.trim()) && (!valInput || !valInput.value.trim())) {
              it.remove();
            }
          });

          // Add all detected variables from the collection to the optional environment variables (none are mandatory)
          const allVars = collectionVars.allVars || [];
          let addedAny = false;
          const collectionJson = selectedCollection.collection_json || {};

          allVars.forEach(name => {
            const nameTrim = (name || '').toString().trim();
            if (!nameTrim) return;
            const exists = Array.from(document.querySelectorAll('#env-vars-list .env-var-key')).some(k => k.value.trim().toLowerCase() === nameTrim.toLowerCase());
            if (exists) return;

            // Default from collection variable if present
            const existingVar = collectionJson.variable?.find(v => v.key && v.key.toLowerCase() === nameTrim.toLowerCase());
            const defaultValue = existingVar?.value || '';

            const newItem = document.createElement('div');
            newItem.className = 'env-var-item';
            newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
            newItem.innerHTML = `
              <input type="text" placeholder="Variable name (optional)" class="env-var-key" style="flex: 1; padding: 8px;" value="${nameTrim}">
              <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px;" value="${defaultValue}">
              <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
            `;
            envList.appendChild(newItem);
            addedAny = true;
          });

          // If we added any variables, show the env-vars section
          if (addedAny) {
            if (showEnvCheckbox && !showEnvCheckbox.checked) {
              showEnvCheckbox.checked = true;
              toggleEnvVars();
            }
          }
        }

        // Apply selected environment to prefill collection vars if an env is selected
        const envSelectEl = document.getElementById('env-select');
        if (envSelectEl && envSelectEl.value) {
          onEnvSelected({ target: envSelectEl });
        }
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
      const collectionId = document.getElementById('collection-select').value; // keep as string
      
      if (!testRunName || testRunName.trim() === '') {
        alert('Please enter a Test Run Name');
        return;
      }

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
      const envVarItems = document.querySelectorAll('#env-vars-list .env-var-item');
      envVarItems.forEach(item => {
        const keyInput = item.querySelector('.env-var-key');
        const valueInput = item.querySelector('.env-var-value');
        const key = keyInput ? keyInput.value.trim() : '';
        const value = valueInput ? valueInput.value.trim() : '';
        if (key && value) {
          envVars[key] = value; // Additional vars override collection vars
        }
      });

      // If a saved environment was selected, merge all its variables into envVars (except id/name)
      const envSelectEl = document.getElementById('env-select');
      if (envSelectEl && envSelectEl.value) {
        const savedEnvs = loadSavedEnvs(projectId);
        const selectedEnv = savedEnvs.find(e => e.id === envSelectEl.value);
        if (selectedEnv) {
          Object.keys(selectedEnv).forEach(k => {
            if (k === 'id' || k === 'name') return;
            const v = selectedEnv[k];
            if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '') {
              envVars[k] = v;
            }
          });
        }
      }
      
      // IMPORTANT: Read all form values BEFORE hiding the modal!
      // Collect per-test delays (seconds) if provided
      const testDelays = {};
      selectedTestsOrder.forEach(test => {
        const testEl = document.querySelector(`.test-item[data-path="${test.path}"]`);
        if (!testEl) return;
        const delayInput = testEl.querySelector('.test-delay-input');
        const val = delayInput && delayInput.value ? parseFloat(delayInput.value) : null;
        if (val !== null && !isNaN(val) && Number(val) >= 0) { // allow zero
          if (!testDelays[test.collectionId]) testDelays[test.collectionId] = {};
          testDelays[test.collectionId][test.path] = Number(val);
        }
      });

      // Global delay between tests (seconds) - applied when per-test delay not set
      // MUST read this BEFORE hiding the modal!
      const globalDelayInput = document.getElementById('delay-between-tests');
      let globalDelayValue = null;
      
      console.log('[frontend] Looking for delay input element:', globalDelayInput ? 'found' : 'NOT FOUND');
      
      if (globalDelayInput) {
        const rawValue = globalDelayInput.value ? String(globalDelayInput.value).trim() : '';
        const globalDelayVal = rawValue ? parseFloat(rawValue) : null;
        console.log('[frontend] delay-between-tests - rawValue:', JSON.stringify(rawValue), 'parsed:', globalDelayVal, 'isNaN:', isNaN(globalDelayVal), '>= 0:', globalDelayVal !== null && globalDelayVal >= 0);
        
        if (globalDelayVal !== null && !isNaN(globalDelayVal) && globalDelayVal >= 0) {
          globalDelayValue = Number(globalDelayVal);
          console.log('[frontend] ✓ Captured delayBetweenTests:', globalDelayValue, 'seconds');
        } else {
          console.warn('[frontend] ✗ delayBetweenTests NOT captured - value:', globalDelayVal, 'raw:', JSON.stringify(rawValue));
        }
      } else {
        console.warn('[frontend] ✗ delay-between-tests input element not found!');
      }
      
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
          // Preserve the exact order of selected tests across collections so backend can execute in this sequence
          selectedTestsOrdered: selectedTestsOrder.map(t => ({ collectionId: t.collectionId, path: t.path.split('.').map(p => parseInt(p)) })),
          name: testRunName
        };
        
        // Add environment variables if any were set
        if (Object.keys(envVars).length > 0) {
          requestBody.envVars = envVars;
        }

        // Add per-test delays if any were collected
        if (Object.keys(testDelays).length > 0) {
          requestBody.testDelays = testDelays;
        }

        // Add global delay if captured
        if (globalDelayValue !== null) {
          requestBody.delayBetweenTests = globalDelayValue;
          console.log('[frontend] ✓ Added delayBetweenTests to request:', requestBody.delayBetweenTests, 'seconds');
        }
        
        // Log the complete request body for debugging
        console.log('[frontend] Sending test execution request with body:', JSON.stringify(requestBody, null, 2));
        
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

// Environment storage helpers (stored in localStorage per project)
function getEnvStorageKey(projectId) {
  return `qa_envs_${projectId}`;
}

function loadSavedEnvs(projectId) {
  try {
    const raw = localStorage.getItem(getEnvStorageKey(projectId));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSavedEnvs(projectId, envs) {
  localStorage.setItem(getEnvStorageKey(projectId), JSON.stringify(envs));
}

function populateEnvSelect() {
  const envSelect = document.getElementById('env-select');
  if (!envSelect) return;
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');
  const envs = loadSavedEnvs(projectId);
  envSelect.innerHTML = '<option value="">Choose environment...</option>';
  envs.forEach(env => {
    const opt = document.createElement('option');
    opt.value = env.id;
    opt.textContent = env.name;
    envSelect.appendChild(opt);
  });
  // Attach change handler (ensure not duplicated)
  envSelect.removeEventListener('change', onEnvSelected);
  envSelect.addEventListener('change', onEnvSelected);
}

function onEnvSelected(e) {
  const envId = e.target.value;
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');
  const envs = loadSavedEnvs(projectId);
  const env = envs.find(x => x.id === envId);
  if (env) {
    // Pre-fill common collection variables if present
    ['endpoint', 'version', 'ixs'].forEach(k => {
      const input = document.querySelector(`.collection-var-value[data-var-name="${k}"]`);
      if (input && env[k]) input.value = env[k];
    });

    // Also set token into env-vars if present
    if (env.token) {
      // Try to find an env-var input with key 'token' and set value
      const envKeys = Array.from(document.querySelectorAll('#env-vars-list .env-var-item'));
      for (const item of envKeys) {
        const keyInput = item.querySelector('.env-var-key');
        const valInput = item.querySelector('.env-var-value');
        if (keyInput && keyInput.value.trim().toLowerCase() === 'token') {
          if (valInput) valInput.value = env.token;
          break;
        }
      }
      // If not found, add a new env var item
      const envList = document.getElementById('env-vars-list');
      if (envList) {
        const existsToken = Array.from(envList.querySelectorAll('.env-var-key')).some(k => k.value.trim().toLowerCase() === 'token');
        if (!existsToken) {
          const newItem = document.createElement('div');
          newItem.className = 'env-var-item';
          newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
          newItem.innerHTML = `
            <input type="text" placeholder="Variable name (optional)" class="env-var-key" style="flex: 1; padding: 8px;" value="token">
            <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px;" value="${env.token}">
            <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
          `;
          envList.appendChild(newItem);
        }
      }
    }

    // Populate any other keys present in the selected environment into the optional env-vars list
    Object.keys(env).forEach(k => {
      if (k === 'id' || k === 'name') return;
      const val = env[k];
      if (val == null) return;

      // If a collection variable exists with this key, pre-fill it and show a source badge
      const collInput = document.querySelector(`.collection-var-value[data-var-name="${k}"]`);
      if (collInput && val) {
        collInput.value = val;
        const badge = collInput.closest('.collection-var-item')?.querySelector('.collection-var-source');
        if (badge) {
          badge.textContent = `from env: ${env.name}`;
          badge.style.display = 'inline';
        }
      }

      // Try to find an existing entry in env-vars list and set its value
      const envItems = Array.from(document.querySelectorAll('#env-vars-list .env-var-item'));
      let found = false;
      for (const item of envItems) {
        const keyInput = item.querySelector('.env-var-key');
        const valInput = item.querySelector('.env-var-value');
        if (keyInput && keyInput.value.trim().toLowerCase() === k.toLowerCase()) {
          if (valInput) valInput.value = val;
          found = true;
          break;
        }
      }
      if (!found) {
        const envList = document.getElementById('env-vars-list');
        if (envList) {
          const newItem = document.createElement('div');
          newItem.className = 'env-var-item';
          newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
          newItem.innerHTML = `
            <input type="text" placeholder="Variable name (optional)" class="env-var-key" style="flex: 1; padding: 8px;" value="${k}">
            <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px;" value="${val}">
            <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
          `;
          envList.appendChild(newItem);
        }
      }
    });

    // Hide any collection var source badges that are not applicable
    document.querySelectorAll('.collection-var-source').forEach(b => {
      const parent = b.closest('.collection-var-item');
      const inp = parent?.querySelector('.collection-var-value');
      if (inp && (!inp.value || inp.value.trim() === '')) {
        b.style.display = 'none';
      }
    });
  }
}

function showCreateEnvModal(existingEnv = null) {
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');

  // Gather collection variables currently shown in the modal (if any)
  const collectionVarsEls = Array.from(document.querySelectorAll('.collection-var-value'));
  const suggestedVars = {};
  collectionVarsEls.forEach(el => {
    const vn = el.getAttribute('data-var-name');
    if (vn) suggestedVars[vn] = el.value || '';
  });

  // Also include any currently visible optional env vars
  const optionalEnvEls = Array.from(document.querySelectorAll('#env-vars-list .env-var-item'));
  optionalEnvEls.forEach(item => {
    const k = (item.querySelector('.env-var-key')?.value || '').trim();
    const v = (item.querySelector('.env-var-value')?.value || '').trim();
    if (k) suggestedVars[k] = v;
  });

  const existingName = existingEnv ? (existingEnv.name || '') : '';

  const content = `
    <form id="create-env-form">
      <div class="form-group">
        <label>Name</label>
        <input id="env-name" required style="width:100%;padding:8px;margin-bottom:8px" value="${existingName}">
      </div>
      <div class="form-group">
        <label>Variables (optional)</label>
        <div id="create-env-vars-list" style="padding:8px;background:#f8f9fa;border-radius:4px;border:1px solid #ddd;">
          <!-- Vars inserted here -->
        </div>
        <div style="margin-top:8px;">
          <button type="button" class="btn btn-sm btn-secondary" id="create-env-add-var">Add Variable</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `;

  showModal(existingEnv ? `Edit Environment - ${existingEnv.name || ''}` : 'Create Environment', content);

  // Helper to add a variable row in the modal
  function addVarRow(key = '', value = '') {
    const list = document.getElementById('create-env-vars-list');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'create-env-var-item';
    div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
    div.innerHTML = `
      <input type="text" placeholder="Variable name" class="create-env-var-key" style="flex:1;padding:8px;" value="${(key||'')}">
      <input type="text" placeholder="Value" class="create-env-var-value" style="flex:1;padding:8px;" value="${(value||'')}">
      <button type="button" class="btn btn-secondary" style="padding:6px 8px;" onclick="this.closest('.create-env-var-item').remove();">Remove</button>
    `;
    list.appendChild(div);
  }

  // Pre-populate with suggested vars and existingEnv values
  const keys = new Set(Object.keys(suggestedVars));
  if (existingEnv) {
    Object.keys(existingEnv).forEach(k => {
      if (k === 'id' || k === 'name') return;
      keys.add(k);
    });
  }
  keys.forEach(k => {
    const v = existingEnv && typeof existingEnv[k] !== 'undefined' ? existingEnv[k] : suggestedVars[k] || '';
    addVarRow(k, v);
  });

  document.getElementById('create-env-add-var').addEventListener('click', () => addVarRow());

  document.getElementById('create-env-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = document.getElementById('env-name').value.trim();
    if (!name) { alert('Please provide a name'); return; }

    const envs = loadSavedEnvs(projectId);
    const id = existingEnv ? existingEnv.id : ('env-' + Date.now());

    const envObj = { id, name };

    // Collect variables from modal
    const rows = Array.from(document.querySelectorAll('.create-env-var-item'));
    rows.forEach(r => {
      const k = (r.querySelector('.create-env-var-key')?.value || '').trim();
      const v = (r.querySelector('.create-env-var-value')?.value || '').trim();
      if (k) envObj[k] = v;
    });

    // Save (replace existing if editing)
    const existingIdx = envs.findIndex(e => e.id === id);
    if (existingIdx !== -1) {
      envs[existingIdx] = envObj;
    } else {
      envs.push(envObj);
    }

    saveSavedEnvs(projectId, envs);
    hideModal();
    populateEnvSelect();

    // Select newly created/updated env
    const sel = document.getElementById('env-select');
    if (sel) {
      setTimeout(() => { sel.value = id; onEnvSelected({ target: sel }); }, 50);
    }
  });
}

function showManageEnvsModal() {
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');
  const envs = loadSavedEnvs(projectId);
  const list = envs.map(e => {
    // Build a display of all keys for clarity (mask token)
    const keys = Object.keys(e).filter(k => k !== 'id' && k !== 'name');
    const details = keys.map(k => `${k}:${k.toLowerCase() === 'token' ? '***' : (e[k] || '')}`).join(' ');
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <strong style="flex:1">${e.name}</strong>
        <div style="font-size:12px;color:#666;flex:3">${details}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-secondary edit-env" data-id="${e.id}">Edit</button>
          <button class="btn btn-sm btn-danger delete-env" data-id="${e.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('') || '<p>No environments defined.</p>';

  const content = `
    <div>${list}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-secondary" onclick="hideModal()">Close</button>
    </div>
  `;

  showModal('Manage Environments', content);

  document.querySelectorAll('.delete-env').forEach(b => {
    b.addEventListener('click', (ev) => {
      const id = ev.target.getAttribute('data-id');
      const arr = loadSavedEnvs(projectId);
      const newArr = arr.filter(x => x.id !== id);
      saveSavedEnvs(projectId, newArr);
      showManageEnvsModal();
    });
  });

  document.querySelectorAll('.edit-env').forEach(b => {
    b.addEventListener('click', (ev) => {
      const id = ev.target.getAttribute('data-id');
      const arr = loadSavedEnvs(projectId);
      const env = arr.find(x => x.id === id);
      if (env) {
        hideModal();
        // Open the create/edit modal pre-filled
        setTimeout(() => showCreateEnvModal(env), 50);
      }
    });
  });
}

// Wire up the manage/create buttons on the run modal (buttons are present when the modal is shown)
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'create-env-btn') {
    showCreateEnvModal();
  }
  if (ev.target && ev.target.id === 'manage-envs-btn') {
    showManageEnvsModal();
  }
});

// Make existing functions available globally
window.toggleEnvVars = toggleEnvVars;
window.addEnvVar = addEnvVar;
window.removeEnvVar = removeEnvVar;

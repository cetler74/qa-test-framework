// Test execution functions

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('run-tests-btn')?.addEventListener('click', showRunTestsModal);
});

let runTestsModalRestoreState = null;

function captureRunTestsModalState() {
  const form = document.getElementById('run-tests-form');
  if (!form) return null;

  const testSelectionContainer = document.getElementById('test-selection-container');
  const selectedTestsList = document.getElementById('selected-tests-list');

  return {
    testRunName: document.getElementById('test-run-name')?.value || '',
    selectedCollectionId: document.getElementById('collection-select')?.value || '',
    selectedEnvId: document.getElementById('env-select')?.value || '',
    showEnvVars: !!document.getElementById('show-env-vars')?.checked,
    delayBetweenTests: document.getElementById('delay-between-tests')?.value || '',
    collectionVars: Array.from(document.querySelectorAll('.collection-var-value')).map((input) => ({
      key: input.getAttribute('data-var-name') || '',
      value: input.value || ''
    })).filter((entry) => entry.key),
    envVars: Array.from(document.querySelectorAll('#env-vars-list .env-var-item')).map((item) => ({
      key: item.querySelector('.env-var-key')?.value || '',
      value: item.querySelector('.env-var-value')?.value || ''
    })),
    selectedTestsOrder: Array.from(document.querySelectorAll('#selected-tests-list .selected-test-item')).map((item) => ({
      collectionId: Number(item.getAttribute('data-collection-id')),
      path: item.getAttribute('data-path') || '',
      name: item.getAttribute('data-name') || '',
      method: item.getAttribute('data-method') || 'GET',
      testId: item.getAttribute('data-test-id') || ''
    })).filter((entry) => entry.path),
    expandedGroups: Array.from(document.querySelectorAll('.test-group-items')).filter((group) => group.style.display !== 'none').map((group) => group.id),
    testSelectionScrollTop: testSelectionContainer ? testSelectionContainer.scrollTop : 0,
    selectedTestsScrollTop: selectedTestsList ? selectedTestsList.scrollTop : 0
  };
}

function restoreRunTestsModalState(overrides = {}) {
  if (!runTestsModalRestoreState) {
    hideModal();
    return;
  }

  const state = { ...runTestsModalRestoreState, ...overrides };
  runTestsModalRestoreState = null;
  hideModal();
  setTimeout(() => showRunTestsModal(state), 50);
}

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
              <span class="test-item-name" style="flex: 1; min-width: 200px;">${item.name || 'Unnamed Test'}</span>
              <span class="method-badge ${method}" style="flex-shrink: 0;">${method}</span>
              <input type="number" class="test-delay-input" placeholder="Delay s" min="0" style="width:80px; padding:6px; flex-shrink: 0;" title="Delay after this test (seconds)">
            </div>
            <div class="test-item-endpoint" style="width: 100%; margin-top: 6px;">${url}</div>
          </div>
        </div>
      `;
    } else if (item.item && Array.isArray(item.item)) {
      // This is a folder/group
      const groupId = `group-${collectionId}-${pathString}`;
      const hasTests = item.item.some(i => i.request);
      
      if (hasTests) {
        html += `
          <div class="test-group" style="padding-left: ${indent}px; margin-bottom: 8px;" data-path="${pathString}">
            <div class="test-group-header" style="padding: 12px; font-size: 14px;">
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

/**
 * Extract variable names (and script-set) from a Postman-style collection.
 * Used by Run Tests modal and Create Environment modal to know which variables a collection needs.
 * Works for any collection with collection_json (Postman format), including OpenAPI-converted collections.
 * @param {{ collection_json?: object }} collection - Collection object with collection_json
 * @returns {{ userProvided: string[], scriptSet: string[], allVars: string[] }}
 */
function extractCollectionVariables(collection) {
  const allVariables = new Set();
  const scriptSetVariables = new Set();
  const collectionJson = collection?.collection_json || {};

  function addVariableName(name) {
    if (!name || typeof name !== 'string') return;
    const cleaned = name.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
    if (!cleaned) return;
    allVariables.add(cleaned);
  }

  if (collectionJson.variable && Array.isArray(collectionJson.variable)) {
    collectionJson.variable.forEach(v => {
      if (v.key) addVariableName(v.key);
    });
  }

  function extractVariablesFromString(str) {
    if (!str || typeof str !== 'string') return;
    const matches = str.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
      matches.forEach(match => {
        const varName = match.replace(/\{\{|\}\}/g, '');
        addVariableName(varName);
      });
    }
  }

  function extractVariablesFromAuth(auth) {
    if (!auth || typeof auth !== 'object') return;
    Object.keys(auth).forEach(authType => {
      const authEntries = auth[authType];
      if (!Array.isArray(authEntries)) return;
      authEntries.forEach(entry => {
        if (entry && entry.key) extractVariablesFromString(entry.key);
        if (entry && entry.value) extractVariablesFromString(entry.value);
      });
    });
  }

  function scanScriptLine(line) {
    if (typeof line !== 'string') return;
    const genericMatches = line.match(/pm\.(?:collectionVariables|environment|variables|globals)\.set\(["']([^"']+)["']/g);
    if (genericMatches) {
      genericMatches.forEach(match => {
        const varName = match.match(/["']([^"']+)["']/)[1];
        scriptSetVariables.add(varName);
      });
    }
    const getterMatches = line.match(/pm\.(?:collectionVariables|environment|variables|globals)\.get\(["']([^"']+)["']/g);
    if (getterMatches) {
      getterMatches.forEach(match => {
        const varName = match.match(/["']([^"']+)["']/)[1];
        addVariableName(varName);
      });
    }
    const altMatches = line.match(/pm\.collectionVariables\.set\([^,\n\r]+/g);
    if (altMatches) {
      altMatches.forEach(m => {
        const mm = m.match(/["']([^"']+)["']/);
        if (mm && mm[1]) scriptSetVariables.add(mm[1]);
      });
    }
  }

  function extractScriptSetVariablesFromEvents(events) {
    if (!events || !Array.isArray(events)) return;
    events.forEach(event => {
      if (!event?.script?.exec) return;
      const scriptLines = Array.isArray(event.script.exec) ? event.script.exec : [event.script.exec];
      scriptLines.forEach(scanScriptLine);
    });
  }

  function extractScriptSetVariables(items) {
    if (!items || !Array.isArray(items)) return;
    items.forEach(item => {
      extractScriptSetVariablesFromEvents(item.event);
      if (item.item && Array.isArray(item.item)) extractScriptSetVariables(item.item);
    });
  }

  extractVariablesFromAuth(collectionJson.auth);
  extractScriptSetVariablesFromEvents(collectionJson.event);

  function searchItems(items) {
    if (!items || !Array.isArray(items)) return;
    items.forEach(item => {
      if (item.request) {
        if (item.request.url) {
          if (typeof item.request.url === 'string') extractVariablesFromString(item.request.url);
          else if (item.request.url.raw) extractVariablesFromString(item.request.url.raw);
          else if (item.request.url.host) {
            if (Array.isArray(item.request.url.host)) item.request.url.host.forEach(h => extractVariablesFromString(h));
            else extractVariablesFromString(item.request.url.host);
          }
          if (item.request.url.path && Array.isArray(item.request.url.path)) {
            item.request.url.path.forEach(p => extractVariablesFromString(p));
          }
          if (item.request.url.query && Array.isArray(item.request.url.query)) {
            item.request.url.query.forEach(q => {
              if (q && q.key) extractVariablesFromString(q.key);
              if (q && q.value) extractVariablesFromString(q.value);
            });
          }
          if (item.request.url.variable && Array.isArray(item.request.url.variable)) {
            item.request.url.variable.forEach(v => {
              if (v && v.key) addVariableName(v.key);
              if (v && v.value) extractVariablesFromString(v.value);
            });
          }
        }
        if (item.request.header && Array.isArray(item.request.header)) {
          item.request.header.forEach(h => {
            if (h && h.key) extractVariablesFromString(h.key);
            if (h && h.value) extractVariablesFromString(h.value);
          });
        }
        if (item.request.body) {
          if (typeof item.request.body === 'string') extractVariablesFromString(item.request.body);
          else if (item.request.body.raw) extractVariablesFromString(item.request.body.raw);
          if (item.request.body.urlencoded && Array.isArray(item.request.body.urlencoded)) {
            item.request.body.urlencoded.forEach(f => {
              if (f && f.key) extractVariablesFromString(f.key);
              if (f && f.value) extractVariablesFromString(f.value);
            });
          }
          if (item.request.body.formdata && Array.isArray(item.request.body.formdata)) {
            item.request.body.formdata.forEach(f => {
              if (f && f.key) extractVariablesFromString(f.key);
              if (f && f.value) extractVariablesFromString(f.value);
            });
          }
          if (item.request.body.graphql && item.request.body.graphql.variables) {
            if (typeof item.request.body.graphql.variables === 'string') {
              extractVariablesFromString(item.request.body.graphql.variables);
            }
          }
        }
        extractVariablesFromAuth(item.request.auth);
      }
      if (item.item && Array.isArray(item.item)) searchItems(item.item);
    });
  }

  searchItems(collectionJson.item);
  extractScriptSetVariables(collectionJson.item);

  const envAllowedLower = new Set(['token', 'endpoint', 'version', 'ixs', 'ixs2']);
  const assumedScriptVarsLower = new Set(['alertid', 'msisdn', 'msisdn2', 'user', 'ixs2']);
  const scriptSetLower = new Set(Array.from(scriptSetVariables).map(v => v.toLowerCase()));
  assumedScriptVarsLower.forEach(v => scriptSetLower.add(v));
  const userProvided = Array.from(allVariables).filter(v => {
    const vl = v.toLowerCase();
    if (scriptSetLower.has(vl)) return false;
    if (envAllowedLower.has(vl)) return false;
    return true;
  });

  return {
    userProvided: userProvided.sort(),
    scriptSet: Array.from(scriptSetVariables).sort(),
    allVars: Array.from(allVariables).sort()
  };
}

// Show Run Tests Modal
function showRunTestsModal(initialState = null) {
  const projectId = document.getElementById('run-tests-btn').getAttribute('data-project-id');
  
  if (!projectId) {
    alert('Please select a project first');
    return;
  }
  
  // Load project collections
  apiRequest(`/projects/${projectId}/collections`).then(collections => {
    if (collections.length === 0) {
      alert('No collections available in this project. Add an OpenAPI (YAML/JSON) spec to the project or upload a Postman collection. WSDL specs are used for SOAP runs, not for this API collection run.');
      return;
    }
    
    // Step 1: Collection Selection
    const collectionOptions = collections.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join('');
    
    const content = `
      <form id="run-tests-form" style="display: flex; flex-direction: column; height: 100%;">
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="test-run-name">Test Run Name *</label>
          <input type="text" id="test-run-name" placeholder="e.g., Release 1.0" required style="width: 100%; padding: 10px; font-size: 14px;">
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="collection-select">Select API Collection *</label>
          <select id="collection-select" required style="width: 100%; padding: 10px; border: 2px solid var(--color-primary, #14b8a6); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937); font-size: 14px;">
            <option value="">Choose a collection...</option>
            ${collectionOptions}
          </select>
          <p style="font-size: 12px; color: var(--color-text-secondary, #6b7280); margin-top: 6px;">Collections come from <strong>OpenAPI specs</strong> in this project (one collection per spec) or from <strong>uploaded Postman collections</strong>. For <strong>WSDL/SOAP</strong> specs, use the SOAP run option instead.</p>
        </div>
        <div class="form-group" id="test-selection-section" style="display: none; flex: 1; flex-direction: column; min-height: 0;">
          <label style="margin-bottom: 12px; display: block;">Select Tests to Run</label>
          <div style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-secondary" id="select-all-tests">Select All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="deselect-all-tests">Deselect All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="expand-all-groups">Expand All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="collapse-all-groups">Collapse All</button>
          </div>
          <div id="test-selection-container" style="max-height: 600px; overflow-y: auto; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; padding: 15px; background: var(--color-gray-50, #fafafa);">
            <!-- Tests will be loaded here -->
          </div>
          <div id="selected-tests-order" style="margin-top: 15px; flex-shrink: 0;">
            <label style="margin-bottom: 8px; display: block;">Selected Tests Order (drag to reorder):</label>
            <div id="selected-tests-list" style="min-height: 80px; max-height: 200px; overflow-y: auto; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; padding: 12px; background: var(--color-white, white); margin-top: 5px;">
              <p style="color: var(--color-text-secondary, #6b7280); font-style: italic; margin: 0;">No tests selected</p>
            </div>
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 20px; flex-shrink: 0;">
          <label for="env-select">Select Environment (optional)</label>
          <div style="display:flex; gap:10px; align-items: center;">
            <select id="env-select" style="flex: 1; padding:8px; border:2px solid var(--color-primary, #14b8a6); border-radius:4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);">
              <option value="">Choose environment...</option>
            </select>
            <button type="button" class="btn btn-sm btn-secondary" id="manage-envs-btn">Manage</button>
            <button type="button" class="btn btn-sm btn-secondary" id="create-env-btn">Create</button>
          </div>
          <p style="font-size:12px; color: var(--color-text-secondary, #6b7280); margin-top:6px;">Environments store values for <code>{{endpoint}}</code>, <code>{{version}}</code> and <code>{{ixs}}</code>. Selecting one will pre-fill these variables.</p>
        </div>

        <div class="form-group" id="collection-vars-section" style="display: none;">
          <label>Collection Variables *</label>
          <p style="font-size: 12px; color: var(--color-text-secondary, #6b7280); margin-bottom: 10px;">
            These variables are required by the selected collection. Please provide values for all variables.
          </p>
          <div id="collection-vars-list" style="padding: 15px; background: var(--color-gray-50, #f8f9fa); border-radius: 4px; border: 1px solid var(--color-gray-300, #ddd);">
            <!-- Collection variables will be populated here -->
          </div>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="show-env-vars" onchange="toggleEnvVars()">
            Configure Additional Environment Variables (Optional)
          </label>
          <div id="env-vars-section" style="display: none; margin-top: 10px; padding: 15px; background: var(--color-gray-50, #f8f9fa); border-radius: 4px;">
            <p style="font-size: 12px; color: var(--color-text-secondary, #6b7280); margin-bottom: 10px;">
              Set additional environment variables that will override collection variables during test execution.
            </p>
            <div id="env-vars-list">
              <div class="env-var-item" style="display: flex; gap: 10px; margin-bottom: 10px;">
                <input type="text" placeholder="Variable name" class="env-var-key" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);">
                <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);">
                <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
              </div>
            </div>
            <button type="button" class="btn btn-secondary" onclick="addEnvVar()" style="margin-top: 10px;">Add Variable</button>
          </div>
        </div>
        <div class="form-group">
          <label for="delay-between-tests">Delay between tests (seconds)</label>
          <input type="number" id="delay-between-tests" min="0" placeholder="e.g., 2" style="width: 120px; padding: 6px; border: 2px solid var(--color-primary, #14b8a6);">
          <p style="font-size:12px; color: var(--color-text-secondary, #6b7280); margin-top:6px;">If set, waits this many seconds before running the next test. Per-test delays override this value.</p>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--color-gray-200, #e5e7eb); flex-shrink: 0;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run Tests</button>
        </div>
      </form>
    `;
    
    showModal('Run Tests', content);
    populateEnvSelect();

    if (initialState?.testRunName) {
      document.getElementById('test-run-name').value = initialState.testRunName;
    }

    if (typeof initialState?.delayBetweenTests !== 'undefined' && initialState?.delayBetweenTests !== null) {
      document.getElementById('delay-between-tests').value = initialState.delayBetweenTests;
    }

    if (initialState?.selectedEnvId) {
      const envSelect = document.getElementById('env-select');
      if (envSelect) envSelect.value = initialState.selectedEnvId;
    }
    
    let selectedCollection = null;
    let selectedTestsOrder = []; // Array of {collectionId, path, name, method, testId}
    let testIdCounter = 1; // Counter for generating unique test IDs

    function setOptionalEnvVarRows(rows = []) {
      const envList = document.getElementById('env-vars-list');
      if (!envList) return;
      envList.innerHTML = '';
      rows.forEach((row) => {
        const newItem = document.createElement('div');
        newItem.className = 'env-var-item';
        newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
        newItem.innerHTML = `
          <input type="text" placeholder="Variable name" class="env-var-key" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);" value="${String(row.key || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">
          <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);" value="${String(row.value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">
          <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
        `;
        envList.appendChild(newItem);
      });

      if (rows.length === 0) {
        const newItem = document.createElement('div');
        newItem.className = 'env-var-item';
        newItem.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px;';
        newItem.innerHTML = `
          <input type="text" placeholder="Variable name" class="env-var-key" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);">
          <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 1px solid var(--color-gray-300, #ddd); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937);">
          <button type="button" class="btn btn-secondary" onclick="removeEnvVar(this)" style="padding: 8px 12px;">Remove</button>
        `;
        envList.appendChild(newItem);
      }
    }

    function restoreSelectedTestsFromState() {
      if (!initialState || String(initialState.selectedCollectionId || '') !== String(selectedCollection?.id || '')) return;

      selectedTestsOrder = (initialState.selectedTestsOrder || []).map((test) => ({
        collectionId: Number(test.collectionId),
        path: test.path,
        name: test.name,
        method: test.method,
        testId: test.testId
      }));

      selectedTestsOrder.forEach((test) => {
        const checkbox = document.querySelector(`.test-checkbox[data-collection-id="${test.collectionId}"][data-path="${test.path}"]`);
        if (checkbox) checkbox.checked = true;
      });

      const maxExistingTestId = selectedTestsOrder.reduce((maxValue, test) => {
        const match = String(test.testId || '').match(/TEST-(\d+)/i);
        return match ? Math.max(maxValue, Number(match[1])) : maxValue;
      }, 0);
      testIdCounter = maxExistingTestId + 1;
      updateSelectedTestsList();

      (initialState.collectionVars || []).forEach((entry) => {
        const input = document.querySelector(`.collection-var-value[data-var-name="${entry.key}"]`);
        if (input) input.value = entry.value || '';
      });

      const showEnvVarsCheckbox = document.getElementById('show-env-vars');
      if (showEnvVarsCheckbox) {
        showEnvVarsCheckbox.checked = !!initialState.showEnvVars;
        toggleEnvVars();
      }

      setOptionalEnvVarRows(initialState.envVars || []);

      if (initialState.selectedEnvId) {
        const envSelect = document.getElementById('env-select');
        if (envSelect) envSelect.value = initialState.selectedEnvId;
      }

      (initialState.expandedGroups || []).forEach((groupId) => {
        const groupContainer = document.getElementById(groupId);
        if (!groupContainer) return;
        groupContainer.style.display = 'block';
        const toggleBtn = document.querySelector(`.toggle-group[data-group-id="${groupId}"]`);
        if (toggleBtn) toggleBtn.textContent = 'Collapse';
      });

      const testSelectionContainer = document.getElementById('test-selection-container');
      if (testSelectionContainer) testSelectionContainer.scrollTop = Number(initialState.testSelectionScrollTop || 0);
      const selectedTestsList = document.getElementById('selected-tests-list');
      if (selectedTestsList) selectedTestsList.scrollTop = Number(initialState.selectedTestsScrollTop || 0);

      initialState = null;
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
                     style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6); border-radius: 4px;">
              <span class="collection-var-source" style="font-size:12px;color:#1976d2;margin-left:8px;display:none;"></span>
            </div>
          `;
        }).join('');
        
        // Add info about script-set variables if any
        let scriptVarsInfo = '';
        if (collectionVars.scriptSet && collectionVars.scriptSet.length > 0) {
          scriptVarsInfo = `
            <div style="margin-top: 15px; padding: 10px; background: var(--color-info, #3b82f6); background-opacity: 0.1; border-radius: 4px; font-size: 12px; color: var(--color-info, #3b82f6);">
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
      document.getElementById('test-selection-section').style.display = 'flex';
      selectedTestsOrder = [];
      testIdCounter = 1; // Reset test ID counter when selecting a new collection
      updateSelectedTestsList();
      
      // Setup event listeners for groups and tests
      setupTestSelectionHandlers(collectionId);
      restoreSelectedTestsFromState();
    });

    if (initialState?.selectedCollectionId) {
      const collectionSelect = document.getElementById('collection-select');
      collectionSelect.value = initialState.selectedCollectionId;
      collectionSelect.dispatchEvent(new Event('change'));
    }
    
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
          const testId = `TEST-${testIdCounter++}`;
          selectedTestsOrder.push({
            collectionId: collectionId,
            path: path,
            name: name,
            method: method,
            testId: testId
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
        listContainer.innerHTML = '<p style="color: var(--color-text-secondary, #6b7280); font-style: italic;">No tests selected</p>';
        return;
      }
      
      listContainer.innerHTML = selectedTestsOrder.map((test, index) => `
        <div class="selected-test-item" data-index="${index}" data-collection-id="${test.collectionId}" data-path="${test.path}" data-name="${String(test.name || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" data-method="${String(test.method || 'GET').replace(/"/g, '&quot;')}" data-test-id="${String(test.testId || `TEST-${index + 1}`).replace(/"/g, '&quot;')}" style="display: flex; align-items: center; padding: 8px; margin: 5px 0; background: var(--color-gray-100, #f0f0f0); border-radius: 4px; cursor: move; border: 1px solid var(--color-gray-200, #e5e7eb);">
          <span style="margin-right: 10px; font-weight: bold; color: #14b8a6;">${test.testId || `TEST-${index + 1}`}</span>
          <span class="method-badge ${test.method}">${test.method}</span>
          <span style="flex: 1; margin-left: 10px; color: var(--color-text-primary, #1f2937);">${test.name}</span>
          <button type="button" class="btn btn-sm btn-secondary move-up" data-index="${index}" style="padding: 4px 10px; margin: 0 2px; background: var(--color-gray-300, #d1d5db); color: var(--color-text-primary, #1f2937); border: 1px solid var(--color-gray-400, #9ca3af); border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 32px;">↑</button>
          <button type="button" class="btn btn-sm btn-secondary move-down" data-index="${index}" style="padding: 4px 10px; margin: 0 2px; background: var(--color-gray-300, #d1d5db); color: var(--color-text-primary, #1f2937); border: 1px solid var(--color-gray-400, #9ca3af); border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 32px;">↓</button>
          <button type="button" class="btn btn-sm btn-danger remove-test" data-index="${index}" style="padding: 4px 10px; margin-left: 5px; background: var(--color-error, #ef4444); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; min-width: 32px;">×</button>
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
      
      // Show loading with progress tracking
      const loadingContent = `
        <div class="loading" style="text-align: center; padding: 20px;">
          <h3>Running Tests...</h3>
          <div id="test-progress-info" style="margin: 20px 0;">
            <p id="test-progress-text">Initializing test execution...</p>
            <div style="width: 100%; background: var(--color-gray-200, #e5e7eb); border-radius: 10px; height: 24px; margin: 15px 0; overflow: hidden;">
              <div id="test-progress-bar" style="width: 0%; background: var(--color-primary, #14b8a6); height: 100%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;">0%</div>
            </div>
            <p id="test-current-test" style="font-size: 14px; color: var(--color-text-secondary, #6b7280); margin-top: 10px;"></p>
          </div>
        </div>
      `;
      showModal('Running Tests', loadingContent);
      
      try {
        const requestBody = {
          projectId: parseInt(projectId),
          selectedTests: selectedTests, // Format: { collectionId: [[path1], [path2], ...] }
          // Preserve the exact order of selected tests across collections so backend can execute in this sequence
          selectedTestsOrdered: selectedTestsOrder.map(t => ({ 
            collectionId: t.collectionId, 
            path: t.path.split('.').map(p => parseInt(p)),
            testId: t.testId || `TEST-${selectedTestsOrder.indexOf(t) + 1}`
          })),
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
        
        const testRunId = result.testRun.id;
        console.log('[frontend] Starting progress polling for test run:', testRunId);
        hideModal();
        showView('test-runs');
        loadTestRuns();
        
        // Poll immediately first time, then every second
        const pollProgress = async () => {
          try {
            const testRun = await apiRequest(`/test-runs/${testRunId}`);
            const totalTests = testRun.total_tests || 0;
            const completedTests = (testRun.passed_tests || 0) + (testRun.failed_tests || 0);
            const progress = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;
            
            console.log('[frontend] Progress update:', { totalTests, completedTests, progress, status: testRun.status, passed: testRun.passed_tests, failed: testRun.failed_tests });
            
            // Update progress bar - try to find elements in modal
            const modalBody = document.getElementById('modal-body');
            if (!modalBody) {
              console.warn('[frontend] Modal body not found');
              return;
            }
            
            const progressBar = document.getElementById('test-progress-bar');
            const progressText = document.getElementById('test-progress-text');
            const currentTestText = document.getElementById('test-current-test');
            
            if (!progressBar || !progressText) {
              console.warn('[frontend] Progress elements not found in DOM. Modal body exists:', !!modalBody);
              // Try to find by querySelector as fallback
              const bar = modalBody.querySelector('#test-progress-bar');
              const text = modalBody.querySelector('#test-progress-text');
              if (bar && text) {
                bar.style.width = `${progress}%`;
                bar.textContent = `${progress}%`;
                text.textContent = `Progress: ${completedTests} of ${totalTests} tests completed`;
                const currentText = modalBody.querySelector('#test-current-test');
                if (currentText) {
                  const passed = testRun.passed_tests || 0;
                  const failed = testRun.failed_tests || 0;
                  if (completedTests < totalTests) {
                    currentText.textContent = `Running... (${passed} passed, ${failed} failed)`;
                  } else {
                    currentText.textContent = `Completed: ${passed} passed, ${failed} failed`;
                  }
                }
              }
              return;
            }
            
            progressBar.style.width = `${progress}%`;
            progressBar.textContent = `${progress}%`;
            progressText.textContent = `Progress: ${completedTests} of ${totalTests} tests completed`;
            
            // Show passed/failed counts
            const passed = testRun.passed_tests || 0;
            const failed = testRun.failed_tests || 0;
            if (currentTestText) {
              if (completedTests < totalTests) {
                currentTestText.textContent = `Running... (${passed} passed, ${failed} failed)`;
              } else {
                currentTestText.textContent = `Completed: ${passed} passed, ${failed} failed`;
              }
            }
            
            // Check if execution is complete
            if (testRun.status !== 'running') {
              if (pollInterval) {
                clearInterval(pollInterval);
              }
              if (window.currentTestPollInterval) {
                clearInterval(window.currentTestPollInterval);
                delete window.currentTestPollInterval;
              }
              hideModal();
              
              const passed = testRun.passed_tests || 0;
              const failed = testRun.failed_tests || 0;
              alert(`Tests completed! ${passed} passed, ${failed} failed.`);
              
              // Navigate to test runs view
              showView('test-runs');
              loadTestRuns();
            }
          } catch (pollError) {
            console.error('Error polling test progress:', pollError);
            // Continue polling even if one request fails
          }
        };
        
        // Poll immediately, then every second
        pollProgress();
        const pollInterval = setInterval(pollProgress, 1000);
        
        // Store interval ID so we can clear it if needed
        window.currentTestPollInterval = pollInterval;
        
        // Set timeout to stop polling after 10 minutes (safety measure)
        setTimeout(() => {
          if (pollInterval) {
            clearInterval(pollInterval);
            delete window.currentTestPollInterval;
          }
        }, 600000);
        
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
      <input type="text" placeholder="Variable name (e.g., bearer_token)" class="env-var-key" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);">
      <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);">
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

/**
 * Merge a saved environment (by id) into base env vars — same rules as Run API Tests when env-select is set.
 * @param {string|number} projectId
 * @param {string} [envId] - saved environment id from loadSavedEnvs, or empty
 * @param {Record<string, string>} [baseEnv]
 * @returns {Record<string, string>}
 */
function mergeSavedEnvironmentIntoEnvVars(projectId, envId, baseEnv = {}) {
  const out = { ...(baseEnv && typeof baseEnv === 'object' ? baseEnv : {}) };
  if (!envId) return out;
  const savedEnvs = loadSavedEnvs(projectId);
  const selectedEnv = savedEnvs.find((e) => e.id === envId);
  if (!selectedEnv) return out;
  Object.keys(selectedEnv).forEach((k) => {
    if (k === 'id' || k === 'name') return;
    const v = selectedEnv[k];
    if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '') {
      out[k] = v;
    }
  });
  return out;
}

if (typeof window !== 'undefined') {
  window.getProjectSavedEnvironments = loadSavedEnvs;
  window.mergeSavedEnvironmentIntoEnvVars = mergeSavedEnvironmentIntoEnvVars;
  window.extractCollectionVariables = extractCollectionVariables;
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
            <input type="text" placeholder="Variable name (optional)" class="env-var-key" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);" value="token">
            <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);" value="${env.token}">
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
            <input type="text" placeholder="Variable name (optional)" class="env-var-key" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);" value="${k}">
            <input type="text" placeholder="Value" class="env-var-value" style="flex: 1; padding: 8px; border: 2px solid var(--color-primary, #14b8a6);" value="${val}">
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
  const runBtn = document.getElementById('run-tests-btn');
  const projectId = runBtn ? runBtn.getAttribute('data-project-id') : null;

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
  const escapedName = (existingName || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const content = `
    <form id="create-env-form">
      <div class="form-group">
        <label>Name</label>
        <input id="env-name" required style="width:100%;padding:8px;margin-bottom:8px;border:2px solid var(--color-primary, #14b8a6);" value="${escapedName}">
      </div>
      <div class="form-group" id="create-env-prefill-group">
        <label for="create-env-prefill-select">Pre-fill variables from (optional)</label>
        <select id="create-env-prefill-select" style="width:100%;padding:8px;margin-bottom:6px;border:2px solid var(--color-primary, #14b8a6);border-radius:4px;background: var(--color-white, white);color: var(--color-text-primary, #1f2937);">
          <option value="">None</option>
        </select>
        <p style="font-size:12px;color: var(--color-text-secondary, #6b7280);margin-top:4px;">Select a collection to pre-fill the variable names it needs (REST/Postman/OpenAPI). Select an environment to copy its variables. For SOAP (WSDL), add variables like <code>endpoint</code> manually or copy from an environment.</p>
      </div>
      <div class="form-group">
        <label>Variables (optional)</label>
        <div id="create-env-vars-list" style="padding:8px;background: var(--color-gray-50, #f8f9fa);border-radius:4px;border:1px solid var(--color-gray-300, #ddd);">
          <!-- Vars inserted here -->
        </div>
        <div style="margin-top:8px;">
          <button type="button" class="btn btn-sm btn-secondary" id="create-env-add-var">Add Variable</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button type="button" class="btn btn-secondary" id="create-env-cancel-btn">Cancel</button>
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
    const safeKey = (key || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeVal = (value || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    div.innerHTML = `
      <input type="text" placeholder="Variable name" class="create-env-var-key" style="flex:1;padding:8px;border:2px solid var(--color-primary, #14b8a6);" value="${safeKey}">
      <input type="text" placeholder="Value" class="create-env-var-value" style="flex:1;padding:8px;border:2px solid var(--color-primary, #14b8a6);" value="${safeVal}">
      <button type="button" class="btn btn-secondary" style="padding:6px 8px;" onclick="this.closest('.create-env-var-item').remove();">Remove</button>
    `;
    list.appendChild(div);
  }

  // Clear variable list and repopulate with key/value pairs
  function setVarRows(varsObj) {
    const list = document.getElementById('create-env-vars-list');
    if (!list) return;
    list.innerHTML = '';
    const keys = Object.keys(varsObj || {});
    keys.forEach(k => addVarRow(k, varsObj[k]));
  }

  const prefillSelect = document.getElementById('create-env-prefill-select');
  let projectCollections = [];

  // Populate pre-fill dropdown and apply selection
  function initPrefillDropdown() {
    if (!prefillSelect) return;
    const envs = projectId ? loadSavedEnvs(projectId) : [];
    let html = '<option value="">None</option>';
    if (projectCollections.length > 0) {
      html += '<optgroup label="From collection">';
      projectCollections.forEach(c => {
        const name = (c.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<option value="coll-${c.id}">${name}</option>`;
      });
      html += '</optgroup>';
    }
    if (envs.length > 0) {
      html += '<optgroup label="From environment">';
      envs.forEach(e => {
        const name = (e.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<option value="env-${e.id}">${name}</option>`;
      });
      html += '</optgroup>';
    }
    prefillSelect.innerHTML = html;
  }

  prefillSelect.addEventListener('change', () => {
    const val = prefillSelect.value;
    if (!val) {
      // Restore suggested + existing env vars
      const keys = new Set(Object.keys(suggestedVars));
      if (existingEnv) {
        Object.keys(existingEnv).forEach(k => { if (k !== 'id' && k !== 'name') keys.add(k); });
      }
      const obj = {};
      keys.forEach(k => { obj[k] = existingEnv && existingEnv[k] !== undefined ? existingEnv[k] : suggestedVars[k] || ''; });
      setVarRows(obj);
      return;
    }
    if (val.startsWith('coll-')) {
      const id = val.replace('coll-', '');
      const coll = projectCollections.find(c => String(c.id) === String(id));
      if (!coll || !coll.collection_json) {
        setVarRows({});
        return;
      }
      const extracted = extractCollectionVariables(coll);
      const names = extracted.allVars || [];
      const cj = coll.collection_json || {};
      const defaults = {};
      if (cj.variable && Array.isArray(cj.variable)) {
        cj.variable.forEach(v => { if (v.key) defaults[v.key] = v.value != null ? v.value : ''; });
      }
      const obj = {};
      names.forEach(n => { obj[n] = defaults[n] != null ? defaults[n] : ''; });
      setVarRows(obj);
      return;
    }
    if (val.startsWith('env-')) {
      const id = val.replace('env-', '');
      const envs = projectId ? loadSavedEnvs(projectId) : [];
      const env = envs.find(e => e.id === id);
      if (!env) return;
      const obj = {};
      Object.keys(env).forEach(k => { if (k !== 'id' && k !== 'name') obj[k] = env[k] != null ? env[k] : ''; });
      setVarRows(obj);
    }
  });

  // Pre-populate with suggested vars and existingEnv values
  const keys = new Set(Object.keys(suggestedVars));
  if (existingEnv) {
    Object.keys(existingEnv).forEach(k => {
      if (k === 'id' || k === 'name') return;
      keys.add(k);
    });
  }
  const initialVars = {};
  keys.forEach(k => {
    initialVars[k] = existingEnv && typeof existingEnv[k] !== 'undefined' ? existingEnv[k] : suggestedVars[k] || '';
  });
  setVarRows(initialVars);

  // Load project collections and build pre-fill dropdown
  if (projectId) {
    apiRequest(`/projects/${projectId}/collections`).then(collections => {
      projectCollections = collections || [];
      initPrefillDropdown();
    }).catch(() => {
      initPrefillDropdown();
    });
  } else {
    initPrefillDropdown();
  }

  document.getElementById('create-env-add-var').addEventListener('click', () => addVarRow());

  document.getElementById('create-env-cancel-btn').addEventListener('click', () => {
    if (runTestsModalRestoreState) {
      restoreRunTestsModalState();
      return;
    }
    hideModal();
  });

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
    if (runTestsModalRestoreState) {
      restoreRunTestsModalState({ selectedEnvId: id });
    } else {
      hideModal();
      populateEnvSelect();

      // Select newly created/updated env
      const sel = document.getElementById('env-select');
      if (sel) {
        setTimeout(() => { sel.value = id; onEnvSelected({ target: sel }); }, 50);
      }
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
        <div style="font-size:12px;color: var(--color-text-secondary, #6b7280);flex:3">${details}</div>
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
      <button class="btn btn-secondary" id="manage-envs-close-btn">Close</button>
    </div>
  `;

  showModal('Manage Environments', content);

  document.getElementById('manage-envs-close-btn').addEventListener('click', () => {
    if (runTestsModalRestoreState) {
      restoreRunTestsModalState();
      return;
    }
    hideModal();
  });

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
    runTestsModalRestoreState = captureRunTestsModalState();
    showCreateEnvModal();
  }
  if (ev.target && ev.target.id === 'manage-envs-btn') {
    runTestsModalRestoreState = captureRunTestsModalState();
    showManageEnvsModal();
  }
});

// Make existing functions available globally
window.toggleEnvVars = toggleEnvVars;
window.addEnvVar = addEnvVar;
window.removeEnvVar = removeEnvVar;

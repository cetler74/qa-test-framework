// UI Tests (Playwright) – list, run form, detail, report (scoped to avoid duplicate globals)
(function () {
  const API_BASE = '/api';

  function isServerUnavailable(err) {
    const msg = (err && err.message) ? String(err.message).toLowerCase() : '';
    return msg.includes('failed to fetch') || msg.includes('network error') || msg.includes('connection refused');
  }

  function serverUnavailableMessage() {
    return 'Server unavailable. Make sure the backend is running: in the project folder run <code>npm run dev</code> or <code>npm start</code>, then refresh this page.';
  }

  async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = { headers: { 'Content-Type': 'application/json', ...options.headers }, ...options };
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
  }

  function formatDateTime(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}, ${d.toLocaleTimeString()}`;
  }

  function showView(viewId) {
  const activeEl = document.querySelector('.view.active');
  const currentId = activeEl && activeEl.id ? activeEl.id.replace(/-view$/, '') : null;
  if (currentId && currentId !== viewId) {
    window._uiTestsReturnView = currentId;
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`${viewId}-view`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const navBtn = document.querySelector(`[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
  }

  function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
  }

  function hideModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }

  async function loadPlaywrightRuns() {
  const listEl = document.getElementById('playwright-runs-list');
  if (!listEl) return;
  try {
    const runs = await apiRequest('/playwright-runs');
    if (runs.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <h3>No UI test runs yet</h3>
          <p>Click "Run UI Tests" to run Playwright tests against your configured URL</p>
        </div>
      `;
    } else {
      listEl.innerHTML = runs.map(run => `
        <div class="list-item" onclick="viewPlaywrightRun(${run.id})" style="cursor: pointer;">
          <div class="list-item-info">
            <h3>${run.name}</h3>
            <p>${run.base_url || ''} • ${formatDateTime(run.created_at)}</p>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">
              ${run.passed_tests != null ? run.passed_tests : '-'} passed, ${run.failed_tests != null ? run.failed_tests : '-'} failed of ${run.total_tests != null ? run.total_tests : '-'} total
            </p>
          </div>
          <span class="status-badge ${run.status}">${run.status === 'partial_failed' ? 'Partial Failed' : run.status}</span>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading Playwright runs:', err);
    const isUnavailable = isServerUnavailable(err);
    const content = isUnavailable
      ? serverUnavailableMessage()
      : 'Error loading UI test runs: ' + escapeHtml(err.message);
    listEl.innerHTML = `<div class="empty-state"><p>${content}</p></div>`;
  }
}

  let testList = [];
  const UI_TEST_VARIABLES_STORAGE_KEY = 'qa_ui_test_variable_groups';

  function extractUiVariableNamesFromSpecText(specContent) {
    if (!specContent || typeof specContent !== 'string') return [];
    const names = new Set();
    const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    let match;
    while ((match = re.exec(specContent)) !== null) {
      if (match[1]) names.add(match[1]);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function normalizeUiVariableKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return '';
    const tokenMatch = raw.match(/^\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}$/);
    if (tokenMatch) return tokenMatch[1];
    return raw;
  }

  function loadSavedUiTestVariableGroups() {
    try {
      const raw = localStorage.getItem(UI_TEST_VARIABLES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((group) => group && group.id && group.name) : [];
    } catch (_) {
      return [];
    }
  }

  function saveUiTestVariableGroups(groups) {
    localStorage.setItem(UI_TEST_VARIABLES_STORAGE_KEY, JSON.stringify(Array.isArray(groups) ? groups : []));
  }

  function getSavedUiTestVariableGroupById(groupId) {
    if (!groupId) return null;
    return loadSavedUiTestVariableGroups().find((item) => item.id === groupId) || null;
  }

  function mergeSavedUiTestVariableGroup(groupId, baseValues = {}) {
    const merged = { ...(baseValues && typeof baseValues === 'object' ? baseValues : {}) };
    if (!groupId) return merged;
    const group = loadSavedUiTestVariableGroups().find((item) => item.id === groupId);
    if (!group || !group.variables || typeof group.variables !== 'object') return merged;

    const resolved = {};
    const groupEntries = Object.entries(group.variables || {});
    const groupByLower = new Map(groupEntries.map(([key, value]) => [String(key || '').trim().toLowerCase(), value]));
    const baseEntries = Object.entries(merged || {});

    groupEntries.forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return;
      resolved[normalizedKey] = value == null ? '' : String(value);
    });

    baseEntries.forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return;
      const currentValue = value == null ? '' : String(value);
      const matchingGroupValue = groupByLower.get(normalizedKey.toLowerCase());
      if (currentValue.trim() !== '') {
        resolved[normalizedKey] = currentValue;
      } else if (matchingGroupValue != null && typeof resolved[normalizedKey] === 'undefined') {
        resolved[normalizedKey] = String(matchingGroupValue);
      } else if (typeof resolved[normalizedKey] === 'undefined') {
        resolved[normalizedKey] = currentValue;
      }
    });

    return resolved;
  }

  function resolveUiVariableValues(variableNames, groupId, currentValues = {}) {
    const resolved = {};
    const group = getSavedUiTestVariableGroupById(groupId);
    const groupEntries = group && group.variables && typeof group.variables === 'object'
      ? Object.entries(group.variables)
      : [];
    const groupByLower = new Map(groupEntries.map(([key, value]) => [normalizeUiVariableKey(key).toLowerCase(), value == null ? '' : String(value)]));

    (Array.isArray(variableNames) ? variableNames : []).forEach((name) => {
      const normalizedName = normalizeUiVariableKey(name);
      if (!normalizedName) return;
      const currentValue = currentValues && Object.prototype.hasOwnProperty.call(currentValues, normalizedName)
        ? String(currentValues[normalizedName] == null ? '' : currentValues[normalizedName])
        : '';
      if (currentValue.trim() !== '') {
        resolved[normalizedName] = currentValue;
        return;
      }
      resolved[normalizedName] = groupByLower.get(normalizedName.toLowerCase()) || '';
    });

    return resolved;
  }

  function getUiVariableNamesForTests(tests) {
    return Array.from(new Set((tests || []).flatMap((test) => Array.isArray(test.variable_names) ? test.variable_names : [])))
      .sort((a, b) => a.localeCompare(b));
  }

  function populateUiVariableGroupSelect(selectEl, selectedId = '') {
    if (!selectEl) return;
    const groups = loadSavedUiTestVariableGroups();
    selectEl.innerHTML = '<option value="">None</option>' + groups.map((group) => (
      `<option value="${escapeHtml(String(group.id))}">${escapeHtml(group.name || '')}</option>`
    )).join('');
    selectEl.value = groups.some((group) => group.id === selectedId) ? selectedId : '';
  }

  function collectUiVariableInputValues(containerEl, selector = '.ui-test-variable-value') {
    if (!containerEl) return {};
    const values = {};
    containerEl.querySelectorAll(selector).forEach((input) => {
      const key = input.getAttribute('data-var-name');
      if (!key) return;
      values[key] = input.value || '';
    });
    return values;
  }

  function renderUiVariableInputs(containerEl, variableNames, values = {}, options = {}) {
    if (!containerEl) return;
    const inputClass = options.inputClass || 'ui-test-variable-value';
    const emptyMessage = options.emptyMessage || 'No UI variables detected.';
    if (!Array.isArray(variableNames) || variableNames.length === 0) {
      containerEl.innerHTML = `<p class="muted single-test-vars-empty">${escapeHtml(emptyMessage)}</p>`;
      return;
    }
    containerEl.innerHTML = variableNames.map((varName) => `
      <div class="single-test-var-item">
        <label class="single-test-var-label" for="${escapeHtml(options.idPrefix || 'ui-var')}-${escapeHtml(varName)}">${escapeHtml(varName)}</label>
        <input
          type="text"
          class="${escapeHtml(inputClass)} form-control"
          id="${escapeHtml(options.idPrefix || 'ui-var')}-${escapeHtml(varName)}"
          data-var-name="${escapeHtml(varName)}"
          placeholder="Value for ${escapeHtml(varName)}"
          value="${escapeHtml(values[varName] != null ? String(values[varName]) : '')}"
        >
      </div>
    `).join('');
  }

  function updateRecordedTestDetectedVariablesPreview() {
    const wrap = document.getElementById('recorded-test-detected-vars-wrap');
    const list = document.getElementById('recorded-test-detected-vars');
    const specInput = document.getElementById('recorded-test-spec');
    if (!wrap || !list || !specInput) return;
    const variableNames = extractUiVariableNamesFromSpecText(specInput.value || '');
    if (variableNames.length === 0) {
      wrap.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    wrap.style.display = 'block';
    list.innerHTML = variableNames.map((name) => `<span class="status-badge pending" style="margin-right:8px;">${escapeHtml(name)}</span>`).join('');
  }

  function showUiTestVariableGroupEditor(group = null, onDone = null) {
    const existing = group || { id: null, name: '', variables: {} };
    const rowsHtml = Object.entries(existing.variables || {}).map(([key, value]) => `
      <div class="ui-variable-group-row" style="display:flex; gap:10px; margin-bottom:10px;">
        <input type="text" class="form-control ui-variable-group-key" placeholder="Variable name" value="${escapeHtml(key)}">
        <input type="text" class="form-control ui-variable-group-value" placeholder="Value" value="${escapeHtml(String(value || ''))}">
        <button type="button" class="btn btn-secondary ui-variable-group-remove">Remove</button>
      </div>
    `).join('');
    showModal(group ? 'Edit UI Test Variable group' : 'Add UI Test Variable group', `
      <form id="ui-variable-group-form">
        <div class="form-group">
          <label for="ui-variable-group-name">Group name</label>
          <input type="text" id="ui-variable-group-name" class="form-control" value="${escapeHtml(existing.name || '')}" placeholder="e.g. Customer data set A" required>
        </div>
        <div class="form-group">
          <label>Variables</label>
          <div id="ui-variable-group-rows">${rowsHtml || ''}</div>
          <button type="button" class="btn btn-secondary" id="ui-variable-group-add-row">Add variable</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="ui-variable-group-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `);

    const rowsEl = document.getElementById('ui-variable-group-rows');
    const addRow = (key = '', value = '') => {
      const row = document.createElement('div');
      row.className = 'ui-variable-group-row';
      row.style.cssText = 'display:flex; gap:10px; margin-bottom:10px;';
      row.innerHTML = `
        <input type="text" class="form-control ui-variable-group-key" placeholder="Variable name" value="${escapeHtml(key)}">
        <input type="text" class="form-control ui-variable-group-value" placeholder="Value" value="${escapeHtml(value)}">
        <button type="button" class="btn btn-secondary ui-variable-group-remove">Remove</button>
      `;
      rowsEl.appendChild(row);
      row.querySelector('.ui-variable-group-remove')?.addEventListener('click', () => row.remove());
    };

    rowsEl.querySelectorAll('.ui-variable-group-remove').forEach((button) => {
      button.addEventListener('click', () => button.closest('.ui-variable-group-row')?.remove());
    });
    document.getElementById('ui-variable-group-add-row')?.addEventListener('click', () => addRow());
    document.getElementById('ui-variable-group-cancel')?.addEventListener('click', () => {
      if (typeof onDone === 'function') onDone(false);
      hideModal();
    });
    document.getElementById('ui-variable-group-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = document.getElementById('ui-variable-group-name')?.value?.trim();
      if (!name) {
        alert('Group name is required.');
        return;
      }
      const variables = {};
      rowsEl.querySelectorAll('.ui-variable-group-row').forEach((row) => {
        const key = normalizeUiVariableKey(row.querySelector('.ui-variable-group-key')?.value?.trim());
        const value = row.querySelector('.ui-variable-group-value')?.value ?? '';
        if (key) variables[key] = value;
      });
      const groups = loadSavedUiTestVariableGroups();
      const nextGroup = {
        id: existing.id || `ui-var-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        variables
      };
      const nextGroups = existing.id
        ? groups.map((item) => item.id === existing.id ? nextGroup : item)
        : [...groups, nextGroup];
      saveUiTestVariableGroups(nextGroups);
      if (typeof onDone === 'function') onDone(true, nextGroup.id);
      showUiTestVariableGroupsManager(onDone, nextGroup.id);
    });
    if (!rowsHtml) addRow();
  }

  function showUiTestVariableGroupsManager(onDone = null, preferredId = '') {
    const groups = loadSavedUiTestVariableGroups();
    const listHtml = groups.length
      ? groups.map((group) => `
          <div class="list-item" data-ui-variable-group-id="${escapeHtml(String(group.id))}">
            <div class="list-item-info">
              <h3>${escapeHtml(group.name || '')}</h3>
              <p>${Object.keys(group.variables || {}).length} variable(s)</p>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-secondary ui-variable-group-edit">Edit</button>
              <button type="button" class="btn btn-danger ui-variable-group-delete">Delete</button>
            </div>
          </div>
        `).join('')
      : '<div class="empty-state"><p>No UI Test Variable groups saved in this browser.</p></div>';
    showModal('UI Test Variable groups', `
      <div>
        <p class="muted" style="margin-bottom:12px;">These groups are stored locally in this browser and can be reused across all projects.</p>
        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:12px;">
          <button type="button" class="btn btn-primary" id="ui-variable-group-create">Add group</button>
          <button type="button" class="btn btn-secondary" id="ui-variable-group-close">Close</button>
        </div>
        <div id="ui-variable-group-list">${listHtml}</div>
      </div>
    `);
    document.getElementById('ui-variable-group-close')?.addEventListener('click', () => {
      if (typeof onDone === 'function') onDone(false, preferredId || '');
      hideModal();
    });
    document.getElementById('ui-variable-group-create')?.addEventListener('click', () => {
      showUiTestVariableGroupEditor(null, onDone);
    });
    document.querySelectorAll('.ui-variable-group-edit').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-ui-variable-group-id]');
        const groupId = row?.getAttribute('data-ui-variable-group-id');
        const group = loadSavedUiTestVariableGroups().find((item) => item.id === groupId);
        if (group) showUiTestVariableGroupEditor(group, onDone);
      });
    });
    document.querySelectorAll('.ui-variable-group-delete').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-ui-variable-group-id]');
        const groupId = row?.getAttribute('data-ui-variable-group-id');
        if (!groupId || !confirm('Delete this UI Test Variable group?')) return;
        const nextGroups = loadSavedUiTestVariableGroups().filter((item) => item.id !== groupId);
        saveUiTestVariableGroups(nextGroups);
        showUiTestVariableGroupsManager(onDone, preferredId && preferredId !== groupId ? preferredId : '');
      });
    });
  }

  function getSelectedRunUiTests() {
    const listType = document.querySelector('input[name="test-list-type"]:checked')?.value || 'selected';
    if (listType === 'full') return testList.slice();
    const selectedIds = new Set(Array.from(document.querySelectorAll('.playwright-test-cb:checked')).map((cb) => cb.getAttribute('data-test-id')));
    return testList.filter((test) => selectedIds.has(String(test.id)));
  }

  function updateRunUiTestVariablesUI(options = {}) {
    const section = document.getElementById('run-ui-tests-variables-section');
    const listEl = document.getElementById('run-ui-tests-variables-list');
    const groupSelect = document.getElementById('run-ui-tests-variable-group');
    if (!section || !listEl || !groupSelect) return;
    const variableNames = getUiVariableNamesForTests(getSelectedRunUiTests());
    if (variableNames.length === 0) {
      section.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }
    const currentValues = options.preserveValues ? collectUiVariableInputValues(listEl) : {};
    const mergedValues = resolveUiVariableValues(variableNames, groupSelect.value, currentValues);
    section.style.display = 'block';
    renderUiVariableInputs(listEl, variableNames, mergedValues, {
      inputClass: 'ui-test-variable-value',
      idPrefix: 'run-ui-test-variable',
      emptyMessage: 'No UI variables detected.'
    });
  }

  function filterTestsBySuite(list, _suite) {
    return list;
  }

  async function loadRunUiTestsPage() {
    const container = document.getElementById('playwright-test-list-container');
    const nameInput = document.getElementById('run-ui-tests-name');
    const projectSelectWrap = document.getElementById('run-ui-tests-project-wrap');
    const projectSelect = document.getElementById('run-ui-tests-project-select');
    const projectId = window._runUiTestsProjectId ? String(window._runUiTestsProjectId) : null;
    // Always show project selector so the user can change project (e.g. when a test is running or after coming from a project card).
    if (projectSelectWrap) {
      projectSelectWrap.style.display = 'block';
    }
    if (projectSelect) {
      projectSelect.setAttribute('required', 'required');
    }
    if (!container) return;
    try {
      // Always load projects into the dropdown so the user can select or change project.
      const sel = document.getElementById('run-ui-tests-project-select');
      if (sel) {
        const projects = await apiRequest('/projects');
        sel.innerHTML = '<option value="">Select project...</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if (projectId) {
          sel.value = projectId;
        }
      }
      const listProjectId = projectId || (sel && sel.value) || null;
      const listUrl = listProjectId ? `/playwright-tests/list?projectId=${listProjectId}` : '/playwright-tests/list';
      const [tests, config] = await Promise.all([
        apiRequest(listUrl),
        apiRequest('/playwright-config').catch(() => ({}))
      ]);
      testList = tests;
      const showBrowserOptions = document.querySelector('.run-ui-tests-show-browser-options');
      const noDisplayMsg = document.getElementById('run-ui-tests-no-display-msg');
      const showBrowserCb = document.getElementById('run-ui-tests-show-browser');
      const variableGroupSelect = document.getElementById('run-ui-tests-variable-group');
      const hasDisplay = config.hasDisplay !== false;
      if (showBrowserOptions) showBrowserOptions.style.display = hasDisplay ? '' : 'none';
      if (noDisplayMsg) noDisplayMsg.style.display = hasDisplay ? 'none' : 'block';
      if (showBrowserCb && typeof config.headless === 'boolean') showBrowserCb.checked = !config.headless;
      populateUiVariableGroupSelect(variableGroupSelect, variableGroupSelect?.value || '');
      const showCheckboxes = document.querySelector('input[name="test-list-type"]:checked')?.value === 'selected';
      renderTestList(showCheckboxes);
      updateRunUiTestVariablesUI();
      const radios = document.querySelectorAll('input[name="test-list-type"]');
      radios.forEach(r => r.addEventListener('change', () => {
        const sel = document.querySelector('input[name="test-list-type"]:checked').value === 'selected';
        renderTestList(sel);
        updateRunUiTestVariablesUI();
      }));
      if (variableGroupSelect) {
        variableGroupSelect.onchange = () => updateRunUiTestVariablesUI({ preserveValues: false });
      }
      // When user changes project, reload test list for the new project (one handler via onchange to avoid stacking).
      if (sel) {
        sel.onchange = async () => {
          const pid = sel.value || null;
          window._runUiTestsProjectId = pid ? Number(pid) : null;
          if (!pid) {
            testList = [];
            renderTestList(document.querySelector('input[name="test-list-type"]:checked')?.value === 'selected');
            return;
          }
          try {
            testList = await apiRequest(`/playwright-tests/list?projectId=${pid}`);
            const showCb = document.querySelector('input[name="test-list-type"]:checked')?.value === 'selected';
            renderTestList(showCb);
            updateRunUiTestVariablesUI();
          } catch (err) {
            console.error('Error loading test list for project:', err);
          }
        };
      }
    } catch (err) {
      container.innerHTML = `<p class="error-message">Error loading test list: ${err.message}</p>`;
    }
  }

  function renderTestList(showCheckboxes, _suiteFilter) {
    const container = document.getElementById('playwright-test-list-container');
    if (!container) return;
    const filtered = testList;
    if (!filtered.length) {
      container.innerHTML = `
        <h3 class="test-list-title">Tests that will run</h3>
        <p class="test-list-empty">No recorded tests in this project. Add recorded tests and link them to the project first.</p>
      `;
      return;
    }

    const listHtml = `
      <ul class="playwright-test-list ${showCheckboxes ? 'selectable' : ''}">
        ${filtered.map((t, i) => `
          <li class="playwright-test-item">
            ${showCheckboxes ? `<input type="checkbox" class="playwright-test-cb" data-test-id="${t.id}" id="pt-${t.id}" />` : ''}
            <span class="playwright-test-name">${i + 1}. ${t.name}</span>
          </li>
        `).join('')}
      </ul>
    `;

    container.innerHTML = `
      <h3 class="test-list-title">Tests that will run</h3>
      ${showCheckboxes ? `
        <div class="test-list-select-actions">
          <button type="button" class="btn btn-link" id="select-all-tests">Select all</button>
          <span class="test-list-select-sep">|</span>
          <button type="button" class="btn btn-link" id="deselect-all-tests">Deselect all</button>
        </div>
      ` : ''}
      ${listHtml}
    `;

    if (showCheckboxes) {
      container.querySelectorAll('.playwright-test-cb').forEach(cb => { cb.checked = true; });
      container.querySelectorAll('.playwright-test-cb').forEach((cb) => {
        cb.addEventListener('change', () => updateRunUiTestVariablesUI({ preserveValues: true }));
      });
      container.querySelector('#select-all-tests')?.addEventListener('click', () => {
        container.querySelectorAll('.playwright-test-cb').forEach(cb => { cb.checked = true; });
        updateRunUiTestVariablesUI({ preserveValues: true });
      });
      container.querySelector('#deselect-all-tests')?.addEventListener('click', () => {
        container.querySelectorAll('.playwright-test-cb').forEach(cb => { cb.checked = false; });
        updateRunUiTestVariablesUI({ preserveValues: true });
      });
    }
  }

  function showRunUiTestsPage(projectId) {
    if (window.currentProject && String(window.currentProject.id) === String(projectId) && typeof window.isProjectClosed === 'function' && window.isProjectClosed(window.currentProject)) {
      alert(window.getProjectRunBlockedMessage ? window.getProjectRunBlockedMessage(window.currentProject) : 'This project is closed. New test runs are disabled.');
      return;
    }
    window._runUiTestsProjectId = projectId || null;
    showView('run-ui-tests');
    loadRunUiTestsPage();
  }

  function handleRunUiTestsSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('run-ui-tests-name')?.value?.trim();
    if (!name) {
      alert('Please enter a run name.');
      return;
    }
    const listType = document.querySelector('input[name="test-list-type"]:checked')?.value || 'selected';
    let projectId = window._runUiTestsProjectId;
    if (!projectId) {
      const sel = document.getElementById('run-ui-tests-project-select');
      projectId = sel ? sel.value : null;
    }
    if (!projectId) {
      alert('Please select a project.');
      return;
    }
    const filtered = testList;
    const runOnlyIds = listType === 'selected'
      ? Array.from(document.querySelectorAll('.playwright-test-cb:checked')).map(cb => cb.getAttribute('data-test-id'))
      : filtered.map(t => t.id);
    const selectedTests = listType === 'selected'
      ? filtered.filter((test) => runOnlyIds.includes(String(test.id)))
      : filtered.slice();
    const requiredUiVariables = getUiVariableNamesForTests(selectedTests);
    if (runOnlyIds.length === 0) {
      alert(listType === 'selected' ? 'Select at least one test.' : 'No tests in this suite.');
      return;
    }
    const showBrowser = document.getElementById('run-ui-tests-show-browser')?.checked === true;
    const timeoutInput = document.getElementById('run-ui-tests-timeout');
    const timeoutSeconds = timeoutInput && timeoutInput.value.trim() !== '' ? parseInt(timeoutInput.value.trim(), 10) : null;
    const videoSelect = document.getElementById('run-ui-tests-video');
    const traceSelect = document.getElementById('run-ui-tests-trace');
    const browserSelect = document.getElementById('run-ui-tests-browser');
    const slowMoInput = document.getElementById('run-ui-tests-slow-mo');
    const slowMo = slowMoInput && slowMoInput.value.trim() !== '' ? parseInt(slowMoInput.value.trim(), 10) : 0;

    const body = { name, projectId: Number(projectId), headless: !showBrowser };
    if (typeof timeoutSeconds === 'number' && timeoutSeconds >= 10 && timeoutSeconds <= 300) body.timeoutSeconds = timeoutSeconds;
    body.video = videoSelect ? videoSelect.value : 'off';
    body.trace = traceSelect ? traceSelect.value : 'off';
    body.browser = browserSelect ? browserSelect.value : 'chromium';
    if (typeof slowMo === 'number' && slowMo >= 0) body.slowMo = slowMo;
    if (requiredUiVariables.length > 0) {
      const uiVariables = collectUiVariableInputValues(document.getElementById('run-ui-tests-variables-list'));
      const missingVariables = requiredUiVariables.filter((name) => !uiVariables[name] || !String(uiVariables[name]).trim());
      if (missingVariables.length > 0) {
        alert(`Provide values for all UI test variables before running: ${missingVariables.join(', ')}`);
        return;
      }
      body.uiVariables = Object.fromEntries(Object.entries(uiVariables).map(([key, value]) => [key, String(value).trim()]));
    }
    if (listType === 'full' && runOnlyIds.length === filtered.length) {
      body.suite = 'full';
    } else {
      body.suite = 'selected';
      body.selectedTestIds = runOnlyIds;
    }
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
        <p style="font-size: 13px; color: var(--color-text-secondary, #6b7280); margin-top: 16px;">You can run more than one test at a time. Close this to select another project and start another run.</p>
        <button type="button" class="btn btn-secondary" id="run-in-background-btn" style="margin-top: 12px;">Run in background</button>
      </div>
    `;
    showModal('Running Tests', loadingContent);

    (async () => {
      let progressCancelled = false;
      let pollTimeoutId = null;
      window._cancelPlaywrightProgress = () => {
        progressCancelled = true;
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
        hideModal();
      };
      try {
        document.getElementById('run-in-background-btn')?.addEventListener('click', () => {
          if (typeof window._cancelPlaywrightProgress === 'function') window._cancelPlaywrightProgress();
        });
        const res = await apiRequest('/playwright-runs/execute', { method: 'POST', body });
        const runId = res.playwrightRun && res.playwrightRun.id;
        if (!runId) {
          hideModal();
          alert('Error: No run id returned.');
          return;
        }
        // Show Test Runs with type "All" so the running UI test appears in the list; keep progress modal on top
        const typeFilter = document.getElementById('test-run-type-filter');
        if (typeFilter) typeFilter.value = 'all';
        showView('test-runs');
        if (typeof window.loadTestRuns === 'function') window.loadTestRuns();
        let pollCount = 0;
        const maxPoll = 120;
        const pollProgress = async () => {
          if (progressCancelled) return;
          try {
            const run = await apiRequest(`/playwright-runs/${runId}`);
            if (progressCancelled) return;
            const totalTests = run.total_tests || 0;
            const completedTests = (run.passed_tests || 0) + (run.failed_tests || 0);
            const progress = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;
            const progressBar = document.getElementById('test-progress-bar');
            const progressText = document.getElementById('test-progress-text');
            const currentTestText = document.getElementById('test-current-test');
            if (progressBar) {
              progressBar.style.width = `${progress}%`;
              progressBar.textContent = `${progress}%`;
            }
            if (progressText) {
              progressText.textContent = totalTests > 0
                ? `Progress: ${completedTests} of ${totalTests} tests completed`
                : 'Starting...';
            }
            if (currentTestText) {
              const passed = run.passed_tests || 0;
              const failed = run.failed_tests || 0;
              if (run.status === 'running' && completedTests < totalTests) {
                currentTestText.textContent = `Running... (${passed} passed, ${failed} failed)`;
              } else {
                currentTestText.textContent = `Completed: ${passed} passed, ${failed} failed`;
              }
            }
            if (run.status !== 'running' || ++pollCount >= maxPoll) {
              hideModal();
              if (typeof window.loadTestRuns === 'function') window.loadTestRuns();
              showView('test-runs');
              if (run.status !== 'running') viewPlaywrightRun(runId);
              return;
            }
            if (progressCancelled) return;
            pollTimeoutId = setTimeout(pollProgress, 1500);
          } catch (err) {
            if (progressCancelled) return;
            if (isServerUnavailable(err)) {
              hideModal();
              if (typeof window.loadTestRuns === 'function') window.loadTestRuns();
              return;
            }
            pollTimeoutId = setTimeout(pollProgress, 1500);
          }
        };
        pollTimeoutId = setTimeout(pollProgress, 500);
      } catch (err) {
        hideModal();
        alert('Error starting UI tests: ' + err.message);
      }
    })();
  }

  document.getElementById('run-ui-tests-cancel')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('manage-ui-test-variable-groups-btn')?.addEventListener('click', () => {
    const groupSelect = document.getElementById('run-ui-tests-variable-group');
    showUiTestVariableGroupsManager((_changed, preferredId) => {
      populateUiVariableGroupSelect(groupSelect, preferredId || groupSelect?.value || '');
      updateRunUiTestVariablesUI({ preserveValues: false });
    }, groupSelect?.value || '');
  });

  document.getElementById('back-from-run-ui-tests')?.addEventListener('click', () => {
    const returnView = window._uiTestsReturnView || 'ui-tests';
    showView(returnView);
    if (typeof loadViewData === 'function') loadViewData(returnView);
    if (returnView === 'ui-tests') loadPlaywrightRuns();
  });

  let currentCodegenSlug = null;
  let currentCodegenMode = null; // 'remote' or 'local'
  let autoRefreshInterval = null;
  let remoteSessionTimerInterval = null;
  let remoteSessionStartTime = null;
  let remoteSessionTimeoutMs = 600000;

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
    const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
    if (autoRefreshBtn) {
      autoRefreshBtn.textContent = 'Auto-refresh: OFF';
      autoRefreshBtn.classList.remove('btn-primary');
      autoRefreshBtn.classList.add('btn-secondary');
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
    if (!currentCodegenSlug || !autoRefreshBtn) return;
    autoRefreshBtn.textContent = 'Auto-refresh: ON';
    autoRefreshBtn.classList.remove('btn-secondary');
    autoRefreshBtn.classList.add('btn-primary');
    autoRefreshInterval = setInterval(() => {
      loadCodegenOutput(currentCodegenSlug, false);
    }, 2000);
  }

  async function loadCodegenOutput(slug, showAlert = true) {
    if (!slug) return;
    try {
      const res = await apiRequest(`/playwright-recorded-tests/codegen-output/${slug}`);
      const specInput = document.getElementById('recorded-test-spec');
      if (specInput && res.content) {
        specInput.value = res.content;
        updateRecordedTestDetectedVariablesPreview();
        if (showAlert) {
          alert('Generated code loaded successfully!');
        }
      }
    } catch (err) {
      if (showAlert && !err.message.includes('not found')) {
        alert('Error loading generated code: ' + err.message);
      }
    }
  }

  // --- Remote Codegen (noVNC) helpers ---

  function showRemoteCodegenPanel(slug, timeoutMs) {
    const panel = document.getElementById('codegen-vnc-panel');
    const iframe = document.getElementById('codegen-vnc-iframe');
    if (!panel || !iframe) return;

    // Use our custom VNC client page: it builds the exact WebSocket URL and uses noVNC core from /novnc.
    const vncClientUrl = window.location.origin + '/codegen-vnc.html?slug=' + encodeURIComponent(slug);
    iframe.src = vncClientUrl;

    panel.style.display = 'block';
    remoteSessionStartTime = Date.now();
    remoteSessionTimeoutMs = timeoutMs || 600000;

    // Start timer display
    stopRemoteSessionTimer();
    updateRemoteTimerDisplay();
    remoteSessionTimerInterval = setInterval(updateRemoteTimerDisplay, 1000);
  }

  function hideRemoteCodegenPanel() {
    const panel = document.getElementById('codegen-vnc-panel');
    const iframe = document.getElementById('codegen-vnc-iframe');
    if (panel) panel.style.display = 'none';
    if (iframe) iframe.src = '';
    stopRemoteSessionTimer();
  }

  function stopRemoteSessionTimer() {
    if (remoteSessionTimerInterval) {
      clearInterval(remoteSessionTimerInterval);
      remoteSessionTimerInterval = null;
    }
  }

  function updateRemoteTimerDisplay() {
    const timerText = document.getElementById('codegen-vnc-timer-text');
    const remainingText = document.getElementById('codegen-vnc-remaining');
    if (!timerText || !remoteSessionStartTime) return;

    const elapsed = Date.now() - remoteSessionStartTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    timerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (remainingText && remoteSessionTimeoutMs) {
      const remaining = Math.max(0, remoteSessionTimeoutMs - elapsed);
      const remMins = Math.floor(remaining / 60000);
      const remSecs = Math.floor((remaining % 60000) / 1000);
      remainingText.textContent = `(${remMins}m ${remSecs}s remaining)`;
      if (remaining < 60000) {
        remainingText.classList.add('codegen-vnc-remaining-warn');
      } else {
        remainingText.classList.remove('codegen-vnc-remaining-warn');
      }
      if (remaining <= 0) {
        // Auto-stop when timeout reached
        document.getElementById('stop-codegen-btn')?.click();
      }
    }
  }

  async function stopRemoteCodegenSession() {
    if (!currentCodegenSlug || currentCodegenMode !== 'remote') return;
    const statusText = document.getElementById('codegen-vnc-status-text');
    if (statusText) statusText.textContent = 'Stopping session...';
    try {
      const res = await apiRequest(`/playwright-recorded-tests/stop-codegen/${currentCodegenSlug}`, {
        method: 'POST',
      });
      hideRemoteCodegenPanel();
      // Populate the spec textarea with the generated code
      const specInput = document.getElementById('recorded-test-spec');
      if (specInput && res.specContent) {
        specInput.value = res.specContent;
        updateRecordedTestDetectedVariablesPreview();
        alert('Recording stopped. Generated code has been loaded into the spec field. Review and save your test.');
      } else {
        alert('Recording stopped. No generated code was captured — the Codegen window may have been closed before saving. You can paste code manually.');
      }
    } catch (err) {
      hideRemoteCodegenPanel();
      alert('Error stopping session: ' + err.message);
    }
    currentCodegenMode = null;
  }

  // Stop Recording button
  document.getElementById('stop-codegen-btn')?.addEventListener('click', () => {
    stopRemoteCodegenSession();
  });

  // Full screen viewer
  (function() {
    const frameWrap = document.getElementById('codegen-vnc-frame-wrap');
    const fullscreenBtn = document.getElementById('codegen-vnc-fullscreen-btn');
    const exitFullscreenBtn = document.getElementById('codegen-vnc-exit-fullscreen-btn');
    if (!frameWrap || !fullscreenBtn) return;
    function updateFullscreenState() {
      const isFs = !!document.fullscreenElement;
      frameWrap.classList.toggle('is-fullscreen', isFs);
      fullscreenBtn.innerHTML = isFs
        ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg> Exit full screen'
        : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg> Full screen';
      fullscreenBtn.title = isFs ? 'Exit full screen' : 'Expand viewer to full screen';
    }
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        frameWrap.requestFullscreen().catch(() => {});
      }
    });
    exitFullscreenBtn?.addEventListener('click', () => {
      document.exitFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
  })();

  function showAddRecordedTestView(editId) {
    const form = document.getElementById('recorded-test-form');
    const idInput = document.getElementById('recorded-test-id');
    const titleEl = document.getElementById('recorded-test-form-title');
    const nameInput = document.getElementById('recorded-test-name');
    const specInput = document.getElementById('recorded-test-spec');
    const codegenUrlInput = document.getElementById('recorded-test-codegen-url');
    const loadBtn = document.getElementById('load-codegen-output-btn');
    const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
    const addToProjectWrap = document.getElementById('recorded-test-add-to-project-wrap');
    const addToProjectSelect = document.getElementById('recorded-test-add-to-project');
    if (!form) return;

    if (addToProjectWrap) addToProjectWrap.style.display = 'block';
    if (addToProjectSelect) addToProjectSelect.innerHTML = '<option value="">None</option>';

    // Proxy is inferred from base URL by the backend (no dropdown)
    if (!editId) {
      currentCodegenSlug = null;
      currentCodegenMode = null;
      stopAutoRefresh();
      hideRemoteCodegenPanel();
      if (loadBtn) loadBtn.style.display = 'none';
      if (autoRefreshBtn) autoRefreshBtn.style.display = 'none';
    }

    idInput.value = editId || '';
    titleEl.textContent = editId ? 'Edit recorded test' : 'Add recorded test';
    nameInput.value = '';
    specInput.value = '';
    specInput.oninput = () => updateRecordedTestDetectedVariablesPreview();

    apiRequest('/projects').then(projects => {
      if (addToProjectSelect && Array.isArray(projects) && projects.length > 0) {
        addToProjectSelect.innerHTML = '<option value="">None</option>' + projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      }
    }).catch(() => {});

    if (editId) {
      apiRequest(`/playwright-recorded-tests/${editId}`)
        .then(t => {
          nameInput.value = t.name || '';
          specInput.value = t.spec_content || '';
          updateRecordedTestDetectedVariablesPreview();
          codegenUrlInput.value = (t.base_url || '').trim() || codegenUrlInput.placeholder;
          if (addToProjectSelect && Array.isArray(t.project_ids) && t.project_ids.length > 0) {
            addToProjectSelect.value = String(t.project_ids[0]);
          }
        })
        .catch(err => alert('Error loading recorded test: ' + err.message));
    } else {
      // Load default URL from config and projects for "Also add to project"
      apiRequest('/playwright-config').then(c => {
        const defaultUrl = (c.baseUrl || '').trim() || 'https://example.com';
        codegenUrlInput.value = defaultUrl;
      }).catch(() => {
        codegenUrlInput.value = 'https://example.com';
      });
      updateRecordedTestDetectedVariablesPreview();
    }
    showView('add-recorded-test');
  }

  document.getElementById('add-recorded-test-btn')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('add-recorded-test-btn-main')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('back-from-recorded-test')?.addEventListener('click', () => {
    stopAutoRefresh();
    hideRemoteCodegenPanel();
    if (currentCodegenMode === 'remote' && currentCodegenSlug) {
      // Stop remote session in background
      apiRequest(`/playwright-recorded-tests/stop-codegen/${currentCodegenSlug}`, { method: 'POST' }).catch(() => {});
    }
    currentCodegenSlug = null;
    currentCodegenMode = null;
    showView('ui-tests');
    loadPlaywrightRuns();
  });
  document.getElementById('recorded-test-cancel')?.addEventListener('click', () => {
    stopAutoRefresh();
    hideRemoteCodegenPanel();
    if (currentCodegenMode === 'remote' && currentCodegenSlug) {
      apiRequest(`/playwright-recorded-tests/stop-codegen/${currentCodegenSlug}`, { method: 'POST' }).catch(() => {});
    }
    currentCodegenSlug = null;
    currentCodegenMode = null;
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('launch-codegen-btn')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('recorded-test-codegen-url');
    const url = (urlInput?.value || '').trim();
    if (!url) {
      alert('Please enter a Base URL for recording');
      return;
    }
    try {
      const projectId = window._projectRecordedTestsProjectId || window._runUiTestsProjectId || null;
      const res = await apiRequest('/playwright-recorded-tests/launch-codegen', {
        method: 'POST',
        body: { baseUrl: url, projectId: projectId ? Number(projectId) : undefined }
      });
      currentCodegenSlug = res.slug;
      currentCodegenMode = res.mode || 'local';

      if (currentCodegenMode === 'remote') {
        // --- Remote mode: show embedded noVNC panel (same-origin + WS proxy) ---
        showRemoteCodegenPanel(res.slug, res.timeoutMs);
        // Hide the local-mode buttons (they're not needed for remote)
        const loadBtn = document.getElementById('load-codegen-output-btn');
        const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
        if (loadBtn) loadBtn.style.display = 'none';
        if (autoRefreshBtn) autoRefreshBtn.style.display = 'none';
      } else {
        // --- Local mode: existing behavior ---
        hideRemoteCodegenPanel();
        const loadBtn = document.getElementById('load-codegen-output-btn');
        const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
        if (loadBtn) loadBtn.style.display = 'inline-block';
        if (autoRefreshBtn) autoRefreshBtn.style.display = 'inline-block';
        alert(res.message || 'Codegen launched! Browser and Inspector should open. Record your interactions, then click "Load generated code" to load the test code.');
      }
    } catch (err) {
      alert('Error launching Codegen: ' + err.message);
    }
  });

  document.getElementById('load-codegen-output-btn')?.addEventListener('click', () => {
    if (currentCodegenSlug) {
      loadCodegenOutput(currentCodegenSlug, true);
    } else {
      alert('No codegen session active. Click "Launch Codegen" first.');
    }
  });

  document.getElementById('auto-refresh-codegen-btn')?.addEventListener('click', () => {
    if (!currentCodegenSlug) {
      alert('No codegen session active. Click "Launch Codegen" first.');
      return;
    }
    if (autoRefreshInterval) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
    }
  });

  document.getElementById('copy-codegen-cmd-btn')?.addEventListener('click', () => {
    const urlInput = document.getElementById('recorded-test-codegen-url');
    const url = (urlInput?.value || '').trim() || 'https://example.com';
    const cmd = `npx playwright codegen ${url}`;
    navigator.clipboard.writeText(cmd).then(() => alert('Command copied to clipboard')).catch(() => alert('Could not copy'));
  });

  document.getElementById('recorded-test-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    stopAutoRefresh();
    const idInput = document.getElementById('recorded-test-id');
    const name = document.getElementById('recorded-test-name')?.value?.trim();
    const spec = document.getElementById('recorded-test-spec')?.value?.trim();
    const addToProjectEl = document.getElementById('recorded-test-add-to-project');
    const addToProjectId = addToProjectEl?.value?.trim() || null;
    if (!name) { alert('Test name is required'); return; }
    if (!spec) { alert('Generated spec is required'); return; }
    const editId = idInput?.value?.trim() || null;
    try {
      if (editId) {
        const body = { name, spec_content: spec, base_url: null };
        if (addToProjectId) body.projectIds = [Number(addToProjectId)];
        await apiRequest(`/playwright-recorded-tests/${editId}`, { method: 'PUT', body });
        alert('Recorded test updated.');
      } else {
        const body = { name, spec_content: spec, base_url: null };
        if (addToProjectId) body.addToProjectIds = [Number(addToProjectId)];
        await apiRequest('/playwright-recorded-tests', { method: 'POST', body });
        alert('Recorded test saved. It will appear in the test list when you run UI tests.');
      }
      currentCodegenSlug = null;
      currentCodegenMode = null;
      hideRemoteCodegenPanel();
      showView('ui-tests');
      loadPlaywrightRuns();
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  async function loadRecordedTestsList() {
    const container = document.getElementById('recorded-tests-list-container');
    if (!container) return;
    try {
      const list = await apiRequest('/playwright-recorded-tests');
      if (list.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>No recorded tests yet. Click "Add recorded test" and paste code from Playwright Codegen.</p>
          </div>`;
      } else {
        container.innerHTML = list.map(t => `
          <div class="list-item" data-id="${t.id}">
            <div class="list-item-info">
              <h3>${escapeHtml(t.name)}</h3>
              <p style="font-size: 12px; color: #6b7280;">${escapeHtml(t.base_url || '')} • ${formatDateTime(t.created_at)}</p>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-secondary edit-recorded-test-btn" data-id="${t.id}">Edit</button>
              <button type="button" class="btn btn-secondary delete-recorded-test-btn" data-id="${t.id}">Delete</button>
            </div>
          </div>
        `).join('');
        container.querySelectorAll('.edit-recorded-test-btn').forEach(btn => {
          btn.addEventListener('click', () => showAddRecordedTestView(btn.getAttribute('data-id')));
        });
        container.querySelectorAll('.delete-recorded-test-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Delete this recorded test?')) return;
            try {
              await apiRequest(`/playwright-recorded-tests/${btn.getAttribute('data-id')}`, { method: 'DELETE' });
              loadRecordedTestsList();
            } catch (err) {
              alert('Error deleting: ' + err.message);
            }
          });
        });
      }
    } catch (err) {
      container.innerHTML = `<p class="error-message">Error loading recorded tests: ${err.message}</p>`;
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function showManageRecordedTests() {
    showView('recorded-tests-list');
    loadRecordedTestsList();
  }
  document.getElementById('manage-recorded-tests-btn')?.addEventListener('click', showManageRecordedTests);
  document.getElementById('manage-recorded-tests-btn-main')?.addEventListener('click', showManageRecordedTests);
  document.getElementById('back-from-recorded-tests-list')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });
  document.getElementById('recorded-tests-list-add-new')?.addEventListener('click', () => showAddRecordedTestView());

  // Project recorded tests (Option B: list linked to project, add from pool, remove link)
  async function loadProjectRecordedTestsView(projectId) {
    const listEl = document.getElementById('project-recorded-tests-list');
    const titleEl = document.getElementById('project-recorded-tests-title');
    if (!listEl) return;
    try {
      const [project, recorded] = await Promise.all([
        apiRequest(`/projects/${projectId}`),
        apiRequest(`/projects/${projectId}/recorded-tests`)
      ]);
      if (titleEl) titleEl.textContent = `Recorded tests in "${project.name}"`;
      if (recorded.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p>No recorded tests in this project. Add from the global pool below.</p>
          </div>
        `;
      } else {
        listEl.innerHTML = recorded.map(t => `
          <div class="list-item">
            <div class="list-item-info">
              <h3>${escapeHtml(t.name)}</h3>
              <p>${t.base_url ? escapeHtml(t.base_url) : ''} • ${formatDateTime(t.created_at)}</p>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-danger btn-sm remove-from-project-recorded" data-recorded-id="${t.id}">Remove from project</button>
            </div>
          </div>
        `).join('');
        listEl.querySelectorAll('.remove-from-project-recorded').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this recorded test from the project? (The test stays in the global pool.)')) return;
            try {
              await apiRequest(`/projects/${projectId}/recorded-tests/${btn.getAttribute('data-recorded-id')}`, { method: 'DELETE' });
              loadProjectRecordedTestsView(projectId);
            } catch (err) {
              alert('Error: ' + err.message);
            }
          });
        });
      }
    } catch (err) {
      listEl.innerHTML = `<p class="error-message">Error loading: ${escapeHtml(err.message)}</p>`;
    }
  }

  function showProjectRecordedTestsView(projectId) {
    window._projectRecordedTestsProjectId = projectId;
    showView('project-recorded-tests');
    loadProjectRecordedTestsView(projectId);
  }

  document.getElementById('back-from-project-recorded-tests')?.addEventListener('click', () => {
    const projectId = window._projectRecordedTestsProjectId;
    window._projectRecordedTestsProjectId = null;
    if (projectId && typeof window.viewProject === 'function') {
      window.viewProject(projectId);
    } else {
      showView('projects');
    }
  });

  document.getElementById('add-recorded-test-to-project-btn')?.addEventListener('click', async () => {
    const projectId = window._projectRecordedTestsProjectId;
    if (!projectId) return;
    try {
      const [allRecorded, inProject] = await Promise.all([
        apiRequest('/playwright-recorded-tests'),
        apiRequest(`/projects/${projectId}/recorded-tests`)
      ]);
      const inIds = new Set((inProject || []).map(t => t.id));
      const available = (allRecorded || []).filter(t => !inIds.has(t.id));
      if (available.length === 0) {
        alert('All recorded tests are already in this project. Add new tests from "UI Tests" → "Add recorded test".');
        return;
      }
      const options = available.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
      showModal('Add recorded test to project', `
        <p style="margin-bottom: 12px;">Select a recorded test from the global pool to add to this project.</p>
        <div class="form-group">
          <label for="add-to-project-recorded-select">Recorded test</label>
          <select id="add-to-project-recorded-select" style="width: 100%; padding: 8px;">
            ${options}
          </select>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('active')">Cancel</button>
          <button type="button" class="btn btn-primary" id="add-to-project-recorded-confirm">Add</button>
        </div>
      `);
      document.getElementById('add-to-project-recorded-confirm')?.addEventListener('click', async () => {
        const sel = document.getElementById('add-to-project-recorded-select');
        const recordedId = sel ? sel.value : null;
        if (!recordedId) return;
        try {
          await apiRequest(`/projects/${projectId}/recorded-tests/${recordedId}`, { method: 'POST' });
          document.getElementById('modal-overlay').classList.remove('active');
          loadProjectRecordedTestsView(projectId);
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    } catch (err) {
      alert('Error loading recorded tests: ' + err.message);
    }
  });

async function viewPlaywrightRun(id) {
  try {
    const run = await apiRequest(`/playwright-runs/${id}`);
    const nameEl = document.getElementById('ui-test-detail-name');
    nameEl.innerHTML = `
      <div style="margin-bottom: 8px;"><span style="color: #6b7280;">Name:</span> ${run.name}</div>
      <div style="margin-bottom: 8px;"><span style="color: #6b7280;">Base URL:</span> <span style="word-break: break-all;">${run.base_url || '-'}</span></div>
      <div><span style="color: #6b7280;">Date:</span> ${formatDateTime(run.created_at)}</div>
    `;
    const infoEl = document.getElementById('ui-test-info');
    infoEl.innerHTML = `
      <div class="stat-card"><div class="stat-value">${run.total_tests != null ? run.total_tests : 0}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value" style="color: #10b981;">${run.passed_tests != null ? run.passed_tests : 0}</div><div class="stat-label">Passed</div></div>
      <div class="stat-card"><div class="stat-value" style="color: #ef4444;">${run.failed_tests != null ? run.failed_tests : 0}</div><div class="stat-label">Failed</div></div>
      <div class="stat-card"><div class="stat-value">${run.duration_ms != null ? (run.duration_ms < 1000 ? run.duration_ms + 'ms' : (run.duration_ms / 1000).toFixed(2) + 's') : '-'}</div><div class="stat-label">Duration</div></div>
    `;
    const resultsEl = document.getElementById('playwright-results-list');
    const results = (run.results || []).slice().sort((a, b) => (a.execution_order || 0) - (b.execution_order || 0));
    if (results.length > 0) {
      resultsEl.innerHTML = results.map(r => {
        const validationsHtml = (r.assertions && Array.isArray(r.assertions.validations))
          ? `<div style="margin-top: 8px;"><strong style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Validations</strong><ul style="list-style: none; padding: 0; margin: 4px 0 0 0;">${r.assertions.validations.map(v => `
            <li style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; margin-bottom: 4px; border-radius: 6px; background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid ${v.passed ? '#10b981' : '#ef4444'};">
              <span style="flex-shrink: 0; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: ${v.passed ? '#d1fae5' : '#fee2e2'}; color: ${v.passed ? '#065f46' : '#991b1b'};">${v.passed ? 'Passed' : 'Failed'}</span>
              <div><span style="font-size: 13px;">${v.description}</span>${v.detail ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${v.detail}</div>` : ''}</div>
            </li>`).join('')}</ul></div>`
          : (r.assertions ? `<pre style="font-size: 12px; margin-top: 8px; padding: 8px; background: #f9fafb; border-radius: 6px;">${JSON.stringify(r.assertions, null, 2)}</pre>` : '');
        const resultId = r.id;
        const runId = id;
        const hasResultVideo = !!(r.video_path);
        const hasResultTrace = !!(r.trace_path);
        const videoIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" style="vertical-align: middle; margin-right: 6px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>';
        const traceIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" style="vertical-align: middle; margin-right: 6px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>';
        const artifactLinks = (hasResultVideo || hasResultTrace) ? `
          <div style="margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
            ${hasResultVideo ? `<button type="button" class="btn btn-secondary result-video-link" data-run-id="${runId}" data-result-id="${resultId}">${videoIcon}View video</button>` : ''}
            ${hasResultTrace ? `<button type="button" class="btn btn-secondary result-trace-link" data-run-id="${runId}" data-result-id="${resultId}">${traceIcon}View trace</button>` : ''}
          </div>` : '';
        return `
        <div class="test-result-item">
          <div class="test-result-header">
            <div><strong>${r.test_name}</strong>${r.endpoint ? ` <span style="font-size: 12px; color: #6b7280;">${r.endpoint}</span>` : ''}</div>
            <span class="status-badge ${r.status}">${r.status}</span>
          </div>
          <div class="test-result-details">
            ${r.duration_ms != null ? `<p><strong>Duration:</strong> ${r.duration_ms} ms</p>` : ''}
            ${r.error_message ? `<p style="color: #dc2626;"><strong>Error:</strong> ${r.error_message}</p>` : ''}
            ${artifactLinks}
            ${validationsHtml}
          </div>
        </div>
      `;
      }).join('');
    } else {
      resultsEl.innerHTML = `<div class="empty-state"><p>${run.status === 'running' ? 'Test run in progress...' : 'No results'}</p></div>`;
    }
    document.getElementById('view-ui-report-btn').setAttribute('data-playwright-run-id', id);
    document.getElementById('download-ui-report-btn').setAttribute('data-playwright-run-id', id);
    const deleteUiRunBtn = document.getElementById('delete-ui-run-btn');
    if (deleteUiRunBtn) deleteUiRunBtn.setAttribute('data-playwright-run-id', id);
    const viewVideoBtn = document.getElementById('view-ui-video-btn');
    const viewTraceBtn = document.getElementById('view-ui-trace-btn');
    const downloadTraceBtn = document.getElementById('download-ui-trace-btn');
    if (viewVideoBtn) {
      viewVideoBtn.setAttribute('data-playwright-run-id', id);
      viewVideoBtn.style.display = run.video_path ? '' : 'none';
    }
    if (viewTraceBtn) {
      viewTraceBtn.setAttribute('data-playwright-run-id', id);
      viewTraceBtn.style.display = run.trace_path ? '' : 'none';
    }
    if (downloadTraceBtn) {
      downloadTraceBtn.setAttribute('data-playwright-run-id', id);
      downloadTraceBtn.style.display = run.trace_path ? '' : 'none';
    }
    const timeoutHint = document.getElementById('ui-test-timeout-hint');
    if (timeoutHint) {
      const results = run.results || [];
      const hasTimeoutFailure = results.some(r => (r.error_message || '').toLowerCase().includes('timeout'));
      const missingArtifacts = !run.video_path || !run.trace_path;
      const multiResultNoRunArtifacts = results.length > 1 && !run.video_path && !run.trace_path;
      if (multiResultNoRunArtifacts) {
        timeoutHint.textContent = 'This run has multiple tests. Video and trace are recorded per test — use "View video" / "View trace" under each result above.';
        timeoutHint.style.display = '';
      } else if (hasTimeoutFailure && missingArtifacts) {
        timeoutHint.textContent = 'When a test fails due to timeout, trace and video may be missing because Playwright may not save them before the run is stopped. Consider increasing the test timeout or fixing the step that hangs.';
        timeoutHint.style.display = '';
      } else {
        timeoutHint.textContent = '';
        timeoutHint.style.display = 'none';
      }
    }
    showView('ui-test-detail');
  } catch (err) {
    console.error('Error loading Playwright run:', err);
    alert('Error loading UI test run: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('run-ui-tests-btn')?.addEventListener('click', () => showRunUiTestsPage());
  const runForm = document.getElementById('run-ui-tests-page-form');
  if (runForm) {
    runForm.addEventListener('submit', handleRunUiTestsSubmit);
  }
  document.getElementById('back-to-ui-tests')?.addEventListener('click', () => {
    const returnView = window._uiTestsReturnView || 'ui-tests';
    showView(returnView);
    if (typeof loadViewData === 'function') loadViewData(returnView);
    if (returnView === 'ui-tests') loadPlaywrightRuns();
  });
  document.getElementById('view-ui-report-btn')?.addEventListener('click', () => {
    const id = document.getElementById('view-ui-report-btn').getAttribute('data-playwright-run-id');
    if (id) window.open(`${API_BASE}/playwright-runs/${id}/report`, '_blank');
  });
  document.getElementById('download-ui-report-btn')?.addEventListener('click', () => {
    const id = document.getElementById('download-ui-report-btn').getAttribute('data-playwright-run-id');
    if (id) window.location.href = `${API_BASE}/playwright-runs/${id}/report/download`;
  });
  document.getElementById('view-ui-video-btn')?.addEventListener('click', () => {
    const id = document.getElementById('view-ui-video-btn').getAttribute('data-playwright-run-id');
    if (id) window.open(`${API_BASE}/playwright-runs/${id}/video`, '_blank');
  });
  document.getElementById('view-ui-trace-btn')?.addEventListener('click', () => {
    const id = document.getElementById('view-ui-trace-btn').getAttribute('data-playwright-run-id');
    if (!id) return;
    const traceViewerBase = 'https://trace.playwright.dev/';
    const hostname = window.location.hostname;
    const isLocalOrPrivate = /^localhost$|^127\.0\.0\.1$|\.local$/i.test(hostname) ||
      /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^169\.254\./i.test(hostname) ||
      /docker|\.internal$/i.test(hostname);
    if (isLocalOrPrivate) {
      window.open(traceViewerBase, '_blank');
      alert('Trace Viewer opened. Download the trace (Download Trace button), then drag the .zip file into the viewer to view it.');
    } else {
      const traceUrl = `${window.location.origin}${API_BASE}/playwright-runs/${id}/trace`;
      window.open(`${traceViewerBase}?trace=${encodeURIComponent(traceUrl)}`, '_blank');
    }
  });
  document.getElementById('download-ui-trace-btn')?.addEventListener('click', () => {
    const id = document.getElementById('download-ui-trace-btn').getAttribute('data-playwright-run-id');
    if (id) window.location.href = `${API_BASE}/playwright-runs/${id}/trace`;
  });
  document.getElementById('delete-ui-run-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('delete-ui-run-btn');
    const id = btn?.getAttribute('data-playwright-run-id');
    if (!id) return;
    if (!confirm('Delete this run and all its artifacts (reports, videos, traces)? This cannot be undone.')) return;
    try {
      await apiRequest(`/playwright-runs/${id}`, { method: 'DELETE' });
      showView('test-runs');
      if (typeof loadTestRuns === 'function') loadTestRuns();
      alert('Run deleted successfully.');
    } catch (err) {
      alert('Error deleting run: ' + (err.message || err));
    }
  });
  // Per-result video/trace links (event delegation; use closest so click on icon still works)
  document.getElementById('playwright-results-list')?.addEventListener('click', (e) => {
    const videoBtn = e.target.closest('.result-video-link');
    const traceBtn = e.target.closest('.result-trace-link');
    if (videoBtn) {
      e.preventDefault();
      const runId = videoBtn.getAttribute('data-run-id');
      const resultId = videoBtn.getAttribute('data-result-id');
      if (runId && resultId) window.open(`${API_BASE}/playwright-runs/${runId}/results/${resultId}/video`, '_blank');
    } else if (traceBtn) {
      e.preventDefault();
      const runId = traceBtn.getAttribute('data-run-id');
      const resultId = traceBtn.getAttribute('data-result-id');
      if (!runId || !resultId) return;
      const traceViewerBase = 'https://trace.playwright.dev/';
      const hostname = window.location.hostname;
      const isLocalOrPrivate = /^localhost$|^127\.0\.0\.1$|\.local$/i.test(hostname) ||
        /^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^169\.254\./i.test(hostname) ||
        /docker|\.internal$/i.test(hostname);
      const traceUrl = `${window.location.origin}${API_BASE}/playwright-runs/${runId}/results/${resultId}/trace`;
      if (isLocalOrPrivate) {
        window.open(traceViewerBase, '_blank');
        alert('Trace Viewer opened. Open the trace URL in the viewer or download the trace and drag the .zip in.');
      } else {
        window.open(`${traceViewerBase}?trace=${encodeURIComponent(traceUrl)}`, '_blank');
      }
    }
  });
});

  window.viewPlaywrightRun = viewPlaywrightRun;
  window.loadPlaywrightRuns = loadPlaywrightRuns;
  window.showRunUiTestsPage = showRunUiTestsPage;
  window.showProjectRecordedTestsView = showProjectRecordedTestsView;
  window.getSavedUiTestVariableGroups = loadSavedUiTestVariableGroups;
  window.getSavedUiTestVariableGroupById = getSavedUiTestVariableGroupById;
  window.mergeSavedUiTestVariableGroup = mergeSavedUiTestVariableGroup;
  window.resolveUiVariableValues = resolveUiVariableValues;
  window.extractUiVariableNamesFromSpecText = extractUiVariableNamesFromSpecText;
  window.showUiTestVariableGroupsManager = showUiTestVariableGroupsManager;
})();

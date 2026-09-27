// UI Tests (Playwright) – list, run form, detail, report (scoped to avoid duplicate globals)
(function() {
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

        function scrollAppToTop() {
            requestAnimationFrame(() => {
                window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                const main = document.querySelector('main');
                if (main) main.scrollTop = 0;
                const activeView = document.querySelector('.view.active');
                if (activeView) activeView.scrollTop = 0;
            });
        }

        function showView(viewId) {
            const activeEl = document.querySelector('.view.active');
            const currentId = activeEl && activeEl.id ? activeEl.id.replace(/-view$/, '') : null;
            if (currentId && currentId !== viewId) {
                window._uiTestsReturnView = currentId;
            }
            // Remove the full-height layout class when leaving the recorded-test view.
            if (currentId === 'add-recorded-test' && viewId !== 'add-recorded-test') {
                document.querySelector('main')?.classList.remove('main-split-layout');
            }
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const el = document.getElementById(`${viewId}-view`);
            if (el) el.classList.add('active');
            if (currentId !== viewId) scrollAppToTop();
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            const navBtn = document.querySelector(`[data-view="${viewId}"]`);
            if (navBtn) navBtn.classList.add('active');
        }

        function showModal(title, content) {
            window.showModal(title, content);
        }

        function hideModal() {
            window.hideModal();
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
                const content = isUnavailable ?
                    serverUnavailableMessage() :
                    'Error loading UI test runs: ' + escapeHtml(err.message);
                listEl.innerHTML = `<div class="empty-state"><p>${content}</p></div>`;
            }
        }

        let testList = [];
        let selectedRunUiTestOrder = [];
        let draggedRunUiTestId = null;
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
            const merged = {...(baseValues && typeof baseValues === 'object' ? baseValues : {}) };
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
            const groupEntries = group && group.variables && typeof group.variables === 'object' ?
                Object.entries(group.variables) :
                [];
            const groupByLower = new Map(groupEntries.map(([key, value]) => [normalizeUiVariableKey(key).toLowerCase(), value == null ? '' : String(value)]));

            (Array.isArray(variableNames) ? variableNames : []).forEach((name) => {
                const normalizedName = normalizeUiVariableKey(name);
                if (!normalizedName) return;
                const currentValue = currentValues && Object.prototype.hasOwnProperty.call(currentValues, normalizedName) ?
                    String(currentValues[normalizedName] == null ? '' : currentValues[normalizedName]) :
                    '';
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

        function updateRecordedSpecStats() {
            const stats = document.getElementById('recorded-spec-stats');
            if (!stats) return;
            const spec = getSpecValue();
            if (!spec.trim()) { stats.textContent = ''; if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries(); return; }
            const lines = spec.split('\n').length;
            const kb = (new TextEncoder().encode(spec).length / 1024).toFixed(1);
            stats.textContent = `${lines} lines · ${kb} KB`;
            if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries();
        }

        // Live syntax highlighting via CodeMirror.
        let specEditor = null;
        let suppressSpecNotice = false;
        let suppressValidationClear = false;
        let suppressBaselineUpdate = false;
        let recordedSpecBaseline = '';

        // Auto-fix toggle — persisted across page loads.
        let autoFixEnabled = localStorage.getItem('specAutoFix') !== 'false';

        function updateAutoFixToggle() {
            const btn = document.getElementById('auto-fix-spec-btn');
            if (!btn) return;
            btn.textContent = autoFixEnabled ? 'Auto-fix: ON' : 'Auto-fix: OFF';
            btn.classList.toggle('auto-fix-on', autoFixEnabled);
        }

        function initSpecEditor() {
            if (specEditor) return;
            const ta = document.getElementById('recorded-test-spec');
            if (!ta || typeof CodeMirror === 'undefined') return;
            specEditor = CodeMirror.fromTextArea(ta, {
                mode: 'javascript',
                theme: 'tomorrow-night-eighties',
                lineNumbers: true,
                lineWrapping: false,
                matchBrackets: true,
                indentUnit: 2,
                tabSize: 2,
                extraKeys: { Tab: 'indentMore', 'Shift-Tab': 'indentLess' },
            });
            specEditor.setSize('100%', '100%');
            specEditor.on('change', () => {
                specEditor.save();
                if (!suppressBaselineUpdate) recordedSpecBaseline = specEditor.getValue();
                updateRecordedTestDetectedVariablesPreview();
                if (!suppressValidationClear) clearRecordedTestValidationResults();
                updateRecordedSpecStats();
                if (!suppressSpecNotice && window.UiDiscover) window.UiDiscover.onSpecLoaded(specEditor.getValue());
            });
            // Normalize pasted Codegen output via backend (best-effort, silent on failure).
            specEditor.on('paste', () => {
                if (!autoFixEnabled) return;
                setTimeout(async() => {
                    const snapshot = specEditor.getValue();
                    if (!snapshot.trim()) return;
                    try {
                        const res = await apiRequest('/playwright-recorded-tests/normalize-draft', {
                            method: 'POST',
                            body: { spec_content: snapshot }
                        });
                        if (res.specContent && specEditor.getValue() === snapshot && res.specContent !== snapshot) {
                            setSpecValue(res.specContent);
                            updateRecordedTestDetectedVariablesPreview();
                            clearRecordedTestValidationResults();
                            updateRecordedSpecStats();
                        }
                    } catch (_) { /* silent */ }
                }, 0);
            });
        }

        function getSpecValue() {
            if (specEditor) return specEditor.getValue();
            return document.getElementById('recorded-test-spec')?.value || '';
        }

        function setSpecValue(value, options) {
            const v = value || '';
            const fromDiscover = !!(options && options.fromDiscover);
            const preserveResults = !!(options && options.preserveResults);
            const keepBaseline = !!(options && (options.keepBaseline || options.fromDiscover));
            if (!keepBaseline) recordedSpecBaseline = v;
            if (specEditor) {
                suppressSpecNotice = fromDiscover;
                suppressValidationClear = preserveResults;
                suppressBaselineUpdate = keepBaseline;
                specEditor.setValue(v);
                suppressSpecNotice = false;
                suppressValidationClear = false;
                suppressBaselineUpdate = false;
                return;
            }
            const ta = document.getElementById('recorded-test-spec');
            if (ta) ta.value = v;
            if (!fromDiscover && window.UiDiscover) window.UiDiscover.onSpecLoaded(v);
        }

        function updateRecordedTestDetectedVariablesPreview() {
            const wrap = document.getElementById('recorded-test-detected-vars-wrap');
            const list = document.getElementById('recorded-test-detected-vars');
            const specInput = document.getElementById('recorded-test-spec');
            const groupSelect = document.getElementById('recorded-test-variable-group');
            if (!wrap || !list || !groupSelect) return;
            const variableNames = extractUiVariableNamesFromSpecText(getSpecValue());
            if (variableNames.length === 0) {
                wrap.style.display = 'none';
                list.innerHTML = '';
                if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries();
                return;
            }
            const currentValues = collectUiVariableInputValues(list, '.recorded-test-variable-value');
            const mergedValues = resolveUiVariableValues(variableNames, groupSelect.value, currentValues);
            wrap.style.display = 'block';
            renderUiVariableInputs(list, variableNames, mergedValues, {
                inputClass: 'recorded-test-variable-value',
                idPrefix: 'recorded-test-variable',
                emptyMessage: 'No UI variables detected.'
            });
            if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries();
        }

        function showUiTestVariableGroupEditor(group = null, onDone = null) {
            const existing = group || { id: null, name: '', variables: {} };
            const rowsHtml = Object.entries(existing.variables || {}).map(([key, value]) => `
      <div class="ui-variable-group-row">
        <input type="text" class="form-control ui-variable-group-key" placeholder="Variable name" value="${escapeHtml(key)}">
        <input type="text" class="form-control ui-variable-group-value" placeholder="Value" value="${escapeHtml(String(value || ''))}">
        <span class="ui-variable-row-source">Manual</span>
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
                row.innerHTML = `
        <input type="text" class="form-control ui-variable-group-key" placeholder="Variable name" value="${escapeHtml(key)}">
        <input type="text" class="form-control ui-variable-group-value" placeholder="Value" value="${escapeHtml(value)}">
        <span class="ui-variable-row-source">Manual</span>
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
                const nextGroups = existing.id ?
                    groups.map((item) => item.id === existing.id ? nextGroup : item) :
                    [...groups, nextGroup];
                saveUiTestVariableGroups(nextGroups);
                if (typeof onDone === 'function') onDone(true, nextGroup.id);
                showUiTestVariableGroupsManager(onDone, nextGroup.id);
            });
            if (!rowsHtml) addRow();
        }

        function showUiTestVariableGroupsManager(onDone = null, preferredId = '', options = {}) {
            const availableTests = Array.isArray(options.tests) ? options.tests : [];
            const staticProposedVariables = Array.isArray(options.proposedVariables) ?
                options.proposedVariables.map(normalizeUiVariableKey).filter(Boolean) :
                [];
            let activeGroupId = preferredId || '';
            let selectedTestIds = new Set((Array.isArray(options.selectedTestIds) ? options.selectedTestIds : [])
                .map((id) => String(id))
                .filter(Boolean));
            let draftVariables = {};

            const preferredGroup = getSavedUiTestVariableGroupById(activeGroupId);
            if (preferredGroup && preferredGroup.variables && typeof preferredGroup.variables === 'object') {
                draftVariables = {...preferredGroup.variables };
            }

            const getSelectedTestsInManager = () => availableTests.filter((test) => selectedTestIds.has(String(test.id)));
            const getProposedVariables = () => Array.from(new Set([
                ...getUiVariableNamesForTests(getSelectedTestsInManager()),
                ...staticProposedVariables
            ].map(normalizeUiVariableKey).filter(Boolean))).sort((a, b) => a.localeCompare(b));
            const collectBuilderVariables = () => {
                const variables = {};
                document.querySelectorAll('#ui-variable-builder-rows .ui-variable-group-row').forEach((row) => {
                    const key = normalizeUiVariableKey(row.querySelector('.ui-variable-group-key')?.value?.trim());
                    const value = row.querySelector('.ui-variable-group-value')?.value ?? '';
                    if (key) variables[key] = value;
                });
                return variables;
            };

            showModal('UI Test Variable groups', `
      <div class="ui-variable-manager">
        <div class="ui-variable-manager-header">
          <div>
            <p class="ui-variable-manager-kicker">Reusable browser-local values</p>
            <p class="muted">Select UI tests to propose their required variables, then save the values as a reusable group.</p>
          </div>
          <button type="button" class="btn btn-secondary" id="ui-variable-group-close">Close</button>
        </div>

        <div class="ui-variable-manager-grid">
          <section class="ui-variable-manager-panel ui-variable-manager-tests-panel">
            <div class="ui-variable-manager-panel-heading">
              <div>
                <h3>Available UI tests</h3>
                <p id="ui-variable-test-selection-summary">0 selected</p>
              </div>
              <div class="ui-variable-manager-mini-actions">
                <button type="button" class="btn btn-link" id="ui-variable-select-all-tests">Select all</button>
                <button type="button" class="btn btn-link" id="ui-variable-clear-tests">Clear</button>
              </div>
            </div>
            <input type="search" class="form-control" id="ui-variable-test-search" placeholder="Search UI tests..." autocomplete="off">
            <div id="ui-variable-test-list" class="ui-variable-test-list"></div>
          </section>

          <section class="ui-variable-manager-panel ui-variable-manager-builder-panel">
            <div class="ui-variable-manager-panel-heading">
              <div>
                <h3>Variable group</h3>
                <p id="ui-variable-builder-summary">No variables proposed yet.</p>
              </div>
              <button type="button" class="btn btn-secondary" id="ui-variable-group-new">New group</button>
            </div>
            <div class="form-group">
              <label for="ui-variable-group-name">Group name</label>
              <input type="text" id="ui-variable-group-name" class="form-control" placeholder="e.g. Portal smoke login" value="${escapeHtml(preferredGroup?.name || '')}">
            </div>
            <div class="ui-variable-builder-toolbar">
              <span>Variables proposed by selected tests</span>
              <button type="button" class="btn btn-secondary" id="ui-variable-group-add-row">Add variable</button>
            </div>
            <div id="ui-variable-builder-rows" class="ui-variable-builder-rows"></div>
            <div class="ui-variable-manager-actions">
              <button type="button" class="btn btn-primary" id="ui-variable-group-save">Save group</button>
            </div>
          </section>
        </div>

        <section class="ui-variable-manager-panel ui-variable-saved-panel">
          <div class="ui-variable-manager-panel-heading">
            <div>
              <h3>Saved groups</h3>
              <p>Reuse, edit, or delete values stored in this browser.</p>
            </div>
            <button type="button" class="btn btn-primary" id="ui-variable-group-create">Add group</button>
          </div>
          <div id="ui-variable-group-list" class="ui-variable-saved-list"></div>
        </section>
      </div>
    `);

            const renderTests = () => {
                    const listEl = document.getElementById('ui-variable-test-list');
                    const summaryEl = document.getElementById('ui-variable-test-selection-summary');
                    if (!listEl) return;
                    const query = String(document.getElementById('ui-variable-test-search')?.value || '').trim().toLowerCase();
                    const filteredTests = availableTests.filter((test) => recordedTestMatchesQuery(test, query));
                    if (summaryEl) summaryEl.textContent = `${selectedTestIds.size} selected`;
                    if (availableTests.length === 0) {
                        listEl.innerHTML = '<div class="empty-state"><p>No UI tests are available from this context.</p></div>';
                        return;
                    }
                    if (filteredTests.length === 0) {
                        listEl.innerHTML = '<div class="empty-state"><p>No UI tests match this search.</p></div>';
                        return;
                    }
                    listEl.innerHTML = filteredTests.map((test) => {
                                const testId = String(test.id);
                                const variableNames = Array.isArray(test.variable_names) ? test.variable_names : [];
                                return `
          <label class="ui-variable-test-option ${selectedTestIds.has(testId) ? 'selected' : ''}">
            <input type="checkbox" class="ui-variable-test-check" data-test-id="${escapeHtml(testId)}" ${selectedTestIds.has(testId) ? 'checked' : ''}>
            <span>
              <strong>${escapeHtml(test.name || 'Unnamed UI test')}${recordedTestLabelHtml(test.label)}</strong>
              <small>${variableNames.length ? `${variableNames.length} variable${variableNames.length === 1 ? '' : 's'}` : 'No variables detected'}</small>
            </span>
          </label>
        `;
      }).join('');
      listEl.querySelectorAll('.ui-variable-test-check').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const testId = checkbox.getAttribute('data-test-id');
          if (!testId) return;
          if (checkbox.checked) selectedTestIds.add(testId);
          else selectedTestIds.delete(testId);
          draftVariables = collectBuilderVariables();
          renderTests();
          renderBuilderVariables();
        });
      });
    };

    const addBuilderRow = (key = '', value = '', proposed = false) => {
      const rowsEl = document.getElementById('ui-variable-builder-rows');
      if (!rowsEl) return;
      if (rowsEl.querySelector('.ui-variable-builder-empty')) rowsEl.innerHTML = '';
      const row = document.createElement('div');
      row.className = `ui-variable-group-row ${proposed ? 'is-proposed' : 'is-manual'}`;
      row.innerHTML = `
        <input type="text" class="form-control ui-variable-group-key" placeholder="Variable name" value="${escapeHtml(key)}">
        <input type="text" class="form-control ui-variable-group-value" placeholder="Value" value="${escapeHtml(String(value || ''))}">
        <span class="ui-variable-row-source">${proposed ? 'Detected' : 'Manual'}</span>
        <button type="button" class="btn btn-secondary ui-variable-group-remove">Remove</button>
      `;
      rowsEl.appendChild(row);
      row.querySelector('.ui-variable-group-remove')?.addEventListener('click', () => row.remove());
    };

    const renderBuilderVariables = () => {
      const rowsEl = document.getElementById('ui-variable-builder-rows');
      const summaryEl = document.getElementById('ui-variable-builder-summary');
      if (!rowsEl) return;
      const currentVariables = { ...draftVariables, ...collectBuilderVariables() };
      const proposedVariables = getProposedVariables();
      const proposedSet = new Set(proposedVariables.map((name) => name.toLowerCase()));
      const manualVariables = Object.keys(currentVariables)
        .map(normalizeUiVariableKey)
        .filter((name) => name && !proposedSet.has(name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
      rowsEl.innerHTML = '';
      [...proposedVariables, ...manualVariables].forEach((name) => {
        addBuilderRow(name, currentVariables[name] || '', proposedSet.has(name.toLowerCase()));
      });
      if (summaryEl) {
        const selectedCount = selectedTestIds.size;
        summaryEl.textContent = proposedVariables.length
          ? `${proposedVariables.length} variable${proposedVariables.length === 1 ? '' : 's'} proposed from ${selectedCount} selected test${selectedCount === 1 ? '' : 's'}.`
          : 'Select tests or add variables manually.';
      }
      if (proposedVariables.length === 0 && manualVariables.length === 0) {
        rowsEl.innerHTML = '<div class="empty-state ui-variable-builder-empty"><p>Select UI tests to propose variables, or add a variable manually.</p></div>';
      }
    };

    const loadGroupIntoBuilder = (group, focusName = false) => {
      if (!group) return;
      activeGroupId = group.id;
      draftVariables = { ...(group.variables || {}) };
      const nameEl = document.getElementById('ui-variable-group-name');
      if (nameEl) {
        nameEl.value = group.name || '';
        if (focusName) nameEl.focus();
      }
      renderBuilderVariables();
      renderSavedGroups();
    };

    const renderSavedGroups = () => {
      const listEl = document.getElementById('ui-variable-group-list');
      if (!listEl) return;
      const groups = loadSavedUiTestVariableGroups();
      listEl.innerHTML = groups.length
        ? groups.map((group) => `
            <div class="ui-variable-saved-card ${group.id === activeGroupId ? 'active' : ''}" data-ui-variable-group-id="${escapeHtml(String(group.id))}">
              <div>
                <h4>${escapeHtml(group.name || '')}</h4>
                <p>${Object.keys(group.variables || {}).length} variable(s)</p>
              </div>
              <div class="ui-variable-saved-actions">
                <button type="button" class="btn btn-secondary ui-variable-group-use">Use</button>
                <button type="button" class="btn btn-secondary ui-variable-group-edit">Edit</button>
                <button type="button" class="btn btn-danger ui-variable-group-delete">Delete</button>
              </div>
            </div>
          `).join('')
        : '<div class="empty-state"><p>No UI Test Variable groups saved in this browser.</p></div>';
      listEl.querySelectorAll('.ui-variable-group-use').forEach((button) => {
        button.addEventListener('click', () => {
          const groupId = button.closest('[data-ui-variable-group-id]')?.getAttribute('data-ui-variable-group-id');
          const group = getSavedUiTestVariableGroupById(groupId);
          loadGroupIntoBuilder(group);
        });
      });
      listEl.querySelectorAll('.ui-variable-group-edit').forEach((button) => {
        button.addEventListener('click', () => {
          const groupId = button.closest('[data-ui-variable-group-id]')?.getAttribute('data-ui-variable-group-id');
          const group = getSavedUiTestVariableGroupById(groupId);
          loadGroupIntoBuilder(group, true);
        });
      });
      listEl.querySelectorAll('.ui-variable-group-delete').forEach((button) => {
        button.addEventListener('click', async () => {
          const groupId = button.closest('[data-ui-variable-group-id]')?.getAttribute('data-ui-variable-group-id');
          if (!groupId || !(await confirmDialog({ title: 'Delete variable group', message: 'Delete this UI Test Variable group?', confirmLabel: 'Delete variable group' }))) return;
          const nextGroups = loadSavedUiTestVariableGroups().filter((item) => item.id !== groupId);
          saveUiTestVariableGroups(nextGroups);
          if (activeGroupId === groupId) activeGroupId = '';
          if (typeof onDone === 'function') onDone(true, activeGroupId || '');
          renderSavedGroups();
        });
      });
    };

    document.getElementById('ui-variable-group-close')?.addEventListener('click', () => {
      if (typeof onDone === 'function') onDone(false, activeGroupId || '');
      hideModal();
    });
    document.getElementById('ui-variable-test-search')?.addEventListener('input', renderTests);
    document.getElementById('ui-variable-select-all-tests')?.addEventListener('click', () => {
      availableTests.forEach((test) => selectedTestIds.add(String(test.id)));
      draftVariables = collectBuilderVariables();
      renderTests();
      renderBuilderVariables();
    });
    document.getElementById('ui-variable-clear-tests')?.addEventListener('click', () => {
      selectedTestIds = new Set();
      draftVariables = collectBuilderVariables();
      renderTests();
      renderBuilderVariables();
    });
    document.getElementById('ui-variable-group-new')?.addEventListener('click', () => {
      activeGroupId = '';
      draftVariables = {};
      const nameEl = document.getElementById('ui-variable-group-name');
      if (nameEl) nameEl.value = '';
      renderBuilderVariables();
      renderSavedGroups();
    });
    document.getElementById('ui-variable-group-create')?.addEventListener('click', () => {
      activeGroupId = '';
      draftVariables = {};
      const nameEl = document.getElementById('ui-variable-group-name');
      if (nameEl) {
        nameEl.value = '';
        nameEl.focus();
      }
      renderBuilderVariables();
      renderSavedGroups();
    });
    document.getElementById('ui-variable-group-add-row')?.addEventListener('click', () => addBuilderRow('', '', false));
    document.getElementById('ui-variable-group-save')?.addEventListener('click', () => {
      const name = document.getElementById('ui-variable-group-name')?.value?.trim();
      if (!name) {
        alert('Group name is required.');
        return;
      }
      const variables = collectBuilderVariables();
      const groups = loadSavedUiTestVariableGroups();
      const nextGroup = {
        id: activeGroupId || `ui-var-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        variables
      };
      const nextGroups = groups.some((group) => group.id === nextGroup.id)
        ? groups.map((group) => group.id === nextGroup.id ? nextGroup : group)
        : [...groups, nextGroup];
      saveUiTestVariableGroups(nextGroups);
      activeGroupId = nextGroup.id;
      draftVariables = { ...variables };
      if (typeof onDone === 'function') onDone(true, nextGroup.id);
      renderSavedGroups();
    });

    renderTests();
    renderBuilderVariables();
    renderSavedGroups();
  }

  function getSelectedRunUiTests() {
    const listType = document.querySelector('input[name="test-list-type"]:checked')?.value || 'selected';
    if (listType === 'full') return testList.slice();
    const testById = new Map(testList.map((test) => [String(test.id), test]));
    return selectedRunUiTestOrder.map((id) => testById.get(String(id))).filter(Boolean);
  }

  function syncRunUiTestOrderWithList({ selectAll = false } = {}) {
    const availableIds = testList.map((test) => String(test.id));
    const availableSet = new Set(availableIds);
    const existing = selectedRunUiTestOrder.filter((id) => availableSet.has(String(id)));
    if (selectAll) {
      selectedRunUiTestOrder = availableIds;
      return;
    }
    selectedRunUiTestOrder = existing;
  }

  function moveRunUiTestInOrder(testId, targetIndex) {
    const id = String(testId);
    const currentIndex = selectedRunUiTestOrder.indexOf(id);
    if (currentIndex === -1) return false;
    const next = selectedRunUiTestOrder.slice();
    const [item] = next.splice(currentIndex, 1);
    const safeIndex = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(safeIndex, 0, item);
    selectedRunUiTestOrder = next;
    return currentIndex !== safeIndex;
  }

  function toggleRunUiTestSelected(testId, selected) {
    const id = String(testId);
    const exists = selectedRunUiTestOrder.includes(id);
    if (selected && !exists) selectedRunUiTestOrder.push(id);
    if (!selected && exists) selectedRunUiTestOrder = selectedRunUiTestOrder.filter((item) => item !== id);
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
    const projectId = window._runUiTestsProjectId ? String(window._runUiTestsProjectId) : null;
    if (!container) return;
    if (!projectId) {
      testList = [];
      selectedRunUiTestOrder = [];
      container.innerHTML = `<p class="test-list-empty">Open Run UI Tests from a project so only that project's recorded tests are shown.</p>`;
      renderRunUiSelectedOrderPanel(false);
      return;
    }
    try {
      const listUrl = `/playwright-tests/list?projectId=${projectId}`;
      const [tests, config] = await Promise.all([
        apiRequest(listUrl),
        apiRequest('/playwright-config').catch(() => ({}))
      ]);
      testList = tests;
      syncRunUiTestOrderWithList({ selectAll: true });
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
      const searchInput = document.getElementById('run-ui-tests-search');
      if (searchInput) {
        searchInput.oninput = () => {
          const showCb = document.querySelector('input[name="test-list-type"]:checked')?.value === 'selected';
          renderTestList(showCb);
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
    syncRunUiTestOrderWithList({ selectAll: !showCheckboxes });
    const testById = new Map(filtered.map((test) => [String(test.id), test]));
    const selectedIds = new Set(selectedRunUiTestOrder.map(String));
    const searchText = String(document.getElementById('run-ui-tests-search')?.value || '').trim().toLowerCase();
    const renderOrder = filtered.filter((test) => recordedTestMatchesQuery(test, searchText));
    if (!filtered.length) {
      container.innerHTML = `
        <p class="test-list-empty">No recorded tests in this project. Add recorded tests and link them to the project first.</p>
      `;
      renderRunUiSelectedOrderPanel(false);
      return;
    }

    if (!renderOrder.length) {
      container.innerHTML = `
        ${showCheckboxes ? `
          <div class="test-list-select-actions">
            <button type="button" class="btn btn-link" id="select-all-tests">Select all</button>
            <span class="test-list-select-sep">|</span>
            <button type="button" class="btn btn-link" id="deselect-all-tests">Deselect all</button>
          </div>
        ` : ''}
        <p class="test-list-empty">No tests match this search.</p>
      `;
      renderRunUiSelectedOrderPanel(showCheckboxes);
      return;
    }

    const listHtml = `
      <ul class="playwright-test-list ${showCheckboxes ? 'selectable' : ''}">
        ${renderOrder.map((t) => {
          const testId = String(t.id);
          const selectedIndex = selectedRunUiTestOrder.indexOf(testId);
          const isSelected = !showCheckboxes || selectedIndex !== -1;
          return `
          <li class="playwright-test-item ordered-ui-test-item ${isSelected ? 'selected' : 'not-selected'}" data-test-id="${escapeHtml(testId)}">
            ${showCheckboxes ? `<input type="checkbox" class="playwright-test-cb" data-test-id="${escapeHtml(testId)}" id="pt-${escapeHtml(testId)}" ${isSelected ? 'checked' : ''} />` : ''}
            <span class="ordered-ui-test-number">${isSelected ? selectedIndex + 1 : '—'}</span>
            <span class="playwright-test-name">${escapeHtml(t.name || '')}${recordedTestLabelHtml(t.label)}</span>
          </li>
        `;
        }).join('')}
      </ul>
    `;

    container.innerHTML = `
      ${showCheckboxes ? `
        <div class="test-list-select-actions">
          <button type="button" class="btn btn-link" id="select-all-tests">Select all</button>
          <span class="test-list-select-sep">|</span>
          <button type="button" class="btn btn-link" id="deselect-all-tests">Deselect all</button>
        </div>
      ` : ''}
      ${listHtml}
    `;
    renderRunUiSelectedOrderPanel(showCheckboxes);

    if (showCheckboxes) {
      container.querySelectorAll('.playwright-test-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          toggleRunUiTestSelected(cb.getAttribute('data-test-id'), cb.checked);
          renderTestList(true);
          updateRunUiTestVariablesUI({ preserveValues: true });
        });
      });
      container.querySelector('#select-all-tests')?.addEventListener('click', () => {
        const visibleIds = new Set(renderOrder.map((test) => String(test.id)));
        const next = selectedRunUiTestOrder.filter((id) => !visibleIds.has(String(id)));
        renderOrder.forEach((test) => next.push(String(test.id)));
        selectedRunUiTestOrder = next;
        renderTestList(true);
        updateRunUiTestVariablesUI({ preserveValues: true });
      });
      container.querySelector('#deselect-all-tests')?.addEventListener('click', () => {
        const visibleIds = new Set(renderOrder.map((test) => String(test.id)));
        selectedRunUiTestOrder = selectedRunUiTestOrder.filter((id) => !visibleIds.has(String(id)));
        renderTestList(true);
        updateRunUiTestVariablesUI({ preserveValues: true });
      });
    }
  }

  function renderRunUiSelectedOrderPanel(showOrderPanel) {
    const wrap = document.getElementById('run-ui-tests-selected-order-wrap');
    const list = document.getElementById('run-ui-tests-selected-order-list');
    const count = document.getElementById('run-ui-tests-selected-count');
    if (!wrap || !list) return;
    if (!showOrderPanel || selectedRunUiTestOrder.length === 0) {
      wrap.style.display = 'none';
      list.innerHTML = '';
      if (count) count.textContent = '0 selected';
      return;
    }
    const testById = new Map(testList.map((test) => [String(test.id), test]));
    const selected = selectedRunUiTestOrder.map((id) => testById.get(String(id))).filter(Boolean);
    wrap.style.display = 'block';
    if (count) count.textContent = `${selected.length} selected`;
    list.innerHTML = selected.map((test, index) => {
      const id = String(test.id);
      return `
        <div class="run-ui-selected-order-item" data-test-id="${escapeHtml(id)}" draggable="true">
          <span class="ordered-ui-test-drag" title="Drag to reorder" aria-hidden="true">::</span>
          <span class="ordered-ui-test-number">${index + 1}</span>
          <span class="run-ui-selected-order-name">${escapeHtml(test.name || '')}</span>
          <span class="ordered-ui-test-actions">
            <button type="button" class="btn btn-sm btn-secondary run-ui-test-move-up" data-test-id="${escapeHtml(id)}" ${index === 0 ? 'disabled' : ''} title="Move up">Up</button>
            <button type="button" class="btn btn-sm btn-secondary run-ui-test-move-down" data-test-id="${escapeHtml(id)}" ${index === selected.length - 1 ? 'disabled' : ''} title="Move down">Down</button>
            <button type="button" class="btn btn-sm btn-danger run-ui-test-remove" data-test-id="${escapeHtml(id)}" title="Remove from run">×</button>
          </span>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.run-ui-test-move-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-test-id');
        const index = selectedRunUiTestOrder.indexOf(String(id));
        if (index > 0 && moveRunUiTestInOrder(id, index - 1)) {
          renderTestList(true);
          updateRunUiTestVariablesUI({ preserveValues: true });
        }
      });
    });
    list.querySelectorAll('.run-ui-test-move-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-test-id');
        const index = selectedRunUiTestOrder.indexOf(String(id));
        if (index !== -1 && index < selectedRunUiTestOrder.length - 1 && moveRunUiTestInOrder(id, index + 1)) {
          renderTestList(true);
          updateRunUiTestVariablesUI({ preserveValues: true });
        }
      });
    });
    list.querySelectorAll('.run-ui-test-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-test-id');
        selectedRunUiTestOrder = selectedRunUiTestOrder.filter((item) => String(item) !== String(id));
        renderTestList(true);
        updateRunUiTestVariablesUI({ preserveValues: true });
      });
    });
    list.querySelectorAll('.run-ui-selected-order-item').forEach((item) => {
        item.addEventListener('dragstart', (event) => {
          draggedRunUiTestId = item.getAttribute('data-test-id');
          item.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedRunUiTestId || '');
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          draggedRunUiTestId = null;
        });
        item.addEventListener('dragover', (event) => {
          if (!draggedRunUiTestId) return;
          event.preventDefault();
          item.classList.add('drag-over');
          event.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', (event) => {
          event.preventDefault();
          item.classList.remove('drag-over');
          const targetId = item.getAttribute('data-test-id');
          const sourceId = draggedRunUiTestId || event.dataTransfer.getData('text/plain');
          if (!sourceId || !targetId || sourceId === targetId) return;
          const targetIndex = selectedRunUiTestOrder.indexOf(String(targetId));
          if (targetIndex !== -1 && moveRunUiTestInOrder(sourceId, targetIndex)) {
            renderTestList(true);
            updateRunUiTestVariablesUI({ preserveValues: true });
          }
        });
      });
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
      alert('Open Run UI Tests from a project first.');
      return;
    }
    const filtered = testList;
    const runOnlyIds = listType === 'selected'
      ? selectedRunUiTestOrder.slice()
      : filtered.map(t => t.id);
    const selectedTests = listType === 'selected'
      ? getSelectedRunUiTests()
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
        window.trackUsage?.('run_ui_tests');
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
    const selectedTests = getSelectedRunUiTests();
    showUiTestVariableGroupsManager((_changed, preferredId) => {
      populateUiVariableGroupSelect(groupSelect, preferredId || groupSelect?.value || '');
      updateRunUiTestVariablesUI({ preserveValues: false });
    }, groupSelect?.value || '', {
      tests: testList,
      selectedTestIds: selectedTests.map((test) => test.id)
    });
  });

  document.getElementById('manage-recorded-test-variable-groups-btn')?.addEventListener('click', () => {
    const groupSelect = document.getElementById('recorded-test-variable-group');
    showUiTestVariableGroupsManager((_changed, preferredId) => {
      populateUiVariableGroupSelect(groupSelect, preferredId || groupSelect?.value || '');
      updateRecordedTestDetectedVariablesPreview();
      clearRecordedTestValidationResults();
    }, groupSelect?.value || '', {
      proposedVariables: extractUiVariableNamesFromSpecText(getSpecValue())
    });
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

  function recordedResultPane(kind) {
    return document.getElementById(kind === 'preview' ? 'recorded-preview-results' : 'recorded-test-validation-results');
  }

  const recordedQualityWarnings = { preview: [], test: [] };

  function recordedCorrectionIsApplicable(warning) {
    const text = String(warning || '');
    return text.includes('toBeVisible({ timeout: 15000 })')
      || text.includes('toHaveURL')
      || text.includes("waitUntil: 'domcontentloaded'")
      || text.includes('explicit navigation timeout')
      || text.includes('ignoreHTTPSErrors');
  }

  function recordedResultCorrectionWarnings() {
    const seen = new Set();
    const unique = [];
    [...recordedQualityWarnings.preview, ...recordedQualityWarnings.test].forEach((warning) => {
      if (!warning || seen.has(warning)) return;
      seen.add(warning);
      unique.push(warning);
    });
    return unique;
  }

  function updateApplyCorrectionsButton() {
    const button = document.getElementById('apply-result-corrections-btn');
    const hint = document.getElementById('recorded-test-validation-hint');
    const warnings = recordedResultCorrectionWarnings();
    const applicable = warnings.filter(recordedCorrectionIsApplicable);
    const sources = [];
    if (recordedQualityWarnings.preview.some(recordedCorrectionIsApplicable)) sources.push('Preview');
    if (recordedQualityWarnings.test.some(recordedCorrectionIsApplicable)) sources.push('Test recorded test');
    if (button) {
      button.disabled = applicable.length === 0;
      button.textContent = applicable.length ? `Apply corrections (${applicable.length})` : 'Apply corrections';
      button.title = applicable.length
        ? `Apply ${applicable.length} recommended correction${applicable.length === 1 ? '' : 's'} from ${sources.join(' and ')} into this code, then run it again.`
        : 'Run Preview or Test recorded test. Recommended corrections from those results can be applied here.';
    }
    if (hint) {
      if (hint.dataset.appliedNote && applicable.length) {
        hint.textContent = hint.dataset.appliedNote;
      } else {
        delete hint.dataset.appliedNote;
        hint.textContent = applicable.length
          ? `${applicable.length} recommended correction${applicable.length === 1 ? '' : 's'} from ${sources.join(' and ')} ${applicable.length === 1 ? 'is' : 'are'} listed in Results. Apply corrections adds ${applicable.length === 1 ? 'it' : 'them'} to this code so you can run the test again.`
          : 'Run a draft validation to check this code before saving. Draft validations do not create test runs or reports.';
      }
    }
  }

  function recordedResultTitle(kind, payload) {
    const summary = payload && payload.summary ? payload.summary : {};
    const isFailure = !!(payload && payload.error) || Number(summary.failed) > 0;
    if (payload && payload.running) return kind === 'preview' ? 'Preview running' : 'Test recorded test running';
    if (kind === 'preview') return isFailure ? 'Preview failed' : 'Preview passed';
    return isFailure ? 'Test recorded test failed' : 'Test recorded test passed';
  }

  function resetRecordedResultPane(kind) {
    const pane = recordedResultPane(kind);
    if (!pane) return;
    const isPreview = kind === 'preview';
    pane.dataset.statusLabel = isPreview ? 'Preview not run' : 'Test recorded test not run';
    pane.dataset.ran = '0';
    delete pane.dataset.passed;
    delete pane.dataset.failed;
    pane.innerHTML = `<p class="form-hint">${isPreview ? 'Preview has not been run.' : 'Test recorded test has not been run.'}</p>`;
    recordedQualityWarnings[kind] = [];
    updateApplyCorrectionsButton();
  }

  function openRecordedSection(name) {
    document.querySelectorAll('#recorded-test-form .recorded-focus-section').forEach((section) => {
      const open = section.dataset.recordedSection === name;
      section.classList.toggle('open', open);
      const bar = section.querySelector('.recorded-focus-bar');
      if (bar) bar.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (name === 'code' && specEditor) requestAnimationFrame(() => specEditor.refresh());
  }

  function refreshRecordedSectionSummaries() {
    const details = document.getElementById('recorded-summary-details');
    const source = document.getElementById('recorded-summary-source');
    const steps = document.getElementById('recorded-summary-steps');
    const code = document.getElementById('recorded-summary-code');
    const results = document.getElementById('recorded-summary-results');
    if (details) {
      const name = document.getElementById('recorded-test-name')?.value.trim();
      const label = document.getElementById('recorded-test-label')?.value.trim();
      const projectSelect = document.getElementById('recorded-test-add-to-project');
      const project = projectSelect && projectSelect.value ? projectSelect.options[projectSelect.selectedIndex].text : '';
      const parts = [name, label, project].filter(Boolean);
      details.textContent = parts.length ? parts.join(' · ') : 'Name, label, and project';
    }
    if (source) {
      const url = document.getElementById('recorded-test-codegen-url')?.value.trim();
      const groupSelect = document.getElementById('recorded-test-variable-group');
      const group = groupSelect && groupSelect.value ? groupSelect.options[groupSelect.selectedIndex].text : '';
      const variableNames = [...document.querySelectorAll('#recorded-test-detected-vars [data-var-name]')].map((input) => input.getAttribute('data-var-name'));
      const codegenOpen = document.getElementById('codegen-vnc-panel') && document.getElementById('codegen-vnc-panel').style.display !== 'none';
      const parts = [codegenOpen ? 'Codegen' : '', url, group, variableNames.join(', ')].filter(Boolean);
      source.textContent = parts.length ? parts.join(' · ') : 'Base URL and variables';
    }
    if (steps) {
      const list = document.getElementById('recorded-step-list');
      const titles = list && !list.hidden ? [...list.querySelectorAll('strong')].map((item) => item.textContent.trim()).filter(Boolean) : [];
      steps.textContent = titles.length ? `${titles.length} step${titles.length === 1 ? '' : 's'} · ${titles.slice(0, 3).join(', ')}` : 'No steps';
    }
    if (code) {
      const stats = document.getElementById('recorded-spec-stats')?.textContent.trim();
      code.textContent = stats || 'No code yet';
    }
    if (results) {
      const preview = document.getElementById('recorded-preview-results');
      const test = document.getElementById('recorded-test-validation-results');
      const previewLabel = preview?.dataset.statusLabel || 'Preview not run';
      const testLabel = test?.dataset.statusLabel || 'Test recorded test not run';
      const counts = test && test.dataset.ran === '1' ? ` · ${test.dataset.passed || 0} passed, ${test.dataset.failed || 0} failed` : '';
      results.textContent = `${previewLabel} · ${testLabel}${counts}`;
    }
  }

  function bindRecordedSectionChrome() {
    const form = document.getElementById('recorded-test-form');
    if (!form || form.dataset.sectionsBound === '1') return;
    form.dataset.sectionsBound = '1';
    form.querySelectorAll('.recorded-focus-bar').forEach((bar) => {
      bar.addEventListener('click', () => {
        const section = bar.closest('.recorded-focus-section');
        if (section) openRecordedSection(section.dataset.recordedSection);
      });
    });
    ['recorded-test-name', 'recorded-test-label', 'recorded-test-add-to-project', 'recorded-test-codegen-url', 'recorded-test-variable-group'].forEach((id) => {
      const field = document.getElementById(id);
      if (!field) return;
      field.addEventListener('input', refreshRecordedSectionSummaries);
      field.addEventListener('change', refreshRecordedSectionSummaries);
    });
  }

  function clearRecordedTestValidationResults() {
    resetRecordedResultPane('preview');
    resetRecordedResultPane('test');
    const validateBtn = document.getElementById('recorded-test-validate');
    if (validateBtn) {
      validateBtn.disabled = false;
      validateBtn.textContent = 'Test recorded test';
    }
    const previewBtn = document.getElementById('recorded-step-preview');
    if (previewBtn) {
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview';
    }
    refreshRecordedSectionSummaries();
  }

  function setRecordedTestValidationPending(isPending, kind) {
    if (kind === 'preview') {
      const previewBtn = document.getElementById('recorded-step-preview');
      if (previewBtn) {
        previewBtn.disabled = !!isPending;
        previewBtn.textContent = isPending ? 'Previewing...' : 'Preview';
      }
      return;
    }
    const validateBtn = document.getElementById('recorded-test-validate');
    const saveBtn = document.getElementById('recorded-test-save');
    if (validateBtn) {
      validateBtn.disabled = !!isPending;
      validateBtn.textContent = isPending ? 'Testing...' : 'Test recorded test';
    }
    if (saveBtn) saveBtn.disabled = !!isPending;
  }

  function renderRecordedTestValidationResults(payload, kind) {
    const resultKind = kind === 'preview' ? 'preview' : 'test';
    const resultsEl = recordedResultPane(resultKind);
    if (!resultsEl) return;
    const summary = payload && payload.summary ? payload.summary : { total: 0, passed: 0, failed: 0 };
    const results = Array.isArray(payload && payload.results) ? payload.results : [];
    const qualityWarnings = Array.isArray(payload && payload.quality_warnings) ? payload.quality_warnings : [];
    const options = payload && payload.options ? payload.options : {};
    const artifacts = payload && payload.artifacts ? payload.artifacts : {};
    const output = payload && payload.output ? String(payload.output) : '';
    const isFailure = !!(payload && payload.error) || summary.failed > 0;
    const statusLabel = recordedResultTitle(resultKind, payload);
    const statusColor = payload && payload.error ? '#991b1b' : (isFailure ? '#92400e' : '#065f46');
    const statusBackground = payload && payload.error ? '#fee2e2' : (isFailure ? '#fef3c7' : '#d1fae5');
    const validationsHtml = results.length > 0
      ? results.map((result) => {
          const rowValidations = (result.assertions && Array.isArray(result.assertions.validations))
            ? result.assertions.validations.map((validation) => `
              <li class="light-surface" style="display:flex; align-items:flex-start; gap:8px; padding:8px 10px; margin-bottom:4px; border-radius:6px; background:#fff; border:1px solid #e5e7eb; border-left:4px solid ${validation.passed ? '#10b981' : '#ef4444'};">
                <span style="flex-shrink:0; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; background:${validation.passed ? '#d1fae5' : '#fee2e2'}; color:${validation.passed ? '#065f46' : '#991b1b'};">${validation.passed ? 'Passed' : 'Failed'}</span>
                <div><span style="font-size:13px;">${escapeHtml(validation.description || 'Validation')}</span>${validation.detail ? `<div style="font-size:11px; color:#6b7280; margin-top:2px; white-space:pre-wrap;">${escapeHtml(validation.detail)}</div>` : ''}</div>
              </li>`).join('')
            : '';
          const evidence = result && result.evidence ? result.evidence : {};
          const evidenceLinks = (evidence.screenshot_url || evidence.error_context_url)
            ? `<div class="validation-artifact-actions">
                ${evidence.screenshot_url ? `<a class="btn btn-secondary btn-sm validation-artifact-link" href="${escapeHtml(evidence.screenshot_url)}" target="_blank" rel="noopener noreferrer">View screenshot evidence</a>` : ''}
                ${evidence.error_context_url ? `<a class="btn btn-secondary btn-sm validation-artifact-link" href="${escapeHtml(evidence.error_context_url)}" target="_blank" rel="noopener noreferrer">View error context</a>` : ''}
              </div>`
            : '';
          return `
            <div class="test-result-item" style="margin-top: 12px;">
              <div class="test-result-header">
                <div><strong>${escapeHtml(result.testName || 'Recorded draft')}</strong></div>
                <span class="status-badge ${escapeHtml(result.status || 'pending')}">${escapeHtml(result.status || 'unknown')}</span>
              </div>
              <div class="test-result-details">
                ${result.durationMs != null ? `<p><strong>Duration:</strong> ${escapeHtml(String(result.durationMs))} ms</p>` : ''}
                ${result.errorMessage ? `<p style="color: #dc2626;"><strong>Error:</strong> ${escapeHtml(result.errorMessage)}</p>` : ''}
                ${evidenceLinks}
                ${rowValidations ? `<div style="margin-top: 8px;"><strong style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Validations</strong><ul style="list-style:none; padding:0; margin:4px 0 0 0;">${rowValidations}</ul></div>` : ''}
              </div>
            </div>`;
        }).join('')
      : `<div class="empty-state" style="margin-top: 12px;"><p>${escapeHtml(payload && payload.error ? payload.error : 'No validation details returned.')}</p></div>`;

    const videoBlock = artifacts.video_url
      ? `
        <div style="margin-top: 16px;">
          <strong style="display:block; margin-bottom: 8px;">Validation video</strong>
          <video controls preload="metadata" style="width:100%; max-height:420px; border-radius:8px; background:#111827;" src="${escapeHtml(artifacts.video_url)}"></video>
          <div style="margin-top: 8px;"><a href="${escapeHtml(artifacts.video_url)}" target="_blank" rel="noopener noreferrer">Open video in new tab</a></div>
        </div>`
      : '';
    const traceBlock = artifacts.trace_url
      ? `<div style="margin-top: 8px;"><a href="${escapeHtml(artifacts.trace_url)}">Download validation trace</a></div>`
      : '';
    const outputBlock = output
      ? `<div style="margin-top: 16px;"><strong style="display:block; margin-bottom: 8px;">Validation output</strong><pre style="font-size: 12px; margin: 0; padding: 12px; background: #0f172a; color: #e2e8f0; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(output)}</pre></div>`
      : '';
    const qualityWarningsBlock = qualityWarnings.length > 0
      ? `<div style="margin-top: 16px;">
          <strong style="display:block; margin-bottom: 8px; font-size: 11px; color: #6b7280; text-transform: uppercase;">Recommended corrections</strong>
          <ul style="list-style:none; padding:0; margin:0;">
            ${qualityWarnings.map((warning) => `<li style="display:flex; align-items:flex-start; gap:8px; padding:8px 10px; margin-bottom:4px; border-radius:6px; background:#fff7ed; border:1px solid #fed7aa; border-left:4px solid #f59e0b;"><span style="flex-shrink:0; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; background:#fef3c7; color:#92400e;">Improve</span><div style="font-size:13px; color:#7c2d12;">${escapeHtml(warning)}</div></li>`).join('')}
          </ul>
        </div>`
      : '';

    resultsEl.dataset.statusLabel = statusLabel;
    resultsEl.dataset.ran = '1';
    resultsEl.dataset.passed = String(summary.passed || 0);
    resultsEl.dataset.failed = String(summary.failed || 0);
    recordedQualityWarnings[resultKind] = qualityWarnings.filter((warning) => typeof warning === 'string');
    updateApplyCorrectionsButton();
    resultsEl.innerHTML = `
      <div class="light-surface" style="border:1px solid #e5e7eb; border-radius:12px; background:#f8fafc; padding:16px;">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
          <div>
            <span style="display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; color:${statusColor}; background:${statusBackground};">${escapeHtml(statusLabel)}</span>
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top: 12px;">
              <div class="stat-card"><div class="stat-value">${escapeHtml(String(summary.total || 0))}</div><div class="stat-label">Total</div></div>
              <div class="stat-card"><div class="stat-value" style="color:#10b981;">${escapeHtml(String(summary.passed || 0))}</div><div class="stat-label">Passed</div></div>
              <div class="stat-card"><div class="stat-value" style="color:#ef4444;">${escapeHtml(String(summary.failed || 0))}</div><div class="stat-label">Failed</div></div>
            </div>
          </div>
          <div style="min-width: 240px;">
            <div style="font-size:12px; color:#6b7280;">Runtime options</div>
            <div style="margin-top: 8px; display:flex; gap:8px; flex-wrap:wrap;">
              <span class="status-badge pending">${escapeHtml(options.browser || 'chromium')}</span>
              <span class="status-badge pending">${options.headless ? 'headless' : 'headed'}</span>
              <span class="status-badge pending">video: ${escapeHtml(options.video || 'off')}</span>
              <span class="status-badge pending">trace: ${escapeHtml(options.trace || 'off')}</span>
            </div>
          </div>
        </div>
        ${payload && payload.error ? `<p style="margin-top: 12px; color: #b91c1c; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHtml(payload.error)}</p>` : ''}
        ${videoBlock}
        ${traceBlock}
        ${qualityWarningsBlock}
        ${validationsHtml}
        ${outputBlock}
      </div>`;
    refreshRecordedSectionSummaries();
  }

  async function validateRecordedTestDraft(kind) {
    const resultKind = kind === 'preview' ? 'preview' : 'test';
    const name = document.getElementById('recorded-test-name')?.value?.trim();
    const spec = getSpecValue().trim();
    const baseUrl = document.getElementById('recorded-test-codegen-url')?.value?.trim();
    const detectedVarsList = document.getElementById('recorded-test-detected-vars');
    const variableNames = extractUiVariableNamesFromSpecText(spec || '');
    if (!name) {
      alert('Test name is required');
      return;
    }
    if (!spec) {
      alert('Generated spec is required');
      return;
    }
    const uiVariables = collectUiVariableInputValues(detectedVarsList, '.recorded-test-variable-value');
    const missingVariables = variableNames.filter((varName) => !uiVariables[varName] || !String(uiVariables[varName]).trim());
    if (missingVariables.length > 0) {
      alert(`Provide values for all detected UI variables before validating: ${missingVariables.join(', ')}`);
      return;
    }
    setRecordedTestValidationPending(true, resultKind);
    recordedQualityWarnings[resultKind] = [];
    const correctionHint = document.getElementById('recorded-test-validation-hint');
    if (correctionHint) delete correctionHint.dataset.appliedNote;
    updateApplyCorrectionsButton();
    openRecordedSection('results');
    const resultsEl = recordedResultPane(resultKind);
    if (resultsEl) {
      resultsEl.dataset.statusLabel = recordedResultTitle(resultKind, { running: true, summary: {} });
      resultsEl.dataset.ran = '0';
      resultsEl.innerHTML = `<div class="light-surface" style="border:1px solid #e5e7eb; border-radius:12px; background:#f8fafc; padding:16px;"><p style="margin:0;">${resultKind === 'preview' ? 'Running preview.' : 'Running test recorded test.'} This does not create a UI test run or report.</p></div>`;
      refreshRecordedSectionSummaries();
    }
    try {
      const res = await apiRequest('/playwright-recorded-tests/validate-draft', {
        method: 'POST',
        body: {
          name,
          spec_content: spec,
          base_url: baseUrl || undefined,
          uiVariables: Object.fromEntries(Object.entries(uiVariables).map(([key, value]) => [key, String(value).trim()]))
        }
      });
      renderRecordedTestValidationResults(res, resultKind);
    } catch (err) {
      renderRecordedTestValidationResults({
        summary: { total: 0, passed: 0, failed: 0 },
        results: [],
        options: {},
        output: '',
        error: err.message || 'Draft validation failed'
      }, resultKind);
    } finally {
      setRecordedTestValidationPending(false, resultKind);
    }
  }

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
        setSpecValue(res.content);
        updateRecordedTestDetectedVariablesPreview();
        clearRecordedTestValidationResults();
        updateRecordedSpecStats();
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
    openRecordedSection('source');
    refreshRecordedSectionSummaries();
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
    refreshRecordedSectionSummaries();
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
        setSpecValue(res.specContent);
        updateRecordedTestDetectedVariablesPreview();
        clearRecordedTestValidationResults();
        updateRecordedSpecStats();
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

  // Stop Recording button (header)
  document.getElementById('stop-codegen-btn')?.addEventListener('click', () => {
    stopRemoteCodegenSession();
  });

  // Stop Recording button (in-frame overlay — visible in fullscreen)
  document.getElementById('codegen-vnc-frame-stop-btn')?.addEventListener('click', () => {
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
    document.getElementById('codegen-vnc-frame-fullscreen-exit-btn')?.addEventListener('click', () => {
      document.exitFullscreen().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreenState);
    updateFullscreenState();
  })();

  function showAddRecordedTestView(editId) {
    // Toggle a class on main so the two-panel layout fills the full viewport height.
    document.querySelector('main')?.classList.add('main-split-layout');
    const form = document.getElementById('recorded-test-form');
    const idInput = document.getElementById('recorded-test-id');
    const titleEl = document.getElementById('recorded-test-form-title');
    const nameInput = document.getElementById('recorded-test-name');
    const labelInput = document.getElementById('recorded-test-label');
    const specInput = document.getElementById('recorded-test-spec');
    const codegenUrlInput = document.getElementById('recorded-test-codegen-url');
    const loadBtn = document.getElementById('load-codegen-output-btn');
    const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
    const addToProjectWrap = document.getElementById('recorded-test-add-to-project-wrap');
    const addToProjectSelect = document.getElementById('recorded-test-add-to-project');
    const variableGroupSelect = document.getElementById('recorded-test-variable-group');
    if (!form) return;
    const activeProjectId = window._projectRecordedTestsProjectId || window._runUiTestsProjectId || null;
    let selectedProjectId = !editId && activeProjectId ? String(activeProjectId) : '';

    if (addToProjectWrap) addToProjectWrap.style.display = 'block';
    if (addToProjectSelect) {
      addToProjectSelect.setAttribute('required', 'required');
      addToProjectSelect.innerHTML = '<option value="">Select project...</option>';
    }

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
    if (labelInput) labelInput.value = '';
    setSpecValue('');
    clearRecordedTestValidationResults();
    populateUiVariableGroupSelect(variableGroupSelect, variableGroupSelect?.value || '');
    // Initialise CodeMirror editor (no-op if already done or not yet loaded).
    initSpecEditor();
    updateAutoFixToggle();
    nameInput.oninput = () => clearRecordedTestValidationResults();
    codegenUrlInput.oninput = () => clearRecordedTestValidationResults();
    if (variableGroupSelect) {
      variableGroupSelect.onchange = () => {
        updateRecordedTestDetectedVariablesPreview();
        clearRecordedTestValidationResults();
      };
    }

    apiRequest('/projects').then(projects => {
      if (addToProjectSelect && Array.isArray(projects) && projects.length > 0) {
        addToProjectSelect.innerHTML = '<option value="">Select project...</option>' + projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if (selectedProjectId) addToProjectSelect.value = selectedProjectId;
        refreshRecordedSectionSummaries();
      }
    }).catch(() => {});

    if (editId) {
      apiRequest(`/playwright-recorded-tests/${editId}`)
        .then(t => {
          nameInput.value = t.name || '';
          if (labelInput) labelInput.value = t.label || '';
          setSpecValue(t.spec_content || '');
          updateRecordedTestDetectedVariablesPreview();
          clearRecordedTestValidationResults();
          updateRecordedSpecStats();
          codegenUrlInput.value = (t.base_url || '').trim() || codegenUrlInput.placeholder;
          if (addToProjectSelect && Array.isArray(t.project_ids) && t.project_ids.length > 0) {
            selectedProjectId = String(t.project_ids[0]);
            addToProjectSelect.value = selectedProjectId;
          }
          refreshRecordedSectionSummaries();
        })
        .catch(err => alert('Error loading recorded test: ' + err.message));
    } else {
      // Load default URL from config and projects for "Also add to project"
      apiRequest('/playwright-config').then(c => {
        const defaultUrl = (c.baseUrl || '').trim() || 'https://example.com';
        codegenUrlInput.value = defaultUrl;
        refreshRecordedSectionSummaries();
      }).catch(() => {
        codegenUrlInput.value = 'https://example.com';
      });
      updateRecordedTestDetectedVariablesPreview();
      clearRecordedTestValidationResults();
    }
    bindRecordedSectionChrome();
    openRecordedSection('details');
    refreshRecordedSectionSummaries();
    showView('add-recorded-test');
  }

  document.getElementById('add-recorded-test-btn')?.addEventListener('click', () => showAddRecordedTestView());
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
    clearRecordedTestValidationResults();
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('recorded-test-validate')?.addEventListener('click', () => {
    validateRecordedTestDraft();
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
      window.trackUsage?.('record_ui_test');
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

  // Copy the current spec content to the clipboard
  document.getElementById('copy-spec-btn')?.addEventListener('click', () => {
    const spec = getSpecValue();
    if (!spec.trim()) { alert('Nothing to copy — the spec is empty.'); return; }
    navigator.clipboard.writeText(spec)
      .then(() => alert('Spec copied to clipboard.'))
      .catch(() => alert('Could not copy to clipboard.'));
  });

  document.getElementById('apply-result-corrections-btn')?.addEventListener('click', async () => {
    const warnings = recordedResultCorrectionWarnings();
    const applicable = warnings.filter(recordedCorrectionIsApplicable);
    const spec = (recordedSpecBaseline || getSpecValue());
    if (!spec.trim()) {
      alert('Nothing to update — the code is empty.');
      return;
    }
    if (!applicable.length) {
      alert('Run Preview or Test recorded test first. Recommended corrections from those results can be applied here.');
      return;
    }
    const button = document.getElementById('apply-result-corrections-btn');
    if (button) button.disabled = true;
    try {
      const res = await apiRequest('/playwright-recorded-tests/apply-quality-corrections', {
        method: 'POST',
        body: { spec_content: spec, quality_warnings: warnings }
      });
      const applied = Array.isArray(res.applied) ? res.applied : [];
      const manual = (Array.isArray(res.unchanged) ? res.unchanged : []).filter((item) => item && item.reason === 'manual');
      if (res.specContent && res.specContent !== getSpecValue()) {
        setSpecValue(res.specContent, { preserveResults: true, keepBaseline: true });
        updateRecordedTestDetectedVariablesPreview();
        updateRecordedSpecStats();
        openRecordedSection('code');
        const hint = document.getElementById('recorded-test-validation-hint');
        if (hint) {
          const manualNote = manual.length
            ? ` ${manual.length} recommendation${manual.length === 1 ? '' : 's'} stay in Results because they need a selector you choose.`
            : '';
          hint.dataset.appliedNote = `Applied ${applied.length} correction${applied.length === 1 ? '' : 's'} onto the original code.${manualNote} Preview runs this code.`;
        }
      } else if (manual.length && !applied.length) {
        alert('Those recommendations need a selector change. They stay listed in Results.');
      } else {
        alert('No code changes. Those corrections are already in the code.');
      }
    } catch (err) {
      alert('Could not apply corrections: ' + err.message);
    } finally {
      updateApplyCorrectionsButton();
    }
  });

  // Apply robust helper template to the current spec on demand.
  document.getElementById('apply-spec-fixes-btn')?.addEventListener('click', async () => {
    const spec = getSpecValue();
    if (!spec.trim()) { alert('Nothing to fix — the spec is empty.'); return; }
    try {
      const res = await apiRequest('/playwright-recorded-tests/normalize-draft', {
        method: 'POST',
        body: { spec_content: spec }
      });
      if (res.specContent && res.specContent !== spec) {
        setSpecValue(res.specContent);
        updateRecordedTestDetectedVariablesPreview();
        clearRecordedTestValidationResults();
        updateRecordedSpecStats();
      } else {
        alert('No changes — the spec already has the correct format.');
      }
    } catch (err) {
      alert('Could not apply fixes: ' + err.message);
    }
  });

  // Toggle automatic template transformation on paste / Codegen load.
  document.getElementById('auto-fix-spec-btn')?.addEventListener('click', () => {
    autoFixEnabled = !autoFixEnabled;
    localStorage.setItem('specAutoFix', autoFixEnabled);
    updateAutoFixToggle();
  });

  // Clear the spec textarea and reset related UI state
  document.getElementById('clear-spec-btn')?.addEventListener('click', async () => {
    if (!getSpecValue().trim()) return;
    if (!(await confirmDialog({ title: 'Clear spec', message: 'Clear the generated spec? This cannot be undone.', confirmLabel: 'Clear spec' }))) return;
    setSpecValue('');
    updateRecordedTestDetectedVariablesPreview();
    clearRecordedTestValidationResults();
    updateRecordedSpecStats();
    if (specEditor) specEditor.focus(); else document.getElementById('recorded-test-spec')?.focus();
  });

  document.getElementById('recorded-test-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    stopAutoRefresh();
    const idInput = document.getElementById('recorded-test-id');
    const name = document.getElementById('recorded-test-name')?.value?.trim();
    const label = document.getElementById('recorded-test-label')?.value?.trim() || null;
    const spec = getSpecValue().trim();
    const addToProjectEl = document.getElementById('recorded-test-add-to-project');
    const addToProjectId = addToProjectEl?.value?.trim() || null;
    if (!name) { alert('Test name is required'); return; }
    if (!spec) { alert('Generated spec is required'); return; }
    if (!addToProjectId) { alert('Please select a project for this recorded test.'); return; }
    const editId = idInput?.value?.trim() || null;
    const buildRecordedTestSavedMessage = (action, response) => {
      const variableNames = Array.isArray(response && response.variable_names) ? response.variable_names : [];
      const qualityWarnings = Array.isArray(response && response.quality_warnings) ? response.quality_warnings : [];
      const qualitySuffix = qualityWarnings.length > 0
        ? ` Recommended corrections before relying on this script: ${qualityWarnings.slice(0, 2).join(' ')}`
        : '';
      if (variableNames.length === 0) {
        return action === 'updated'
          ? `Recorded test updated.${qualitySuffix}`
          : `Recorded test saved. It will appear in the test list when you run UI tests.${qualitySuffix}`;
      }
      return action === 'updated'
        ? `Recorded test updated. Added UI variables will be requested when you run it: ${variableNames.join(', ')}.${qualitySuffix}`
        : `Recorded test saved. Added UI variables will be requested when you run it: ${variableNames.join(', ')}.${qualitySuffix}`;
    };
    try {
      if (editId) {
        const body = { name, label, spec_content: spec, base_url: null };
        body.projectIds = [Number(addToProjectId)];
        const response = await apiRequest(`/playwright-recorded-tests/${editId}`, { method: 'PUT', body });
        alert(buildRecordedTestSavedMessage('updated', response));
      } else {
        const body = { name, label, spec_content: spec, base_url: null };
        body.addToProjectIds = [Number(addToProjectId)];
        const response = await apiRequest('/playwright-recorded-tests', { method: 'POST', body });
        alert(buildRecordedTestSavedMessage('saved', response));
      }
      currentCodegenSlug = null;
      currentCodegenMode = null;
      hideRemoteCodegenPanel();
      clearRecordedTestValidationResults();
      showView('ui-tests');
      loadPlaywrightRuns();
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
  });

  let recordedTestsList = [];
  const selectedRecordedTestIds = new Set();

  function currentRecordedTestFilter() {
    const searchInput = document.getElementById('recorded-tests-search-input');
    const labelFilterEl = document.getElementById('recorded-tests-label-filter');
    return {
      searchInput,
      labelFilterEl,
      searchTerm: (searchInput?.value || '').trim().toLowerCase(),
      selectedLabel: labelFilterEl?.value || ''
    };
  }

  function filteredRecordedTests() {
    const filter = currentRecordedTestFilter();
    return recordedTestsList.filter(test =>
      recordedTestMatchesQuery(test, filter.searchTerm) && (!filter.selectedLabel || String(test.label || '') === filter.selectedLabel)
    );
  }

  function updateRecordedSelectionControls(filteredTests) {
    const deleteButton = document.getElementById('recorded-tests-delete-selected');
    const selectShown = document.getElementById('recorded-tests-select-shown');
    const shownIds = (filteredTests || []).map((test) => String(test.id));
    const selectedShown = shownIds.filter((id) => selectedRecordedTestIds.has(id));
    if (deleteButton) {
      deleteButton.disabled = selectedShown.length === 0;
      deleteButton.textContent = selectedShown.length ? `Delete selected (${selectedShown.length})` : 'Delete selected';
    }
    if (selectShown) {
      selectShown.disabled = shownIds.length === 0;
      selectShown.checked = shownIds.length > 0 && selectedShown.length === shownIds.length;
      selectShown.indeterminate = selectedShown.length > 0 && selectedShown.length < shownIds.length;
    }
  }

  function recordedTestLabelHtml(label) {
    const text = String(label || '').trim();
    if (!text) return '';
    return `<span class="recorded-test-label">${escapeHtml(text)}</span>`;
  }

  function recordedTestMatchesQuery(test, query) {
    if (!query) return true;
    return [test.name, test.label, test.base_url].filter(Boolean).join(' ').toLowerCase().includes(query);
  }

  function fillRecordedLabelFilter(select, tests) {
    if (!select) return;
    const current = select.value;
    const labels = [...new Set((tests || []).map((test) => String(test.label || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="">All labels</option>${labels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('')}`;
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderRecordedTestsList() {
    const container = document.getElementById('recorded-tests-list-container');
    if (!container) return;
    const searchInput = document.getElementById('recorded-tests-search-input');
    const labelFilterEl = document.getElementById('recorded-tests-label-filter');
    fillRecordedLabelFilter(labelFilterEl, recordedTestsList);
    const filteredTests = filteredRecordedTests();
    const knownIds = new Set(recordedTestsList.map((test) => String(test.id)));
    [...selectedRecordedTestIds].forEach((id) => {
      if (!knownIds.has(id)) selectedRecordedTestIds.delete(id);
    });
    updateRecordedSelectionControls(filteredTests);

    if (recordedTestsList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No recorded tests yet. Click "Add recorded test" and paste code from Playwright Codegen.</p>
        </div>`;
    } else if (filteredTests.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No recorded tests match "${escapeHtml(searchInput?.value || '')}".</p>
        </div>`;
    } else {
      container.innerHTML = filteredTests.map(t => `
          <div class="list-item" data-id="${t.id}">
            <label class="recorded-test-select">
              <input type="checkbox" class="recorded-test-select-input" data-id="${t.id}" ${selectedRecordedTestIds.has(String(t.id)) ? 'checked' : ''} />
              <span class="sr-only">Select ${escapeHtml(t.name)}</span>
            </label>
            <div class="list-item-info">
              <h3>${escapeHtml(t.name)}${recordedTestLabelHtml(t.label)}</h3>
              <p class="recorded-test-meta">${escapeHtml(t.base_url || '')}${t.base_url ? ' • ' : ''}${formatDateTime(t.created_at)}</p>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-secondary edit-recorded-test-btn" data-id="${t.id}">Edit</button>
              <button type="button" class="btn btn-secondary delete-recorded-test-btn" data-id="${t.id}">Delete</button>
            </div>
          </div>
        `).join('');
      container.querySelectorAll('.recorded-test-select-input').forEach(box => {
        box.addEventListener('change', () => {
          const id = String(box.getAttribute('data-id'));
          if (box.checked) selectedRecordedTestIds.add(id);
          else selectedRecordedTestIds.delete(id);
          updateRecordedSelectionControls(filteredRecordedTests());
        });
      });
      container.querySelectorAll('.edit-recorded-test-btn').forEach(btn => {
        btn.addEventListener('click', () => showAddRecordedTestView(btn.getAttribute('data-id')));
      });
      container.querySelectorAll('.delete-recorded-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Delete recorded test', message: 'Delete this recorded test?', confirmLabel: 'Delete recorded test' }))) return;
          try {
            await apiRequest(`/playwright-recorded-tests/${btn.getAttribute('data-id')}`, { method: 'DELETE' });
            loadRecordedTestsList();
          } catch (err) {
            alert('Error deleting: ' + err.message);
          }
        });
      });
    }
  }

  async function loadRecordedTestsList() {
    const container = document.getElementById('recorded-tests-list-container');
    if (!container) return;
    try {
      recordedTestsList = await apiRequest('/playwright-recorded-tests');
      renderRecordedTestsList();
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
  document.getElementById('back-from-recorded-tests-list')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });
  document.getElementById('recorded-tests-list-add-new')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('recorded-tests-search-input')?.addEventListener('input', renderRecordedTestsList);
  document.getElementById('recorded-tests-label-filter')?.addEventListener('change', renderRecordedTestsList);
  document.getElementById('recorded-tests-select-shown')?.addEventListener('change', (event) => {
    filteredRecordedTests().forEach((test) => {
      const id = String(test.id);
      if (event.target.checked) selectedRecordedTestIds.add(id);
      else selectedRecordedTestIds.delete(id);
    });
    renderRecordedTestsList();
  });
  document.getElementById('recorded-tests-delete-selected')?.addEventListener('click', async () => {
    const tests = filteredRecordedTests().filter((test) => selectedRecordedTestIds.has(String(test.id)));
    if (!tests.length) return;
    const countLabel = tests.length === 1 ? '1 recorded test' : `${tests.length} recorded tests`;
    if (!(await confirmDialog({
      title: 'Delete selected tests',
      message: `Delete ${countLabel} matching the current search and label filter?`,
      confirmLabel: 'Delete selected'
    }))) return;
    const failures = [];
    for (const test of tests) {
      try {
        await apiRequest(`/playwright-recorded-tests/${test.id}`, { method: 'DELETE' });
        selectedRecordedTestIds.delete(String(test.id));
      } catch (err) {
        failures.push(`${test.name}: ${err.message}`);
      }
    }
    await loadRecordedTestsList();
    if (failures.length) alert(`Some tests were not deleted:\n${failures.join('\n')}`);
  });

  // Project recorded tests (Option B: list linked to project, add from pool, remove link)
  let projectRecordedTestsList = [];

  function renderProjectRecordedTestsList(projectId) {
    const listEl = document.getElementById('project-recorded-tests-list');
    if (!listEl) return;
    const searchInput = document.getElementById('project-recorded-tests-search-input');
    const labelFilterEl = document.getElementById('project-recorded-tests-label-filter');
    fillRecordedLabelFilter(labelFilterEl, projectRecordedTestsList);
    const searchTerm = (searchInput?.value || '').trim().toLowerCase();
    const selectedLabel = labelFilterEl?.value || '';
    const filteredTests = projectRecordedTestsList.filter(test =>
      recordedTestMatchesQuery(test, searchTerm) && (!selectedLabel || String(test.label || '') === selectedLabel)
    );

    if (projectRecordedTestsList.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No recorded tests in this project. Add from the global pool below.</p>
        </div>
      `;
    } else if (filteredTests.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No recorded tests match "${escapeHtml(searchInput?.value || '')}".</p>
        </div>
      `;
    } else {
      listEl.innerHTML = filteredTests.map(t => `
          <div class="list-item">
            <div class="list-item-info">
              <h3>${escapeHtml(t.name)}${recordedTestLabelHtml(t.label)}</h3>
              <p>${t.base_url ? escapeHtml(t.base_url) : ''} • ${formatDateTime(t.created_at)}</p>
            </div>
            <div class="list-item-actions">
              <button type="button" class="btn btn-secondary btn-sm edit-project-recorded" data-recorded-id="${t.id}">Edit</button>
              <button type="button" class="btn btn-danger btn-sm remove-from-project-recorded" data-recorded-id="${t.id}">Remove from project</button>
            </div>
          </div>
        `).join('');
      listEl.querySelectorAll('.edit-project-recorded').forEach(btn => {
        btn.addEventListener('click', () => {
          showAddRecordedTestView(btn.getAttribute('data-recorded-id'));
        });
      });
      listEl.querySelectorAll('.remove-from-project-recorded').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Remove recorded test', message: 'Remove this recorded test from the project? (The test stays in the global pool.)', confirmLabel: 'Remove recorded test' }))) return;
          try {
            await apiRequest(`/projects/${projectId}/recorded-tests/${btn.getAttribute('data-recorded-id')}`, { method: 'DELETE' });
            loadProjectRecordedTestsView(projectId);
          } catch (err) {
            alert('Error: ' + err.message);
          }
        });
      });
    }
  }

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
      projectRecordedTestsList = recorded;
      renderProjectRecordedTestsList(projectId);
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
  document.getElementById('project-recorded-tests-search-input')?.addEventListener('input', () => {
    renderProjectRecordedTestsList(window._projectRecordedTestsProjectId);
  });
  document.getElementById('project-recorded-tests-label-filter')?.addEventListener('change', () => {
    renderProjectRecordedTestsList(window._projectRecordedTestsProjectId);
  });

  document.getElementById('add-recorded-test-to-project-btn')?.addEventListener('click', async () => {
    const projectId = window._projectRecordedTestsProjectId;
    if (!projectId) return;
    try {
      const [allRecorded, inProject, projects] = await Promise.all([
        apiRequest('/playwright-recorded-tests'),
        apiRequest(`/projects/${projectId}/recorded-tests`),
        apiRequest('/projects')
      ]);
      const inIds = new Set((inProject || []).map(t => t.id));
      const available = (allRecorded || []).filter(t => !inIds.has(t.id));
      if (available.length === 0) {
        alert('All recorded tests are already in this project. Add new tests from "UI Tests" → "Add recorded test".');
        return;
      }
      const projectNameById = new Map((Array.isArray(projects) ? projects : []).map((project) => [Number(project.id), project.name || `Project ${project.id}`]));
      const projectFilterIds = [...new Set(available.flatMap((test) => Array.isArray(test.project_ids) ? test.project_ids.map(Number) : []))]
        .filter((id) => Number.isInteger(id))
        .sort((a, b) => String(projectNameById.get(a) || a).localeCompare(String(projectNameById.get(b) || b)));
      const projectFilterOptions = projectFilterIds.map((id) => `<option value="${escapeHtml(String(id))}">${escapeHtml(projectNameById.get(id) || `Project ${id}`)}</option>`).join('');
      const checklist = available.map((test) => {
        const usedCount = Array.isArray(test.project_ids) ? test.project_ids.length : 0;
        const projectIds = Array.isArray(test.project_ids) ? test.project_ids.map(Number).filter((id) => Number.isInteger(id)) : [];
        const projectNames = projectIds.map((id) => projectNameById.get(id) || `Project ${id}`);
        const baseUrl = test.base_url ? `<div class="recorded-bulk-test-url" title="${escapeHtml(test.base_url)}">${escapeHtml(test.base_url)}</div>` : '<div class="recorded-bulk-test-url recorded-bulk-test-url-empty">No base URL</div>';
        const usedText = usedCount === 1 ? 'Used in 1 project' : `Used in ${usedCount} projects`;
        const projectsHtml = projectNames.length > 0
          ? `<div class="recorded-bulk-project-chips">${projectNames.slice(0, 4).map((name) => `<span class="recorded-bulk-project-chip">${escapeHtml(name)}</span>`).join('')}${projectNames.length > 4 ? `<span class="recorded-bulk-project-chip">+${projectNames.length - 4}</span>` : ''}</div>`
          : '<div class="recorded-bulk-project-chips"><span class="recorded-bulk-project-chip recorded-bulk-project-chip-empty">No project links</span></div>';
        const searchText = [test.name || '', test.label || '', test.base_url || '', projectNames.join(' '), formatDateTime(test.created_at) || ''].join(' ').toLowerCase();
        return `
          <label class="recorded-bulk-test-item" data-search="${escapeHtml(searchText)}" data-label="${escapeHtml(String(test.label || ''))}" data-project-ids="${escapeHtml(projectIds.join(','))}">
            <span class="recorded-bulk-test-check-wrap">
              <input type="checkbox" class="recorded-bulk-test-cb" value="${escapeHtml(String(test.id))}">
            </span>
            <span class="recorded-bulk-test-body">
              <span class="recorded-bulk-test-title-row">
                <span class="recorded-bulk-test-name">${escapeHtml(test.name || '')}${recordedTestLabelHtml(test.label)}</span>
                <span class="recorded-bulk-test-meta">${escapeHtml(formatDateTime(test.created_at) || '')}</span>
              </span>
              ${baseUrl}
              ${projectsHtml}
              <span class="recorded-bulk-test-meta">${usedCount > 0 ? escapeHtml(usedText) : 'Not linked to any project yet'}${Array.isArray(test.variable_names) && test.variable_names.length ? ` • ${escapeHtml(test.variable_names.length === 1 ? '1 variable' : `${test.variable_names.length} variables`)}` : ''}</span>
            </span>
          </label>
        `;
      }).join('');
      showModal('Add recorded test to project', `
        <div class="recorded-bulk-modal">
          <div class="recorded-bulk-intro">
            <div>
              <p class="recorded-bulk-intro-title">Select reusable recorded tests from the global pool.</p>
              <p class="recorded-bulk-intro-copy">Search by name, label, URL, linked project, or date. Filter by label or an existing project when you need to find related tests quickly.</p>
            </div>
            <div class="recorded-bulk-summary-card">
              <strong>${escapeHtml(String(available.length))}</strong>
              <span>available</span>
            </div>
          </div>
          <div class="recorded-bulk-controls">
            <label class="recorded-bulk-control recorded-bulk-search-control">
              <span>Search recorded tests</span>
              <input type="search" id="recorded-bulk-search" placeholder="Search by name, label, URL, project, date..." autocomplete="off">
            </label>
            <label class="recorded-bulk-control">
              <span>Filter by label</span>
              <select id="recorded-bulk-label-filter">
                <option value="">All labels</option>
                ${[...new Set(available.map((test) => String(test.label || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join('')}
              </select>
            </label>
            <label class="recorded-bulk-control recorded-bulk-project-filter-control">
              <span>Filter by linked project</span>
              <select id="recorded-bulk-project-filter">
                <option value="">All projects</option>
                <option value="__unlinked">Not linked to any project</option>
                ${projectFilterOptions}
              </select>
            </label>
          </div>
          <div class="recorded-bulk-toolbar">
            <div class="recorded-bulk-toolbar-actions">
              <button type="button" class="btn btn-link" id="recorded-bulk-select-all">Select visible</button>
              <span class="test-list-select-sep">|</span>
              <button type="button" class="btn btn-link" id="recorded-bulk-deselect-all">Clear visible</button>
            </div>
            <div class="recorded-bulk-counts">
              <span id="recorded-bulk-visible-count">${escapeHtml(String(available.length))} shown</span>
              <span class="recorded-bulk-selected-count" id="recorded-bulk-selected-count">0 selected</span>
            </div>
          </div>
          <div class="recorded-bulk-list" role="group" aria-label="Recorded tests available to add">
            ${checklist}
            <div class="recorded-bulk-empty" id="recorded-bulk-empty" style="display:none;">No recorded tests match the current search, label, and project filter.</div>
          </div>
          <div class="recorded-bulk-footer">
            <button type="button" class="btn btn-secondary" id="recorded-bulk-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="add-to-project-recorded-confirm" disabled>Add selected</button>
          </div>
        </div>
      `);
      const checkboxes = Array.from(document.querySelectorAll('.recorded-bulk-test-cb'));
      const items = Array.from(document.querySelectorAll('.recorded-bulk-test-item'));
      const addButton = document.getElementById('add-to-project-recorded-confirm');
      const countEl = document.getElementById('recorded-bulk-selected-count');
      const visibleCountEl = document.getElementById('recorded-bulk-visible-count');
      const emptyEl = document.getElementById('recorded-bulk-empty');
      const searchInput = document.getElementById('recorded-bulk-search');
      const labelFilter = document.getElementById('recorded-bulk-label-filter');
      const projectFilter = document.getElementById('recorded-bulk-project-filter');
      const visibleItems = () => items.filter((item) => item.style.display !== 'none');
      const updateSelectedCount = () => {
        const selectedCount = checkboxes.filter((cb) => cb.checked).length;
        if (countEl) countEl.textContent = `${selectedCount} selected`;
        if (addButton) addButton.disabled = selectedCount === 0;
      };
      const applyFilters = () => {
        const query = String(searchInput?.value || '').trim().toLowerCase();
        const selectedLabel = String(labelFilter?.value || '');
        const selectedProjectId = String(projectFilter?.value || '');
        let visibleCount = 0;
        items.forEach((item) => {
          const matchesSearch = !query || String(item.dataset.search || '').includes(query);
          const matchesLabel = !selectedLabel || String(item.dataset.label || '') === selectedLabel;
          const ids = String(item.dataset.projectIds || '').split(',').filter(Boolean);
          const matchesProject = !selectedProjectId
            || (selectedProjectId === '__unlinked' ? ids.length === 0 : ids.includes(selectedProjectId));
          const visible = matchesSearch && matchesLabel && matchesProject;
          item.style.display = visible ? '' : 'none';
          if (visible) visibleCount += 1;
        });
        if (visibleCountEl) visibleCountEl.textContent = `${visibleCount} shown`;
        if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
        updateSelectedCount();
      };
      checkboxes.forEach((cb) => cb.addEventListener('change', updateSelectedCount));
      searchInput?.addEventListener('input', applyFilters);
      labelFilter?.addEventListener('change', applyFilters);
      projectFilter?.addEventListener('change', applyFilters);
      document.getElementById('recorded-bulk-select-all')?.addEventListener('click', () => {
        visibleItems().forEach((item) => {
          const cb = item.querySelector('.recorded-bulk-test-cb');
          if (cb) cb.checked = true;
        });
        updateSelectedCount();
      });
      document.getElementById('recorded-bulk-deselect-all')?.addEventListener('click', () => {
        visibleItems().forEach((item) => {
          const cb = item.querySelector('.recorded-bulk-test-cb');
          if (cb) cb.checked = false;
        });
        updateSelectedCount();
      });
      document.getElementById('recorded-bulk-cancel')?.addEventListener('click', hideModal);
      updateSelectedCount();
      applyFilters();
      document.getElementById('add-to-project-recorded-confirm')?.addEventListener('click', async () => {
        const recordedTestIds = checkboxes.filter((cb) => cb.checked).map((cb) => Number(cb.value)).filter(Boolean);
        if (recordedTestIds.length === 0) return;
        try {
          if (addButton) {
            addButton.disabled = true;
            addButton.textContent = 'Adding...';
          }
          await apiRequest(`/projects/${projectId}/recorded-tests`, {
            method: 'POST',
            body: { recordedTestIds }
          });
          document.getElementById('modal-overlay').classList.remove('active');
          loadProjectRecordedTestsView(projectId);
        } catch (err) {
          alert('Error: ' + err.message);
          if (addButton) {
            addButton.textContent = 'Add selected';
            updateSelectedCount();
          }
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
      window.mountRunDetailSplit(resultsEl, results.map(r => {
        const validationsHtml = (r.assertions && Array.isArray(r.assertions.validations))
          ? `<div style="margin-top: 8px;"><strong style="font-size: 11px; color: #6b7280; text-transform: uppercase;">Validations</strong><ul style="list-style: none; padding: 0; margin: 4px 0 0 0;">${r.assertions.validations.map(v => `
            <li class="light-surface" style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; margin-bottom: 4px; border-radius: 6px; background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid ${v.passed ? '#10b981' : '#ef4444'};">
              <span style="flex-shrink: 0; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; background: ${v.passed ? '#d1fae5' : '#fee2e2'}; color: ${v.passed ? '#065f46' : '#991b1b'};">${v.passed ? 'Passed' : 'Failed'}</span>
              <div><span style="font-size: 13px;">${v.description}</span>${v.detail ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${v.detail}</div>` : ''}</div>
            </li>`).join('')}</ul></div>`
          : (r.assertions ? `<pre class="light-surface" style="font-size: 12px; margin-top: 8px; padding: 8px; background: #f9fafb; border-radius: 6px;">${JSON.stringify(r.assertions, null, 2)}</pre>` : '');
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
        return {
          labelHtml: `
            <span class="test-result-header">
              <span><strong>${r.test_name}</strong>${r.endpoint ? ` <span style="font-size: 12px; color: #6b7280;">${r.endpoint}</span>` : ''}</span>
              <span class="status-badge ${r.status}">${r.status}</span>
            </span>
          `,
          evidenceHtml: `
            <div class="test-result-details">
              ${r.duration_ms != null ? `<p><strong>Duration:</strong> ${r.duration_ms} ms</p>` : ''}
              ${r.error_message ? `<p style="color: #dc2626;"><strong>Error:</strong> ${r.error_message}</p>` : ''}
              ${artifactLinks}
              ${validationsHtml}
            </div>
          `
        };
      }), '', `ui-${id}`);
    } else {
      window.mountRunDetailSplit?.(resultsEl, [], `<div class="empty-state"><p>${run.status === 'running' ? 'This run is still going. Results appear here when each test finishes.' : 'No results for this UI run. Run the recorded tests again from the project.'}</p></div>`, `ui-${id}`);
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
    scrollAppToTop();
  } catch (err) {
    console.error('Error loading Playwright run:', err);
    alert('Error loading UI test run: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // CodeMirror scripts loaded synchronously before this file, so init now.
  initSpecEditor();
  updateAutoFixToggle();
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
    if (id) {
      window.trackUsage?.('download_report');
      window.location.href = `${API_BASE}/playwright-runs/${id}/report/download`;
    }
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
    if (!(await confirmDialog({ title: 'Delete run', message: 'Delete this run and all its artifacts (reports, videos, traces)? This cannot be undone.', confirmLabel: 'Delete run' }))) return;
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
  window.recordedTestEditor = {
    getSpec: getSpecValue,
    setSpec: setSpecValue,
    validateDraft: validateRecordedTestDraft,
    refreshLists: function() {
      loadRecordedTestsList();
      loadPlaywrightRuns();
      const runView = document.getElementById('run-ui-tests-view');
      if (runView && runView.classList.contains('active')) loadRunUiTestsPage();
      const projectView = document.getElementById('project-recorded-tests-view');
      if (projectView && projectView.classList.contains('active') && window._projectRecordedTestsProjectId) {
        loadProjectRecordedTestsView(window._projectRecordedTestsProjectId);
      }
    }
  };
  window.openRecordedSection = openRecordedSection;
  window.refreshRecordedSectionSummaries = refreshRecordedSectionSummaries;
  bindRecordedSectionChrome();
})();
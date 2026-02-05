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
          <span class="status-badge ${run.status}">${run.status}</span>
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

  async function loadRunUiTestsPage() {
    const container = document.getElementById('playwright-test-list-container');
    const nameInput = document.getElementById('run-ui-tests-name');
    const urlInput = document.getElementById('run-ui-tests-base-url');
    const projectSelectWrap = document.getElementById('run-ui-tests-project-wrap');
    const projectSelect = document.getElementById('run-ui-tests-project-select');
    const projectId = window._runUiTestsProjectId ? String(window._runUiTestsProjectId) : null;
    if (projectSelectWrap) {
      projectSelectWrap.style.display = projectId ? 'none' : 'block';
    }
    if (projectSelect) {
      if (projectId) {
        projectSelect.removeAttribute('required');
      } else {
        projectSelect.setAttribute('required', 'required');
      }
    }
    if (!container) return;
    try {
      const listUrl = projectId ? `/playwright-tests/list?projectId=${projectId}` : '/playwright-tests/list';
      const [tests, config] = await Promise.all([
        apiRequest(listUrl),
        apiRequest('/playwright-config').catch(() => ({}))
      ]);
      testList = tests;
      if (urlInput && config.baseUrl) urlInput.value = config.baseUrl;
      const showBrowserCb = document.getElementById('run-ui-tests-show-browser');
      if (showBrowserCb && typeof config.headless === 'boolean') {
        showBrowserCb.checked = !config.headless;
      }
      renderTestList(false);
      const radios = document.querySelectorAll('input[name="test-list-type"]');
      radios.forEach(r => r.addEventListener('change', () => {
        renderTestList(document.querySelector('input[name="test-list-type"]:checked').value === 'selected');
      }));
      if (!projectId) {
        const sel = document.getElementById('run-ui-tests-project-select');
        if (sel) {
          const projects = await apiRequest('/projects');
          sel.innerHTML = '<option value="">Select project...</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        }
      }
    } catch (err) {
      container.innerHTML = `<p class="error-message">Error loading test list: ${err.message}</p>`;
    }
  }

  function renderTestList(showCheckboxes) {
    const container = document.getElementById('playwright-test-list-container');
    if (!container || !testList.length) return;
    container.innerHTML = `
      <h3 class="test-list-title">Tests that will run</h3>
      ${showCheckboxes ? `
        <div class="test-list-select-actions">
          <button type="button" class="btn btn-link" id="select-all-tests">Select all</button>
          <span class="test-list-select-sep">|</span>
          <button type="button" class="btn btn-link" id="deselect-all-tests">Deselect all</button>
        </div>
      ` : ''}
      <ul class="playwright-test-list ${showCheckboxes ? 'selectable' : ''}">
        ${testList.map((t, i) => `
          <li class="playwright-test-item">
            ${showCheckboxes ? `<input type="checkbox" class="playwright-test-cb" data-test-id="${t.id}" id="pt-${t.id}" />` : ''}
            <span class="playwright-test-name">${i + 1}. ${t.name}</span>
          </li>
        `).join('')}
      </ul>
    `;
    if (showCheckboxes) {
      container.querySelectorAll('.playwright-test-cb').forEach(cb => cb.checked = true);
      container.querySelector('#select-all-tests')?.addEventListener('click', () => {
        container.querySelectorAll('.playwright-test-cb').forEach(cb => { cb.checked = true; });
      });
      container.querySelector('#deselect-all-tests')?.addEventListener('click', () => {
        container.querySelectorAll('.playwright-test-cb').forEach(cb => { cb.checked = false; });
      });
    }
  }

  function showRunUiTestsPage(projectId) {
    window._runUiTestsProjectId = projectId || null;
    showView('run-ui-tests');
    loadRunUiTestsPage();
  }

  function handleRunUiTestsSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('run-ui-tests-name')?.value?.trim();
    const baseUrlInput = document.getElementById('run-ui-tests-base-url')?.value?.trim();
    if (!name) {
      alert('Please enter a run name.');
      return;
    }
    const listType = document.querySelector('input[name="test-list-type"]:checked')?.value || 'full';
    let projectId = window._runUiTestsProjectId;
    if (!projectId) {
      const sel = document.getElementById('run-ui-tests-project-select');
      projectId = sel ? sel.value : null;
    }
    if (!projectId) {
      alert('Please select a project.');
      return;
    }
    const showBrowser = document.getElementById('run-ui-tests-show-browser')?.checked === true;
    const body = { name, suite: listType, projectId: Number(projectId), headless: !showBrowser };
    if (baseUrlInput) body.baseUrl = baseUrlInput;
    if (listType === 'selected') {
      const checked = document.querySelectorAll('.playwright-test-cb:checked');
      body.selectedTestIds = Array.from(checked).map(cb => cb.getAttribute('data-test-id'));
      if (body.selectedTestIds.length === 0) {
        alert('Select at least one test.');
        return;
      }
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
      </div>
    `;
    showModal('Running Tests', loadingContent);

    (async () => {
      try {
        const res = await apiRequest('/playwright-runs/execute', { method: 'POST', body });
        const runId = res.playwrightRun && res.playwrightRun.id;
        if (!runId) {
          hideModal();
          alert('Error: No run id returned.');
          return;
        }
        let pollCount = 0;
        const maxPoll = 120;
        const pollProgress = async () => {
          try {
            const run = await apiRequest(`/playwright-runs/${runId}`);
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
            setTimeout(pollProgress, 1500);
          } catch (err) {
            if (isServerUnavailable(err)) {
              hideModal();
              if (typeof window.loadTestRuns === 'function') window.loadTestRuns();
              return;
            }
            setTimeout(pollProgress, 1500);
          }
        };
        setTimeout(pollProgress, 500);
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

  document.getElementById('back-from-run-ui-tests')?.addEventListener('click', () => {
    const returnView = window._uiTestsReturnView || 'ui-tests';
    showView(returnView);
    if (typeof loadViewData === 'function') loadViewData(returnView);
    if (returnView === 'ui-tests') loadPlaywrightRuns();
  });

  let currentCodegenSlug = null;
  let autoRefreshInterval = null;

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
    }, 2000); // Check every 2 seconds
  }

  async function loadCodegenOutput(slug, showAlert = true) {
    if (!slug) return;
    try {
      const res = await apiRequest(`/playwright-recorded-tests/codegen-output/${slug}`);
      const specInput = document.getElementById('recorded-test-spec');
      if (specInput && res.content) {
        specInput.value = res.content;
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

  function showAddRecordedTestView(editId) {
    const form = document.getElementById('recorded-test-form');
    const idInput = document.getElementById('recorded-test-id');
    const titleEl = document.getElementById('recorded-test-form-title');
    const nameInput = document.getElementById('recorded-test-name');
    const baseUrlInput = document.getElementById('recorded-test-base-url');
    const specInput = document.getElementById('recorded-test-spec');
    const codegenUrlInput = document.getElementById('recorded-test-codegen-url');
    const loadBtn = document.getElementById('load-codegen-output-btn');
    const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
    const addToProjectWrap = document.getElementById('recorded-test-add-to-project-wrap');
    const addToProjectSelect = document.getElementById('recorded-test-add-to-project');
    if (!form) return;
    
    if (addToProjectWrap) addToProjectWrap.style.display = editId ? 'none' : 'block';
    if (addToProjectSelect) addToProjectSelect.innerHTML = '<option value="">None</option>';
    
    // Reset codegen state when opening form (unless editing)
    if (!editId) {
      currentCodegenSlug = null;
      stopAutoRefresh();
      if (loadBtn) loadBtn.style.display = 'none';
      if (autoRefreshBtn) autoRefreshBtn.style.display = 'none';
    }
    
    idInput.value = editId || '';
    titleEl.textContent = editId ? 'Edit recorded test' : 'Add recorded test';
    nameInput.value = '';
    baseUrlInput.value = '';
    specInput.value = '';
    if (editId) {
      apiRequest(`/playwright-recorded-tests/${editId}`)
        .then(t => {
          nameInput.value = t.name || '';
          baseUrlInput.value = t.base_url || '';
          specInput.value = t.spec_content || '';
          codegenUrlInput.value = (t.base_url || '').trim() || codegenUrlInput.placeholder;
        })
        .catch(err => alert('Error loading recorded test: ' + err.message));
    } else {
      // Load default URL from config and projects for "Also add to project"
      apiRequest('/playwright-config').then(c => {
        const defaultUrl = (c.baseUrl || '').trim() || 'https://example.com';
        codegenUrlInput.value = defaultUrl;
        if (baseUrlInput) baseUrlInput.value = defaultUrl;
      }).catch(() => { 
        codegenUrlInput.value = 'https://example.com';
        if (baseUrlInput) baseUrlInput.value = 'https://example.com';
      });
      apiRequest('/projects').then(projects => {
        if (addToProjectSelect && Array.isArray(projects) && projects.length > 0) {
          addToProjectSelect.innerHTML = '<option value="">None</option>' + projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        }
      }).catch(() => {});
    }
    showView('add-recorded-test');
  }

  document.getElementById('add-recorded-test-btn')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('add-recorded-test-btn-main')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('back-from-recorded-test')?.addEventListener('click', () => {
    stopAutoRefresh();
    currentCodegenSlug = null;
    showView('ui-tests');
    loadPlaywrightRuns();
  });
  document.getElementById('recorded-test-cancel')?.addEventListener('click', () => {
    stopAutoRefresh();
    currentCodegenSlug = null;
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('launch-codegen-btn')?.addEventListener('click', async () => {
    const urlInput = document.getElementById('recorded-test-codegen-url');
    const baseUrlInput = document.getElementById('recorded-test-base-url');
    const url = (urlInput?.value || '').trim();
    if (!url) {
      alert('Please enter a Base URL for recording');
      return;
    }
    try {
      const res = await apiRequest('/playwright-recorded-tests/launch-codegen', {
        method: 'POST',
        body: { baseUrl: url }
      });
      // Store the slug for loading the output
      currentCodegenSlug = res.slug;
      // Show the load button
      const loadBtn = document.getElementById('load-codegen-output-btn');
      const autoRefreshBtn = document.getElementById('auto-refresh-codegen-btn');
      if (loadBtn) loadBtn.style.display = 'inline-block';
      if (autoRefreshBtn) autoRefreshBtn.style.display = 'inline-block';
      
      // Also update base URL field if empty
      if (baseUrlInput && !baseUrlInput.value.trim()) {
        baseUrlInput.value = url;
      }
      
      alert(res.message || 'Codegen launched! Browser and Inspector should open. Record your interactions, then click "Load generated code" to load the test code.');
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
    const baseUrl = document.getElementById('recorded-test-base-url')?.value?.trim() || null;
    const spec = document.getElementById('recorded-test-spec')?.value?.trim();
    const addToProjectEl = document.getElementById('recorded-test-add-to-project');
    const addToProjectId = addToProjectEl?.value?.trim() || null;
    if (!name) { alert('Test name is required'); return; }
    if (!spec) { alert('Generated spec is required'); return; }
    const editId = idInput?.value?.trim() || null;
    try {
      if (editId) {
        await apiRequest(`/playwright-recorded-tests/${editId}`, { method: 'PUT', body: { name, spec_content: spec, base_url: baseUrl } });
        alert('Recorded test updated.');
      } else {
        const body = { name, spec_content: spec, base_url: baseUrl };
        if (addToProjectId) body.addToProjectIds = [Number(addToProjectId)];
        await apiRequest('/playwright-recorded-tests', { method: 'POST', body });
        alert('Recorded test saved. It will appear in the test list when you run UI tests.');
      }
      currentCodegenSlug = null;
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
        return `
        <div class="test-result-item">
          <div class="test-result-header">
            <div><strong>${r.test_name}</strong>${r.endpoint ? ` <span style="font-size: 12px; color: #6b7280;">${r.endpoint}</span>` : ''}</div>
            <span class="status-badge ${r.status}">${r.status}</span>
          </div>
          <div class="test-result-details">
            ${r.duration_ms != null ? `<p><strong>Duration:</strong> ${r.duration_ms} ms</p>` : ''}
            ${r.error_message ? `<p style="color: #dc2626;"><strong>Error:</strong> ${r.error_message}</p>` : ''}
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
});

  window.viewPlaywrightRun = viewPlaywrightRun;
  window.loadPlaywrightRuns = loadPlaywrightRuns;
  window.showRunUiTestsPage = showRunUiTestsPage;
  window.showProjectRecordedTestsView = showProjectRecordedTestsView;
})();

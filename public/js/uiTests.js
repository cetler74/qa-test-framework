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
    if (!container) return;
    try {
      const [tests, config] = await Promise.all([
        apiRequest('/playwright-tests/list'),
        apiRequest('/playwright-config').catch(() => ({}))
      ]);
      testList = tests;
      if (urlInput && config.baseUrl) urlInput.value = config.baseUrl;
      renderTestList(false);
      const radios = document.querySelectorAll('input[name="test-list-type"]');
      radios.forEach(r => r.addEventListener('change', () => {
        renderTestList(document.querySelector('input[name="test-list-type"]:checked').value === 'selected');
      }));
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

  function showRunUiTestsPage() {
    showView('run-ui-tests');
    loadRunUiTestsPage();
  }

  document.getElementById('run-ui-tests-page-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('run-ui-tests-name')?.value?.trim();
    const baseUrlInput = document.getElementById('run-ui-tests-base-url')?.value?.trim();
    if (!name) return;
    const listType = document.querySelector('input[name="test-list-type"]:checked')?.value || 'full';
    const body = { name, suite: listType };
    if (baseUrlInput) body.baseUrl = baseUrlInput;
    if (listType === 'selected') {
      const checked = document.querySelectorAll('.playwright-test-cb:checked');
      body.selectedTestIds = Array.from(checked).map(cb => cb.getAttribute('data-test-id'));
      if (body.selectedTestIds.length === 0) {
        alert('Select at least one test.');
        return;
      }
    }
    try {
      const res = await apiRequest('/playwright-runs/execute', { method: 'POST', body });
      showView('ui-tests');
      loadPlaywrightRuns();
      if (res.playwrightRun && res.playwrightRun.id) {
        let pollCount = 0;
        const maxPoll = 60;
        const poll = async () => {
          try {
            const run = await apiRequest(`/playwright-runs/${res.playwrightRun.id}`);
            if (run.status !== 'running' || ++pollCount >= maxPoll) {
              loadPlaywrightRuns();
              if (run.status !== 'running') viewPlaywrightRun(res.playwrightRun.id);
              return;
            }
            setTimeout(poll, 1500);
          } catch (err) {
            if (isServerUnavailable(err)) {
              loadPlaywrightRuns();
              return;
            }
            loadPlaywrightRuns();
          }
        };
        setTimeout(poll, 1500);
      }
    } catch (err) {
      alert('Error starting UI tests: ' + err.message);
    }
  });

  document.getElementById('run-ui-tests-cancel')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('back-from-run-ui-tests')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  function showAddRecordedTestView(editId) {
    const form = document.getElementById('recorded-test-form');
    const idInput = document.getElementById('recorded-test-id');
    const titleEl = document.getElementById('recorded-test-form-title');
    const nameInput = document.getElementById('recorded-test-name');
    const baseUrlInput = document.getElementById('recorded-test-base-url');
    const specInput = document.getElementById('recorded-test-spec');
    const codegenUrlInput = document.getElementById('recorded-test-codegen-url');
    if (!form) return;
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
      apiRequest('/playwright-config').then(c => {
        codegenUrlInput.value = (c.baseUrl || '').trim() || 'https://example.com';
      }).catch(() => { codegenUrlInput.value = 'https://example.com'; });
    }
    showView('add-recorded-test');
  }

  document.getElementById('add-recorded-test-btn')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('add-recorded-test-btn-main')?.addEventListener('click', () => showAddRecordedTestView());
  document.getElementById('back-from-recorded-test')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });
  document.getElementById('recorded-test-cancel')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
  });

  document.getElementById('copy-codegen-cmd-btn')?.addEventListener('click', () => {
    const urlInput = document.getElementById('recorded-test-codegen-url');
    const url = (urlInput?.value || '').trim() || 'https://example.com';
    const cmd = `npx playwright codegen ${url}`;
    navigator.clipboard.writeText(cmd).then(() => alert('Command copied to clipboard')).catch(() => alert('Could not copy'));
  });

  document.getElementById('recorded-test-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idInput = document.getElementById('recorded-test-id');
    const name = document.getElementById('recorded-test-name')?.value?.trim();
    const baseUrl = document.getElementById('recorded-test-base-url')?.value?.trim() || null;
    const spec = document.getElementById('recorded-test-spec')?.value?.trim();
    if (!name) { alert('Test name is required'); return; }
    if (!spec) { alert('Generated spec is required'); return; }
    const editId = idInput?.value?.trim() || null;
    try {
      if (editId) {
        await apiRequest(`/playwright-recorded-tests/${editId}`, { method: 'PUT', body: { name, spec_content: spec, base_url: baseUrl } });
        alert('Recorded test updated.');
      } else {
        await apiRequest('/playwright-recorded-tests', { method: 'POST', body: { name, spec_content: spec, base_url: baseUrl } });
        alert('Recorded test saved. It will appear in the test list when you run UI tests.');
      }
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
      resultsEl.innerHTML = results.map(r => `
        <div class="test-result-item">
          <div class="test-result-header">
            <div><strong>${r.test_name}</strong>${r.endpoint ? ` <span style="font-size: 12px; color: #6b7280;">${r.endpoint}</span>` : ''}</div>
            <span class="status-badge ${r.status}">${r.status}</span>
          </div>
          <div class="test-result-details">
            ${r.duration_ms != null ? `<p><strong>Duration:</strong> ${r.duration_ms} ms</p>` : ''}
            ${r.error_message ? `<p style="color: #dc2626;"><strong>Error:</strong> ${r.error_message}</p>` : ''}
            ${r.assertions ? `<pre style="font-size: 12px; margin-top: 8px; padding: 8px; background: #f9fafb; border-radius: 6px;">${JSON.stringify(r.assertions, null, 2)}</pre>` : ''}
          </div>
        </div>
      `).join('');
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
  document.getElementById('run-ui-tests-btn')?.addEventListener('click', showRunUiTestsPage);
  document.getElementById('back-to-ui-tests')?.addEventListener('click', () => {
    showView('ui-tests');
    loadPlaywrightRuns();
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
})();

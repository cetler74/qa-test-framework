// API Base URL
const API_BASE = '/api';

// Utility functions
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// Polling for running test/fuzz run detail (clear when leaving detail view)
let _detailPollingInterval = null;
function clearDetailPolling() {
  if (_detailPollingInterval) {
    clearInterval(_detailPollingInterval);
    _detailPollingInterval = null;
  }
}

// View management (store previous view so "Back" from Run UI Tests / UI Test Detail returns to it)
function showView(viewId) {
  if (viewId !== 'test-run-detail') {
    clearDetailPolling();
  }
  const activeEl = document.querySelector('.view.active');
  const currentId = activeEl && activeEl.id ? activeEl.id.replace(/-view$/, '') : null;
  if (currentId && currentId !== viewId) {
    window._uiTestsReturnView = currentId;
  }
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  document.getElementById(`${viewId}-view`).classList.add('active');
  
  // Update nav buttons (Settings gets active when on api-specs or ui-tests)
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const navBtn = document.querySelector(`.main-nav .nav-btn[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
  const settingsNavBtn = document.getElementById('settings-nav-btn');
  if (settingsNavBtn && (viewId === 'api-specs' || viewId === 'ui-tests')) {
    settingsNavBtn.classList.add('active');
  }
  closeSettingsDropdown();
}

function closeSettingsDropdown() {
  const menu = document.getElementById('settings-dropdown-menu');
  const btn = document.getElementById('settings-nav-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// Modal management
function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.id === 'settings-nav-btn') {
        e.preventDefault();
        e.stopPropagation();
        const menu = document.getElementById('settings-dropdown-menu');
        const isOpen = menu ? menu.classList.toggle('open') : false;
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        return;
      }
      const view = btn.getAttribute('data-view');
      if (view) {
        showView(view);
        loadViewData(view);
      }
    });
  });

  // Settings dropdown items
  document.querySelectorAll('.settings-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.getAttribute('data-view');
      if (view) {
        showView(view);
        loadViewData(view);
      }
    });
  });

  // Close Settings dropdown when clicking outside
  document.addEventListener('click', () => closeSettingsDropdown());
  document.querySelector('.settings-dropdown')?.addEventListener('click', (e) => e.stopPropagation());

  // Modal close
  document.querySelector('.modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      hideModal();
    }
  });

  // Theme toggle: load and apply saved preference (or follow system) and wire toggle button
  const themeToggle = document.getElementById('theme-toggle');
  const themeToggleIcon = document.getElementById('theme-toggle-icon');
  function applyTheme(theme) {
    if (theme === 'dark') document.body.classList.add('dark-theme');
    else document.body.classList.remove('dark-theme');
    if (themeToggleIcon) {
      // Update SVG icon based on theme
      if (theme === 'dark') {
        themeToggleIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />';
        themeToggle.setAttribute('title', 'Switch to light theme');
      } else {
        themeToggleIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />';
        themeToggle.setAttribute('title', 'Switch to dark theme');
      }
    }
  }
  const savedTheme = localStorage.getItem('theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(savedTheme);
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const newTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
      // Persist the choice first so the theme is applied on reload
      localStorage.setItem('theme', newTheme);
      // Reload the page so all UI is redrawn using the new theme (ensures inline-styled components pick it up)
      location.reload();
    });
  }

  // Initial load
  loadDashboard();

  // Filter event bindings for Test Runs
  const applyFiltersBtn = document.getElementById('apply-filters-btn');
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => loadTestRuns());
  }

  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      const search = document.getElementById('test-run-search');
      const start = document.getElementById('start-date');
      const end = document.getElementById('end-date');
      const project = document.getElementById('project-filter');
      const typeFilter = document.getElementById('test-run-type-filter');
      if (search) search.value = '';
      if (start) start.value = '';
      if (end) end.value = '';
      if (project) project.value = '';
      if (typeFilter) typeFilter.value = 'all';
      loadTestRuns();
    });
  }

  const searchInput = document.getElementById('test-run-search');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') loadTestRuns();
    });
  }

  const runHubProject = document.getElementById('run-hub-project');
  const runHubType = document.querySelectorAll('input[name="run-hub-type"]');
  const runHubFlow = document.getElementById('run-hub-flow');
  const runHubGo = document.getElementById('run-hub-go');
  if (runHubProject) {
    runHubProject.addEventListener('change', async () => {
      const projectId = runHubProject.value;
      if (!runHubFlow) return;
      runHubFlow.innerHTML = '<option value="">Select flow...</option>';
      if (!projectId) return;
      try {
        const flows = await apiRequest(`/projects/${projectId}/flows`);
        runHubFlow.innerHTML = '<option value="">Select flow...</option>' + (flows || []).map(f => `<option value="${f.id}" data-name="${(f.name || '').replace(/"/g, '&quot;')}">${(f.name || 'Unnamed').replace(/</g, '&lt;')}</option>`).join('');
      } catch (e) {}
    });
  }
  if (runHubType.length) {
    runHubType.forEach(r => r.addEventListener('change', () => {
      if (runHubFlow) runHubFlow.style.display = document.querySelector('input[name="run-hub-type"]:checked')?.value === 'flow' ? 'block' : 'none';
    }));
  }
  if (runHubGo) {
    runHubGo.addEventListener('click', async () => {
      const projectId = document.getElementById('run-hub-project')?.value;
      const type = document.querySelector('input[name="run-hub-type"]:checked')?.value;
      const flowId = runHubFlow?.value;
      if (!projectId) { alert('Select a project'); return; }
      if (type === 'flow' && !flowId) { alert('Select a flow'); return; }
      if (typeof viewProject !== 'function') { alert('Cannot run'); return; }
      viewProject(Number(projectId));
      if (type === 'api') {
        setTimeout(() => document.getElementById('run-tests-btn')?.click(), 300);
      } else if (type === 'ui') {
        setTimeout(() => document.getElementById('run-ui-test-btn')?.click(), 300);
      } else if (type === 'flow' && flowId) {
        const opt = runHubFlow?.options[runHubFlow.selectedIndex];
        const flowName = opt?.getAttribute('data-name') || opt?.text || 'Flow';
        setTimeout(() => { if (typeof runFlow === 'function') runFlow(Number(flowId), flowName); }, 300);
      }
    });
  }
});

// Load view data
async function loadViewData(view) {
  switch (view) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'projects':
      loadProjects();
      break;
    case 'api-specs':
      loadApiSpecs();
      break;
    case 'test-runs':
      loadTestRuns();
      break;
    case 'ui-tests':
      // UI test runs are shown only in Test Runs; no list to load here
      break;
  }
}

// Dashboard (unified recent runs: API + UI with type badge, Quick Run, Next scheduled)
async function loadDashboard() {
  try {
    const [projects, apiSpecs, testRuns, schedules] = await Promise.all([
      apiRequest('/projects'),
      apiRequest('/api-specs'),
      apiRequest('/test-runs?limit=5&type=all'),
      apiRequest('/schedules?nextWithin=24').catch(() => [])
    ]);

    document.getElementById('total-projects').textContent = projects.length;
    document.getElementById('total-api-specs').textContent = apiSpecs.length;
    document.getElementById('total-test-runs').textContent = testRuns.length;

    const runHubProject = document.getElementById('run-hub-project');
    if (runHubProject) {
      runHubProject.innerHTML = '<option value="">Select project...</option>' + (projects || []).map(p => `<option value="${p.id}">${(p.name || '').replace(/"/g, '&quot;')}</option>`).join('');
    }

    const nextScheduledList = document.getElementById('next-scheduled-list');
    if (nextScheduledList) {
      if (!schedules || schedules.length === 0) {
        nextScheduledList.innerHTML = '<p class="empty-state">No scheduled runs in the next 24 hours.</p>';
      } else {
        nextScheduledList.innerHTML = schedules.map(s => {
          const target = s.flow ? `Flow: ${s.flow.name}` : 'Whole project';
          const next = s.next_run_at ? formatDateTime(s.next_run_at) : '–';
          return `<div class="list-item" style="padding: 12px 16px;"><div class="list-item-info"><h3 style="font-size: 14px;">${(s.project?.name || 'Project')} – ${target}</h3><p style="font-size: 12px;">Next: ${next}</p></div></div>`;
        }).join('');
      }
    }

    const recentRunsList = document.getElementById('recent-runs-list');
    if (testRuns.length === 0) {
      recentRunsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p>No test runs yet</p>
        </div>
      `;
    } else {
      recentRunsList.innerHTML = testRuns.map(run => {
        const runType = run.runType || 'api';
        const onClick = runType === 'ui' ? `viewPlaywrightRun(${run.id})` : runType === 'fuzz' ? `viewFuzzRun(${run.id})` : `viewTestRun(${run.id})`;
        const typeBadge = getRunTypeBadgeHtml(runType);
        const flowLabel = run.flow?.name ? ` • Flow: ${run.flow.name}` : '';
        return `
        <div class="list-item" onclick="${onClick}" style="cursor: pointer;">
          <div class="list-item-info">
            <h3>${typeBadge} ${run.name}</h3>
            <p>Project: ${run.project?.name || 'Unknown'}${flowLabel} • ${formatDateTime(run.created_at)}</p>
          </div>
          <span class="status-badge ${run.status}">${run.status}</span>
        </div>
      `;
      }).join('');
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Projects
async function loadProjects() {
  try {
    const projects = await apiRequest('/projects');
    const projectsList = document.getElementById('projects-list');
    
    if (projects.length === 0) {
      projectsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3>No projects yet</h3>
          <p>Create your first project to get started</p>
        </div>
      `;
    } else {
      projectsList.innerHTML = projects.map(project => `
        <div class="list-item">
          <div class="list-item-info" onclick="viewProject(${project.id})" style="cursor: pointer;">
            <h3>${project.name}</h3>
            <p>${project.description || 'No description'}</p>
            <p style="font-size: 12px; color: #999; margin-top: 5px;">
              ${project.apiSpecs?.length || 0} API spec(s)
            </p>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-secondary" onclick="editProject(${project.id})">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button class="btn btn-danger" onclick="deleteProject(${project.id})">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading projects:', error);
  }
}

// API Specs
async function loadApiSpecs() {
  try {
    const apiSpecs = await apiRequest('/api-specs');
    const apiSpecsList = document.getElementById('api-specs-list');
    
    if (apiSpecs.length === 0) {
      apiSpecsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3>No API specs yet</h3>
          <p>Upload your first API specification file</p>
        </div>
      `;
    } else {
      apiSpecsList.innerHTML = apiSpecs.map(spec => `
        <div class="list-item">
          <div class="list-item-info">
            <h3>${spec.name}</h3>
            <p>Format: ${spec.format.toUpperCase()} • ${(spec.file_size / 1024).toFixed(2)} KB</p>
            <p style="font-size: 12px; color: #999; margin-top: 5px;">
              ${spec.collections?.length || 0} collection(s)
            </p>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-danger" onclick="deleteApiSpec(${spec.id})">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading API specs:', error);
  }
}

// Helper to format date as DD/MM/YYYY, keeping time portion
function formatDateTime(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  // Preserve the time format (12-hour with AM/PM) using toLocaleTimeString
  const time = d.toLocaleTimeString();
  return `${dd}/${mm}/${yyyy}, ${time}`;
}

// Run type badge HTML: icon + color label for API vs UI vs SOAP vs Fuzz
function getRunTypeBadgeHtml(runType) {
  const type = runType === 'ui' ? 'ui' : runType === 'soap' ? 'soap' : runType === 'fuzz' ? 'fuzz' : 'api';
  const label = type === 'ui' ? 'UI' : type === 'soap' ? 'SOAP' : type === 'fuzz' ? 'Fuzz' : 'API';
  const apiIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>';
  const uiIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>';
  const soapIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>';
  const fuzzIcon = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>';
  const icon = type === 'ui' ? uiIcon : type === 'soap' ? soapIcon : type === 'fuzz' ? fuzzIcon : apiIcon;
  return `<span class="run-type-badge run-type-${type}">${icon}${label}</span>`;
}

// Test Runs (unified API + UI; type filter and runType badge)
async function loadTestRuns() {
  try {
    // Populate projects dropdown
    const projects = await apiRequest('/projects');
    const projectFilter = document.getElementById('project-filter');
    const currentProject = projectFilter?.value || '';
    if (projectFilter) {
      projectFilter.innerHTML = `<option value="">All Projects</option>` + projects.map(p => `
        <option value="${p.id}" ${p.id == currentProject ? 'selected' : ''}>${p.name}</option>
      `).join('');
    }

    const name = document.getElementById('test-run-search')?.value.trim();
    const projectId = document.getElementById('project-filter')?.value;
    const startDate = document.getElementById('start-date')?.value;
    const endDate = document.getElementById('end-date')?.value;
    const typeFilter = document.getElementById('test-run-type-filter');
    const type = typeFilter?.value || 'all';

    const params = new URLSearchParams();
    params.append('type', type);
    if (projectId) params.append('projectId', projectId);
    if (name) params.append('name', name);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    params.append('limit', '50');

    const endpoint = `/test-runs?${params.toString()}`;
    const testRuns = await apiRequest(endpoint);
    const testRunsList = document.getElementById('test-runs-list');

    if (testRuns.length === 0) {
      testRunsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <h3>No test runs yet</h3>
          <p>Run your first test to see results here</p>
        </div>
      `;
    } else {
      testRunsList.innerHTML = testRuns.map(run => {
        const runType = run.runType || 'api';
        const projectName = run.project?.name || (run.project_id ? 'Unknown' : 'No project');
        const onClick = runType === 'ui' ? `viewPlaywrightRun(${run.id})` : runType === 'fuzz' ? `viewFuzzRun(${run.id})` : `viewTestRun(${run.id})`;
        const typeBadge = getRunTypeBadgeHtml(runType);
        const flowLabel = run.flow?.name ? ` • Flow: ${run.flow.name}` : '';
        const isRunning = (run.status || '').toLowerCase() === 'running';
        const progressMsg = (run.progress_message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const runningLine = isRunning
          ? '<p class="run-status-in-progress">Run in progress — results will update when complete</p>' + (progressMsg ? `<p class="fuzz-progress-output" title="Live CATS output">${progressMsg}</p>` : '')
          : '';
        return `
        <div class="list-item" onclick="${onClick}" style="cursor: pointer;">
          <div class="list-item-info">
            <h3>${typeBadge} ${run.name}</h3>
            <p>Project: ${projectName}${flowLabel} • ${formatDateTime(run.created_at)}</p>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">
              ${run.passed_tests != null ? run.passed_tests : 0} passed, ${run.failed_tests != null ? run.failed_tests : 0} failed of ${run.total_tests != null ? run.total_tests : 0} total
            </p>
            ${runningLine}
          </div>
          <span class="status-badge ${run.status || 'pending'}">${run.status || 'pending'}</span>
        </div>
      `;
      }).join('');
    }
  } catch (error) {
    console.error('Error loading test runs:', error);
  }
}



// View test run
async function viewTestRun(testRunId) {
  clearDetailPolling();
  try {
    const testRun = await apiRequest(`/test-runs/${testRunId}`);
    const status = (testRun.status || 'pending').toLowerCase();
    const isRunning = status === 'running';

    // Set test run name, date, and status at the top
    const nameElement = document.getElementById('test-run-detail-name');
    nameElement.innerHTML = `
      <div style="margin-bottom: 12px; font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Name:</span>
        <span style="margin-left: 8px;">${testRun.name}</span>
      </div>
      <div style="margin-bottom: 12px; font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Date:</span>
        <span style="margin-left: 8px;">${formatDateTime(testRun.created_at)}</span>
      </div>
      <div style="font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Status:</span>
        <span class="status-badge ${testRun.status}" style="margin-left: 8px;">${testRun.status}</span>
        ${isRunning ? '<p style="margin-top: 8px; color: var(--color-warning, #f59e0b); font-weight: 600;">Run in progress — results will update automatically.</p>' : ''}
      </div>
    `;

    const info = document.getElementById('test-run-info');
    info.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${testRun.total_tests || 0}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #4caf50;">${testRun.passed_tests || 0}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #f44336;">${testRun.failed_tests || 0}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(testRun.duration_ms / 1000).toFixed(2)}s</div>
        <div class="stat-label">Duration</div>
      </div>
    `;
    
    const resultsList = document.getElementById('test-results-list');
    if (testRun.testResults && testRun.testResults.length > 0) {
      // Recalculate statistics from actual test results if database counts are wrong
      const actualTotal = testRun.testResults.length;
      const actualPassed = testRun.testResults.filter(r => r.status === 'passed').length;
      const actualFailed = testRun.testResults.filter(r => r.status === 'failed').length;
      
      // Update stats if they don't match
      if (testRun.total_tests !== actualTotal || testRun.passed_tests !== actualPassed || testRun.failed_tests !== actualFailed) {
        info.innerHTML = `
          <div class="stat-card">
            <div class="stat-value">${actualTotal}</div>
            <div class="stat-label">Total Tests</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #4caf50;">${actualPassed}</div>
            <div class="stat-label">Passed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #f44336;">${actualFailed}</div>
            <div class="stat-label">Failed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(testRun.duration_ms / 1000).toFixed(2)}s</div>
            <div class="stat-label">Duration</div>
          </div>
        `;
      }
      
      resultsList.innerHTML = testRun.testResults.map(result => `
        <div class="test-result-item">
          <div class="test-result-header">
            <div>
              ${result.test_id ? `<span style="margin-right: 8px; font-weight: bold; color: #14b8a6;">${result.test_id}</span>` : ''}
              <span class="method-badge ${result.method}">${result.method}</span>
              <strong>${result.test_name}</strong>
            </div>
            <span class="status-badge ${result.status}">${result.status}</span>
          </div>
          <div class="test-result-details">
            <p><strong>Endpoint:</strong> ${result.endpoint}</p>
            ${result.response_code ? `<p><strong>Response Code:</strong> ${result.response_code}</p>` : ''}
            ${result.error_message ? `<p style="color: #f44336;"><strong>Error:</strong> ${result.error_message}</p>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      const emptyMsg = isRunning ? 'Run in progress. No results yet — they will appear when the run completes.' : 'No test results';
      resultsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p>${emptyMsg}</p>
        </div>
      `;
    }

    // Store test run ID for report buttons (clear fuzz so report opens API report)
    const viewBtn = document.getElementById('view-report-btn');
    const downloadBtn = document.getElementById('download-report-btn');
    viewBtn.removeAttribute('data-fuzz-run-id');
    viewBtn.removeAttribute('data-detail-type');
    downloadBtn.removeAttribute('data-fuzz-run-id');
    downloadBtn.removeAttribute('data-detail-type');
    viewBtn.setAttribute('data-test-run-id', testRunId);
    downloadBtn.setAttribute('data-test-run-id', testRunId);
    showView('test-run-detail');

    if (isRunning) {
      _detailPollingInterval = setInterval(() => viewTestRun(testRunId), 3000);
    }
  } catch (error) {
    console.error('Error loading test run:', error);
    alert('Error loading test run: ' + error.message);
  }
}

// View fuzz run (reuses test-run-detail view; report buttons use fuzz endpoints)
async function viewFuzzRun(fuzzRunId) {
  clearDetailPolling();
  try {
    const fuzzRun = await apiRequest(`/fuzz-runs/${fuzzRunId}`);
    const status = (fuzzRun.status || 'pending').toLowerCase();
    const isRunning = status === 'running';

    const nameElement = document.getElementById('test-run-detail-name');
    nameElement.innerHTML = `
      <div style="margin-bottom: 12px; font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Name:</span>
        <span style="margin-left: 8px;">${fuzzRun.name}</span>
        <span class="run-type-badge run-type-fuzz" style="margin-left: 12px;">Fuzz</span>
      </div>
      <div style="margin-bottom: 12px; font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Date:</span>
        <span style="margin-left: 8px;">${formatDateTime(fuzzRun.created_at)}</span>
      </div>
      <div style="font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Status:</span>
        <span class="status-badge ${fuzzRun.status || 'pending'}" style="margin-left: 8px;">${fuzzRun.status || 'pending'}</span>
        ${isRunning ? '<p class="run-status-in-progress" style="margin-top: 8px;">Fuzz run in progress — results will update automatically.</p>' : ''}
        ${isRunning && fuzzRun.progress_message ? `<div class="fuzz-detail-progress"><span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Progress:</span><pre class="fuzz-progress-pre">${(fuzzRun.progress_message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>` : ''}
      </div>
    `;
    const info = document.getElementById('test-run-info');
    info.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${fuzzRun.total_tests ?? 0}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #4caf50;">${fuzzRun.passed_tests ?? 0}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #f44336;">${fuzzRun.failed_tests ?? 0}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fuzzRun.duration_ms != null ? (fuzzRun.duration_ms / 1000).toFixed(2) : '—'}s</div>
        <div class="stat-label">Duration</div>
      </div>
    `;
    const resultsList = document.getElementById('test-results-list');
    if (fuzzRun.fuzzResults && fuzzRun.fuzzResults.length > 0) {
      resultsList.innerHTML = fuzzRun.fuzzResults.map(r => {
        const statusLabel = (r.status === 'error' || r.status === 'failed') && r.response_code != null
          ? `${r.status} (${r.response_code})`
          : (r.status || '—');
        return `
        <div class="test-result-item">
          <div class="test-result-header">
            <div>
              <strong>${r.test_name}</strong>
              ${r.fuzzer_name ? `<span style="margin-left: 8px; font-size: 12px; color: #6b7280;">${r.fuzzer_name}</span>` : ''}
            </div>
            <span class="status-badge ${r.status}">${statusLabel}</span>
          </div>
          <div class="test-result-details">
            ${r.response_code != null ? `<p><strong>Response Code:</strong> ${r.response_code}</p>` : ''}
            ${r.error_message ? `<p style="color: #f44336;"><strong>Error:</strong> ${r.error_message}</p>` : ''}
          </div>
        </div>
      `;
      }).join('');
    } else {
      const emptyMsg = isRunning ? 'Fuzz run in progress. No results yet — they will appear when the run completes.' : 'No fuzz results';
      resultsList.innerHTML = `
        <div class="empty-state">
          <p>${emptyMsg}</p>
        </div>
      `;
    }
    const viewBtn = document.getElementById('view-report-btn');
    const downloadBtn = document.getElementById('download-report-btn');
    viewBtn.removeAttribute('data-test-run-id');
    downloadBtn.removeAttribute('data-test-run-id');
    viewBtn.setAttribute('data-fuzz-run-id', fuzzRunId);
    viewBtn.setAttribute('data-detail-type', 'fuzz');
    downloadBtn.setAttribute('data-fuzz-run-id', fuzzRunId);
    downloadBtn.setAttribute('data-detail-type', 'fuzz');
    showView('test-run-detail');

    if (isRunning) {
      _detailPollingInterval = setInterval(() => viewFuzzRun(fuzzRunId), 3000);
    }
  } catch (error) {
    console.error('Error loading fuzz run:', error);
    alert('Error loading fuzz run: ' + error.message);
  }
}

// Back buttons
document.getElementById('back-to-projects')?.addEventListener('click', () => {
  showView('projects');
  loadProjects();
});

document.getElementById('back-to-test-runs')?.addEventListener('click', () => {
  showView('test-runs');
  loadTestRuns();
});

// Export functions for onclick handlers
window.viewProject = (projectId) => {
  // Handled in projectManager.js
};

window.viewTestRun = viewTestRun;
window.viewFuzzRun = viewFuzzRun;
window.loadTestRuns = loadTestRuns;

window.editProject = (projectId) => {
  // Handled in projectManager.js
};

window.deleteProject = async (projectId) => {
  if (!confirm('Are you sure you want to delete this project?')) return;
  
  try {
    await apiRequest(`/projects/${projectId}`, { method: 'DELETE' });
    loadProjects();
  } catch (error) {
    alert('Error deleting project: ' + error.message);
  }
};

window.deleteApiSpec = async (apiSpecId) => {
  if (!confirm('Are you sure you want to delete this API spec?')) return;
  
  try {
    await apiRequest(`/api-specs/${apiSpecId}`, { method: 'DELETE' });
    loadApiSpecs();
  } catch (error) {
    alert('Error deleting API spec: ' + error.message);
  }
};


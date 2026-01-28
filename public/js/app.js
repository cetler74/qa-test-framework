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

// View management
function showView(viewId) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  document.getElementById(`${viewId}-view`).classList.add('active');
  
  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const navBtn = document.querySelector(`[data-view="${viewId}"]`);
  if (navBtn) {
    navBtn.classList.add('active');
  }
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
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      showView(view);
      loadViewData(view);
    });
  });

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
      if (search) search.value = '';
      if (start) start.value = '';
      if (end) end.value = '';
      if (project) project.value = '';
      loadTestRuns();
    });
  }

  const searchInput = document.getElementById('test-run-search');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') loadTestRuns();
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
      if (typeof loadPlaywrightRuns === 'function') loadPlaywrightRuns();
      break;
  }
}

// Dashboard
async function loadDashboard() {
  try {
    const [projects, apiSpecs, testRuns] = await Promise.all([
      apiRequest('/projects'),
      apiRequest('/api-specs'),
      apiRequest('/test-runs?limit=5')
    ]);

    document.getElementById('total-projects').textContent = projects.length;
    document.getElementById('total-api-specs').textContent = apiSpecs.length;
    document.getElementById('total-test-runs').textContent = testRuns.length;

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
      recentRunsList.innerHTML = testRuns.map(run => `
        <div class="list-item" onclick="viewTestRun(${run.id})">
          <div class="list-item-info">
            <h3>${run.name}</h3>
            <p>Project: ${run.project?.name || 'Unknown'} • ${formatDateTime(run.created_at)}</p>
          </div>
          <span class="status-badge ${run.status}">${run.status}</span>
        </div>
      `).join('');
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

// Test Runs
async function loadTestRuns() {
  try {
    // Populate projects dropdown
    const projects = await apiRequest('/projects');
    const projectFilter = document.getElementById('project-filter');
    const currentProject = projectFilter.value || '';
    projectFilter.innerHTML = `<option value="">All Projects</option>` + projects.map(p => `
      <option value="${p.id}" ${p.id == currentProject ? 'selected' : ''}>${p.name}</option>
    `).join('');

    // Read filter values
    const name = document.getElementById('test-run-search')?.value.trim();
    const projectId = document.getElementById('project-filter')?.value;
    const startDate = document.getElementById('start-date')?.value;
    const endDate = document.getElementById('end-date')?.value;

    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (name) params.append('name', name);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    params.append('limit', '50');

    const endpoint = `/test-runs?${params.toString()}`;
    console.info('[loadTestRuns] fetching', endpoint);
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
      testRunsList.innerHTML = testRuns.map(run => `
        <div class="list-item" onclick="viewTestRun(${run.id})" style="cursor: pointer;">
          <div class="list-item-info">
            <h3>${run.name}</h3>
            <p>Project: ${run.project?.name || 'Unknown'} • ${formatDateTime(run.created_at)}</p>
            <p style="font-size: 12px; color: #666; margin-top: 5px;">
              ${run.passed_tests || 0} passed, ${run.failed_tests || 0} failed of ${run.total_tests || 0} total
            </p>
          </div>
          <span class="status-badge ${run.status}">${run.status}</span>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading test runs:', error);
  }
}



// View test run
async function viewTestRun(testRunId) {
  try {
    const testRun = await apiRequest(`/test-runs/${testRunId}`);
    
    // Set test run name and date/time at the top with labels
    const nameElement = document.getElementById('test-run-detail-name');
    nameElement.innerHTML = `
      <div style="margin-bottom: 12px; font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Name:</span>
        <span style="margin-left: 8px;">${testRun.name}</span>
      </div>
      <div style="font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Date:</span>
        <span style="margin-left: 8px;">${formatDateTime(testRun.created_at)}</span>
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
      resultsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p>No test results</p>
        </div>
      `;
    }
    
    // Store test run ID for report buttons
    document.getElementById('view-report-btn').setAttribute('data-test-run-id', testRunId);
    document.getElementById('download-report-btn').setAttribute('data-test-run-id', testRunId);
    
    showView('test-run-detail');
  } catch (error) {
    console.error('Error loading test run:', error);
    alert('Error loading test run: ' + error.message);
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


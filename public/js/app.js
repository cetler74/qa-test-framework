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

  // Initial load
  loadDashboard();
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
      recentRunsList.innerHTML = '<div class="empty-state"><p>No test runs yet</p></div>';
    } else {
      recentRunsList.innerHTML = testRuns.map(run => `
        <div class="list-item" onclick="viewTestRun(${run.id})">
          <div class="list-item-info">
            <h3>${run.name}</h3>
            <p>Project: ${run.project?.name || 'Unknown'} • ${new Date(run.created_at).toLocaleString()}</p>
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
      projectsList.innerHTML = '<div class="empty-state"><h3>No projects yet</h3><p>Create your first project to get started</p></div>';
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
            <button class="btn btn-secondary" onclick="editProject(${project.id})">Edit</button>
            <button class="btn btn-danger" onclick="deleteProject(${project.id})">Delete</button>
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
      apiSpecsList.innerHTML = '<div class="empty-state"><h3>No API specs yet</h3><p>Upload your first API specification file</p></div>';
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
            <button class="btn btn-danger" onclick="deleteApiSpec(${spec.id})">Delete</button>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading API specs:', error);
  }
}

// Test Runs
async function loadTestRuns(projectId = null) {
  try {
    const endpoint = projectId ? `/test-runs?projectId=${projectId}` : '/test-runs';
    const testRuns = await apiRequest(endpoint);
    const testRunsList = document.getElementById('test-runs-list');
    
    if (testRuns.length === 0) {
      testRunsList.innerHTML = '<div class="empty-state"><h3>No test runs yet</h3><p>Run your first test to see results here</p></div>';
    } else {
      testRunsList.innerHTML = testRuns.map(run => `
        <div class="list-item" onclick="viewTestRun(${run.id})" style="cursor: pointer;">
          <div class="list-item-info">
            <h3>${run.name}</h3>
            <p>Project: ${run.project?.name || 'Unknown'} • ${new Date(run.created_at).toLocaleString()}</p>
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
    
    document.getElementById('test-run-detail-name').textContent = testRun.name;
    
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
      resultsList.innerHTML = testRun.testResults.map(result => `
        <div class="test-result-item">
          <div class="test-result-header">
            <div>
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
      resultsList.innerHTML = '<div class="empty-state"><p>No test results</p></div>';
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


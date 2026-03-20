// Project management functions

// Global flag for Tests & Coverage edit mode
window.projectTestsEditMode = false;

document.addEventListener('DOMContentLoaded', () => {
  // Create project button
  document.getElementById('create-project-btn')?.addEventListener('click', showCreateProjectModal);
  
  // Upload API spec button
  document.getElementById('upload-api-spec-btn')?.addEventListener('click', showUploadApiSpecModal);
  
  // Upload Postman collection button
  document.getElementById('upload-postman-collection-btn')?.addEventListener('click', showUploadPostmanCollectionModal);
  
  // Add API spec to project button
  document.getElementById('add-api-spec-btn')?.addEventListener('click', showAddApiSpecToProjectModal);
  
  // Run API tests button
  document.getElementById('run-tests-btn')?.addEventListener('click', showRunTestsModal);

  // Run Fuzz button (from project): open Run Fuzz modal
  document.getElementById('run-fuzz-btn')?.addEventListener('click', showRunFuzzModal);

  // Run SOAP button (from project): open Run SOAP modal
  document.getElementById('run-soap-btn')?.addEventListener('click', showRunSoapModal);
  
  // Run UI Test button (from project): open run UI tests flow with project context
  document.getElementById('run-ui-test-btn')?.addEventListener('click', () => {
    const projectId = document.getElementById('run-ui-test-btn')?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    if (typeof window.showRunUiTestsPage === 'function') {
      window.showRunUiTestsPage(Number(projectId));
    }
  });
  
  // Manage recorded tests for this project
  document.getElementById('manage-project-recorded-tests-btn')?.addEventListener('click', () => {
    const projectId = document.getElementById('manage-project-recorded-tests-btn')?.getAttribute('data-project-id');
    if (!projectId) return;
    if (typeof window.showProjectRecordedTestsView === 'function') {
      window.showProjectRecordedTestsView(Number(projectId));
    }
  });

  // Create flow
  document.getElementById('create-flow-btn')?.addEventListener('click', () => {
    const projectId = document.getElementById('create-flow-btn')?.getAttribute('data-project-id');
    if (!projectId) return;
    showCreateFlowModal(Number(projectId));
  });

  // Create schedule
  document.getElementById('create-schedule-btn')?.addEventListener('click', () => {
    const projectId = document.getElementById('create-schedule-btn')?.getAttribute('data-project-id');
    if (!projectId) return;
    showCreateScheduleModal(Number(projectId));
  });

  // Collapsible Flows and Schedules sections
  document.getElementById('project-flows-toggle')?.addEventListener('click', () => {
    const section = document.getElementById('project-flows-section');
    const btn = document.getElementById('project-flows-toggle');
    if (section && btn) {
      section.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
    }
  });
  document.getElementById('project-schedules-toggle')?.addEventListener('click', () => {
    const section = document.getElementById('project-schedules-section');
    const btn = document.getElementById('project-schedules-toggle');
    if (section && btn) {
      section.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
    }
  });

  // Toggle Tests & Coverage edit mode
  const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
  editModeBtn?.addEventListener('click', () => {
    window.projectTestsEditMode = !window.projectTestsEditMode;
    const projectId = editModeBtn.getAttribute('data-project-id');

    // Update button label/state
    editModeBtn.textContent = window.projectTestsEditMode ? 'Done editing' : 'Edit mode';

    // Show/hide management buttons based on edit mode
    const syncBtn = document.getElementById('sync-project-tests-btn');
    const clearBtn = document.getElementById('clear-project-tests-btn');
    const addBtn = document.getElementById('add-project-test-btn');
    const uploadTestsBtn = document.getElementById('upload-project-tests-btn');
    const displayStyle = window.projectTestsEditMode ? 'inline-flex' : 'none';
    if (syncBtn) syncBtn.style.display = displayStyle;
    if (clearBtn) clearBtn.style.display = displayStyle;
    if (addBtn) addBtn.style.display = displayStyle;
    if (uploadTestsBtn) uploadTestsBtn.style.display = displayStyle;

    if (projectId) {
      loadProjectTests(Number(projectId));
    }
  });

  // Sync project tests catalogue
  document.getElementById('sync-project-tests-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sync-project-tests-btn');
    const projectId = btn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    btn.disabled = true;
    try {
      await apiRequest(`/projects/${projectId}/tests/catalogue/sync`, { method: 'POST' });
      await loadProjectTests(Number(projectId));
      if (typeof window.loadProjectCoverageSummary === 'function') {
        window.loadProjectCoverageSummary(Number(projectId));
      }
    } catch (err) {
      alert('Error syncing tests: ' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  // Clear project tests catalogue
  document.getElementById('clear-project-tests-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('clear-project-tests-btn');
    const projectId = btn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    if (!confirm('Clear all tests from the Tests & Coverage list for this project? This only affects the catalogue, not historical runs.')) {
      return;
    }
    btn.disabled = true;
    try {
      await apiRequest(`/projects/${projectId}/tests/catalogue`, { method: 'DELETE' });
      await loadProjectTests(Number(projectId));
      if (typeof window.loadProjectCoverageSummary === 'function') {
        window.loadProjectCoverageSummary(Number(projectId));
      }
    } catch (err) {
      alert('Error clearing tests: ' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  // Export project tests & coverage as CSV
  document.getElementById('export-project-tests-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('export-project-tests-btn');
    const projectId = btn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    // Simple navigation to download CSV (browser handles file download)
    const url = `/api/projects/${projectId}/tests/catalogue/export`;
    window.location.href = url;
  });

  // Download Tests & Coverage report (filters + coverage summary)
  document.getElementById('download-project-tests-report-btn')?.addEventListener('click', () => {
    if (typeof window.downloadProjectTestsReport === 'function') {
      window.downloadProjectTestsReport();
    }
  });

  // Add manual project test
  document.getElementById('add-project-test-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('add-project-test-btn');
    const projectId = btn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    window.addProjectTest(Number(projectId));
  });

  // Upload project tests from file (edit mode only)
  document.getElementById('upload-project-tests-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('upload-project-tests-btn');
    const projectId = btn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }
    window.showUploadProjectTestsModal(Number(projectId));
  });

  document.getElementById('project-tests-run-selected-btn')?.addEventListener('click', () => {
    const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
    const projectId = editModeBtn?.getAttribute('data-project-id');
    if (!projectId) {
      alert('Please open a project first.');
      return;
    }
    if (typeof window.runBatchProjectCatalogueTests === 'function') {
      window.runBatchProjectCatalogueTests(Number(projectId));
    }
  });
});

// Create Project
function showCreateProjectModal() {
  const content = `
    <form id="create-project-form">
      <div class="form-group">
        <label for="project-name">Project Name *</label>
        <input type="text" id="project-name" required>
      </div>
      <div class="form-group">
        <label for="project-description">Description</label>
        <textarea id="project-description"></textarea>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create</button>
      </div>
    </form>
  `;
  
  showModal('Create Project', content);
  
  document.getElementById('create-project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('project-name').value;
    const description = document.getElementById('project-description').value;
    
    try {
      await apiRequest('/projects', {
        method: 'POST',
        body: { name, description }
      });
      
      hideModal();
      loadProjects();
    } catch (error) {
      alert('Error creating project: ' + error.message);
    }
  });
}

// Edit Project
window.editProject = async (projectId) => {
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    let users = [];
    try {
      users = await apiRequest('/users') || [];
    } catch (e) {}
    const vis = project.visibility || 'private';
    const sharedIds = (project.shared_users || []).map(u => u.id);
    const ownerId = project.owner && project.owner.id;
    const canChangeSharing = window.currentUser && (window.currentUser.is_admin || ownerId === window.currentUser.id);
    const otherUsers = (users || []).filter(u => u.id !== ownerId);
    const sharedOptions = otherUsers.map(u =>
      `<option value="${u.id}" ${sharedIds.includes(u.id) ? 'selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`
    ).join('');

    const sharingBlock = canChangeSharing
      ? `
        <div class="form-group">
          <label for="edit-project-visibility">Visibility</label>
          <select id="edit-project-visibility">
            <option value="private" ${vis === 'private' ? 'selected' : ''}>Private (only you)</option>
            <option value="shared" ${vis === 'shared' ? 'selected' : ''}>Shared (selected users)</option>
            <option value="public" ${vis === 'public' ? 'selected' : ''}>Public (all users)</option>
          </select>
        </div>
        <div class="form-group edit-project-shared-wrap" id="edit-project-shared-wrap" style="display: ${vis === 'shared' ? 'block' : 'none'};">
          <label for="edit-project-shared-users">Shared with</label>
          <select id="edit-project-shared-users" multiple size="4">${sharedOptions}</select>
          <p class="form-hint">Hold Ctrl/Cmd to select multiple users. Only applies when visibility is Shared.</p>
        </div>`
      : '';

    const deleteBlock = canChangeSharing
      ? `<div>
            <button type="button" class="btn btn-danger" id="edit-project-delete-btn">Delete project</button>
          </div>`
      : '';

    const content = `
      <form id="edit-project-form">
        <div class="form-group">
          <label for="edit-project-name">Project Name *</label>
          <input type="text" id="edit-project-name" value="${escapeHtml(project.name)}" required>
        </div>
        <div class="form-group">
          <label for="edit-project-description">Description</label>
          <textarea id="edit-project-description">${escapeHtml(project.description || '')}</textarea>
        </div>
        ${sharingBlock}
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; flex-wrap: wrap; gap: 10px;">
          ${deleteBlock}
          <div style="display: flex; gap: 10px; margin-left: auto;">
            <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </div>
      </form>
    `;

    showModal('Edit project', content);

    const visSelect = document.getElementById('edit-project-visibility');
    const sharedWrap = document.getElementById('edit-project-shared-wrap');
    if (visSelect && sharedWrap) {
      visSelect.addEventListener('change', function () {
        sharedWrap.style.display = this.value === 'shared' ? 'block' : 'none';
      });
    }

    document.getElementById('edit-project-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('edit-project-name').value;
      const description = document.getElementById('edit-project-description').value;
      const visibility = document.getElementById('edit-project-visibility')?.value || 'private';
      const sharedEl = document.getElementById('edit-project-shared-users');
      const shared_user_ids = sharedEl ? Array.from(sharedEl.selectedOptions).map(o => Number(o.value)) : [];

      const body = canChangeSharing
        ? { name, description, visibility, shared_user_ids }
        : { name, description };

      try {
        await apiRequest(`/projects/${projectId}`, {
          method: 'PUT',
          body
        });

        hideModal();
        loadProjects();
        const currentProjectDetailName = document.getElementById('project-detail-name');
        if (currentProjectDetailName && currentProjectDetailName.textContent === project.name) {
          viewProject(projectId);
        }

        alert('Project updated successfully');
      } catch (error) {
        alert('Error updating project: ' + error.message);
      }
    });

    const delBtn = document.getElementById('edit-project-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return;
        try {
          await apiRequest(`/projects/${projectId}`, { method: 'DELETE' });
          hideModal();
          showView('projects');
          loadProjects();
          alert('Project deleted successfully');
        } catch (error) {
          alert('Error deleting project: ' + error.message);
        }
      });
    }
  } catch (error) {
    alert('Error loading project: ' + error.message);
  }
};

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Matches server canAccessProject: admin, public, owner, or shared member. */
function currentUserCanAccessProject(project) {
  if (!window.currentUser || !project) return false;
  const u = window.currentUser;
  if (u.is_admin) return true;
  const oid = project.owner && project.owner.id;
  if (oid === u.id) return true;
  const vis = project.visibility || 'private';
  if (vis === 'public') return true;
  if (vis === 'shared') {
    const members = project.shared_users || project.members || [];
    return members.some((m) => m.id === u.id);
  }
  return false;
}

function normalizeTicketUrlsFromTest(t) {
  if (!t) return [];
  if (Array.isArray(t.ticket_urls) && t.ticket_urls.length) {
    return t.ticket_urls.map((u) => String(u).trim()).filter(Boolean);
  }
  if (t.ticket_url && String(t.ticket_url).trim()) return [String(t.ticket_url).trim()];
  return [];
}

function ticketUrlsTextareaValue(t) {
  return normalizeTicketUrlsFromTest(t).join('\n');
}

function parseTicketUrlsTextarea(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// View Project
window.viewProject = async (projectId) => {
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    
    document.getElementById('project-detail-name').textContent = project.name;
    document.getElementById('project-detail-description').textContent = project.description || 'No description';

    const proxyEl = document.getElementById('project-detail-proxy');
    if (proxyEl) {
      proxyEl.textContent = 'Proxy: Inferred from URL per run';
    }

    // Load project-level coverage summary and chart
    if (typeof window.loadProjectCoverageSummary === 'function') {
      window.loadProjectCoverageSummary(projectId);
    }

    const editBtn = document.getElementById('project-detail-edit-btn');
    if (editBtn) {
      editBtn.style.display = 'none';
      editBtn.removeAttribute('data-project-id');
      editBtn.onclick = null;
    }

    const canAccess = currentUserCanAccessProject(project);
    if (editBtn && canAccess) {
      editBtn.style.display = 'inline-flex';
      editBtn.setAttribute('data-project-id', projectId);
      editBtn.onclick = () => editProject(projectId);
    }

    // Store project ID for later use
    document.getElementById('add-api-spec-btn').setAttribute('data-project-id', projectId);
    document.getElementById('upload-postman-collection-btn').setAttribute('data-project-id', projectId);
    document.getElementById('run-tests-btn').setAttribute('data-project-id', projectId);
    const runUiTestBtn = document.getElementById('run-ui-test-btn');
    const runFuzzBtn = document.getElementById('run-fuzz-btn');
    const manageProjectRecordedBtn = document.getElementById('manage-project-recorded-tests-btn');
    if (runUiTestBtn) runUiTestBtn.setAttribute('data-project-id', projectId);
    if (runFuzzBtn) runFuzzBtn.setAttribute('data-project-id', projectId);
    if (manageProjectRecordedBtn) manageProjectRecordedBtn.setAttribute('data-project-id', projectId);
    document.getElementById('run-soap-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('create-flow-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('create-schedule-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('sync-project-tests-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('clear-project-tests-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('export-project-tests-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('add-project-test-btn')?.setAttribute('data-project-id', projectId);
    document.getElementById('upload-project-tests-btn')?.setAttribute('data-project-id', projectId);
    const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
    document.getElementById('project-tests-run-selected-btn')?.setAttribute('data-project-id', projectId);
    if (editModeBtn) {
      editModeBtn.setAttribute('data-project-id', projectId);
      // Ensure buttons reflect current edit mode on view load
      const syncBtn = document.getElementById('sync-project-tests-btn');
      const clearBtn = document.getElementById('clear-project-tests-btn');
      const addBtn = document.getElementById('add-project-test-btn');
      const uploadTestsBtn = document.getElementById('upload-project-tests-btn');
      const displayStyle = window.projectTestsEditMode ? 'inline-flex' : 'none';
      if (syncBtn) syncBtn.style.display = displayStyle;
      if (clearBtn) clearBtn.style.display = displayStyle;
      if (addBtn) addBtn.style.display = displayStyle;
      if (uploadTestsBtn) uploadTestsBtn.style.display = displayStyle;
      editModeBtn.textContent = window.projectTestsEditMode ? 'Done editing' : 'Edit mode';
    }

    // Switch view immediately so navigation is not blocked by slower follow-up requests (flows, collections, catalogue).
    showView('project-detail');

    // Load flows for project
    const flowsList = document.getElementById('project-flows-list');
    if (flowsList) {
      try {
        const flows = await apiRequest(`/projects/${projectId}/flows`);
        if (flows.length === 0) {
          flowsList.innerHTML = `
            <div class="empty-state">
              <p>No flows yet. Create a flow to run a sequence of API and UI tests.</p>
            </div>
          `;
        } else {
          flowsList.innerHTML = flows.map(f => `
            <div class="list-item">
              <div class="list-item-info">
                <h3>${f.name}</h3>
                <p>${f.description || 'No description'}</p>
              </div>
              <div class="list-item-actions">
                <button class="btn btn-primary" onclick="runFlow(${f.id}, '${(f.name || '').replace(/'/g, "\\'")}')">Run flow</button>
                <button class="btn btn-secondary" onclick="editFlow(${f.id}, ${projectId})">Edit</button>
                <button class="btn btn-danger" onclick="deleteFlow(${f.id}, ${projectId})">Delete</button>
              </div>
            </div>
          `).join('');
        }
      } catch (e) {
        flowsList.innerHTML = '<div class="empty-state"><p>Failed to load flows.</p></div>';
      }
    }

    // Load schedules for project
    const schedulesList = document.getElementById('project-schedules-list');
    if (schedulesList) {
      try {
        const schedules = await apiRequest(`/projects/${projectId}/schedules`);
        if (schedules.length === 0) {
          schedulesList.innerHTML = `
            <div class="empty-state">
              <p>No schedules yet. Create a schedule to run tests automatically (cron or repeat interval).</p>
            </div>
          `;
        } else {
          schedulesList.innerHTML = schedules.map(s => {
            const target = s.flow ? `Flow: ${s.flow.name}` : 'Whole project';
            const when = s.cron_expression ? `Cron: ${s.cron_expression}` : `Every ${s.repeat_interval_minutes} min`;
            const next = s.next_run_at ? new Date(s.next_run_at).toLocaleString() : '–';
            return `<div class="list-item">
              <div class="list-item-info">
                <h3>${target}</h3>
                <p>${when} • Next: ${next} • ${s.enabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div class="list-item-actions">
                <button class="btn btn-primary" onclick="triggerSchedule(${s.id})">Run now</button>
                <button class="btn btn-secondary" onclick="editSchedule(${s.id}, ${projectId})">Edit</button>
                <button class="btn btn-danger" onclick="deleteSchedule(${s.id}, ${projectId})">Delete</button>
              </div>
            </div>`;
          }).join('');
        }
      } catch (e) {
        schedulesList.innerHTML = '<div class="empty-state"><p>Failed to load schedules.</p></div>';
      }
    }

    // Load API specs in project
    const apiSpecsList = document.getElementById('project-api-specs-list');
    if (project.apiSpecs && project.apiSpecs.length > 0) {
      apiSpecsList.innerHTML = project.apiSpecs.map(spec => `
        <div class="list-item">
          <div class="list-item-info">
            <h3>${spec.name}</h3>
            <p>Format: ${spec.format.toUpperCase()}</p>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-danger" onclick="removeApiSpecFromProject(${projectId}, ${spec.id})">Remove</button>
          </div>
        </div>
      `).join('');
    } else {
      apiSpecsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>No API specs in this project</p>
        </div>
      `;
    }
    
    // Load collections for project
    const collections = await apiRequest(`/projects/${projectId}/collections`);
    const collectionsList = document.getElementById('project-collections-list');
    
    if (collections.length === 0) {
      collectionsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <p>No collections available</p>
        </div>
      `;
    } else {
      collectionsList.innerHTML = collections.map(collection => {
        const itemCount = collection.collection_json?.item?.length || 0;
        return `
          <div class="list-item">
            <div class="list-item-info">
              <h3>
                <button
                  type="button"
                  class="link-button"
                  onclick="window.viewCollectionContents(${collection.id}, ${projectId})"
                  title="View collection content"
                >
                  ${collection.name}
                </button>
              </h3>
              <p>${itemCount} item(s)</p>
            </div>
            <div class="list-item-actions">
              <button class="btn btn-secondary" onclick="window.downloadCollectionJson(${collection.id}, ${projectId}, '${String(collection.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="Download collection">Download</button>
              <button class="btn btn-danger" onclick="deleteCollection(${collection.id}, ${projectId})" title="Delete collection">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Load tests & coverage for project
    await loadProjectTests(projectId);
  } catch (error) {
    console.error('Error loading project:', error);
    alert('Error loading project: ' + error.message);
  }
};

window.projectTestsCollapsedFolders = window.projectTestsCollapsedFolders || {};
window.toggleProjectTestsFolderGroup = (projectId, folderKey) => {
  const key = `${projectId}::${folderKey || ''}`;
  const next = !window.projectTestsCollapsedFolders[key];
  window.projectTestsCollapsedFolders[key] = next;
  renderProjectTestsTable(projectId);
};

// Project-level tests & coverage summary (dashboard strip + chart)
window.loadProjectCoverageSummary = async (projectId) => {
  const statsEl = document.getElementById('project-coverage-stats');
  const canvas = document.getElementById('project-coverage-chart-canvas');
  const chartContainer = (canvas && canvas.parentElement) || document.querySelector('.project-coverage-chart');
  if (!statsEl) return;

  // Clear existing UI
  statsEl.innerHTML = '';
  const ctx = canvas?.getContext ? canvas.getContext('2d') : null;
  if (ctx && window._projectCoverageChart) {
    try {
      window._projectCoverageChart.destroy();
    } catch (e) {
      // ignore
    }
    window._projectCoverageChart = null;
  }

  let data;
  try {
    data = await apiRequest(`/projects/${projectId}/tests/coverage-summary`);
  } catch (error) {
    statsEl.innerHTML = '<div class="empty-state"><p>Failed to load coverage summary.</p></div>';
    return;
  }

  if (!data || !data.summary) {
    statsEl.innerHTML = '<div class="empty-state"><p>No tests catalogue data yet. Sync from specs to get started.</p></div>';
    return;
  }

  const summary = data.summary;
  const last = summary.last_status_counts || {};
  const totalTests = summary.total_tests || 0;
  const testsEverRun = summary.tests_ever_run || 0;
  const passed = last.passed || 0;
  const failed = last.failed || 0;
  const partial = last.partial_failed || 0;
  const notRun = last.not_run || 0;
  const other = last.other || 0;
  const coveredNow = passed + failed + partial;
  const coveragePct = totalTests > 0 ? Math.round((coveredNow / totalTests) * 100) : 0;
  const successPct = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;
  const folderRows = Array.isArray(data.folders) ? data.folders : [];

  // Cache latest summary on window for report downloads
  window.currentProjectCoverageSummary = {
    summary,
    last_status_counts: last,
    computed: {
      totalTests,
      testsEverRun,
      passed,
      failed,
      partial,
      notRun,
      other,
      coveredNow,
      coveragePct,
      successPct,
      folders: folderRows
    }
  };

  const foldersCoverageHtml = folderRows.length
    ? `
      <div class="table-responsive project-folder-coverage-table-wrap">
        <table class="table project-folder-coverage-table">
          <thead>
            <tr>
              <th>Folder</th>
              <th>Active tests</th>
              <th>Covered</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Partial failed</th>
              <th>Not run</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            ${folderRows.map((f) => {
              const counts = f.last_status_counts || {};
              const coverage = Number(f.coverage_pct || 0);
              return `
                <tr>
                  <td>${escapeHtml(f.folder_path || 'No folder')}</td>
                  <td>${Number(f.total_tests || 0)}</td>
                  <td>${Number(f.covered_tests || 0)}</td>
                  <td><span class="folder-metric-badge metric-passed">${Number(counts.passed || 0)}</span></td>
                  <td><span class="folder-metric-badge metric-failed">${Number(counts.failed || 0)}</span></td>
                  <td><span class="folder-metric-badge metric-partial">${Number(counts.partial_failed || 0)}</span></td>
                  <td><span class="folder-metric-badge metric-notrun">${Number(counts.not_run || 0)}</span></td>
                  <td>
                    <div class="folder-coverage-meter">
                      <div class="folder-coverage-meter-fill" style="width:${coverage}%"></div>
                    </div>
                    <span class="folder-coverage-meter-label">${coverage}%</span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `
    : '<p class="muted project-folder-coverage-empty">No folder breakdown available yet.</p>';

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Active tests in coverage</div>
      <div class="stat-value">${totalTests}</div>
      <div class="stat-subtext">${testsEverRun} tests have been run at least once</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total tests passed</div>
      <div class="stat-value stat-value-success">${passed}</div>
      <div class="stat-subtext">${successPct}% of active tests</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total tests failed</div>
      <div class="stat-value" style="color:#dc2626;">${failed + partial}</div>
      <div class="stat-subtext">${coveragePct}% coverage (passed / failed / partial)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Not yet run</div>
      <div class="stat-value">${notRun}</div>
      <div class="stat-subtext">Active tests with no successful or failed runs yet</div>
    </div>
    <div class="project-folder-coverage-section">
      <h4 class="project-folder-coverage-title">Coverage by folder</h4>
      ${foldersCoverageHtml}
    </div>
  `;

  // When no active tests (e.g. after Clear tests), clear chart and show message so it doesn't show old run data
  if (totalTests === 0) {
    if (chartContainer) {
      chartContainer.innerHTML = '<p class="muted empty-state" style="margin:0; padding: 1rem;">No active tests. Add or sync tests to see coverage.</p>';
    }
    return;
  }

  // Ensure canvas exists (may have been replaced when there were 0 tests)
  if (!document.getElementById('project-coverage-chart-canvas') && chartContainer) {
    chartContainer.innerHTML = '<canvas id="project-coverage-chart-canvas" height="120"></canvas>';
  }
  const canvasForChart = document.getElementById('project-coverage-chart-canvas');
  const ctxForChart = canvasForChart?.getContext ? canvasForChart.getContext('2d') : null;
  if (!ctxForChart || typeof Chart === 'undefined') return;

  // Build chart: historical timeseries (Passed / Failed / Other) + "Current" bar from active list (all statuses)
  const timeseries = Array.isArray(data.timeseries) ? data.timeseries : [];
  const labels = [...timeseries.map(p => p.day instanceof Date ? p.day.toISOString().slice(0, 10) : String(p.day).slice(0, 10)), 'Current'];
  const passedValues = [...timeseries.map(p => p.passed_tests || 0), passed];
  const failedValues = [...timeseries.map(p => p.failed_tests || 0), failed];
  const partialValues = [...timeseries.map(p => 0), partial];
  const notRunValues = [...timeseries.map(p => 0), notRun];
  const totalValues = [...timeseries.map(p => p.total_tests || 0), totalTests];
  const otherValues = totalValues.map((v, i) => Math.max(v - (passedValues[i] + failedValues[i] + partialValues[i] + notRunValues[i]), 0));

  window._projectCoverageChart = new Chart(ctxForChart, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Passed',
          data: passedValues,
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
          borderColor: 'rgba(22, 163, 74, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tests'
        },
        {
          label: 'Failed',
          data: failedValues,
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor: 'rgba(220, 38, 38, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tests'
        },
        {
          label: 'Partial failed',
          data: partialValues,
          backgroundColor: 'rgba(245, 158, 11, 0.8)',
          borderColor: 'rgba(217, 119, 6, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tests'
        },
        {
          label: 'Not run',
          data: notRunValues,
          backgroundColor: 'rgba(148, 163, 184, 0.7)',
          borderColor: 'rgba(100, 116, 139, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tests'
        },
        {
          label: 'Other',
          data: otherValues,
          backgroundColor: 'rgba(107, 114, 128, 0.8)',
          borderColor: 'rgba(75, 85, 99, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tests'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          title: { display: false },
          grid: { display: false }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: false },
          ticks: { precision: 0 }
        }
      },
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function (context) {
              return `${context.dataset.label}: ${context.parsed.y} tests`;
            }
          }
        }
      }
    }
  });
};

function getEffectiveFolderPath(test) {
  if (!test) return '';
  return test.effective_folder_path || test.folder_path_override || test.default_folder_path || '';
}

/** @returns {'api'|'ui_recorded'|null} */
function getCatalogueTestRunKind(t) {
  if (!t) return null;
  if (t.single_run_kind === 'api' || t.single_run_kind === 'ui_recorded') return t.single_run_kind;
  if (t.test_type === 'api' && t.source_kind === 'postman_item' && t.source_id && (t.source_path || t.effective_source_path)) {
    return 'api';
  }
  if (t.test_type === 'ui_recorded' && t.source_kind === 'ui_recorded' && t.source_id) return 'ui_recorded';
  return null;
}
window.getCatalogueTestRunKind = getCatalogueTestRunKind;

function updateProjectTestsFolderFilterOptions(tests) {
  const folderEl = document.getElementById('project-tests-folder-filter');
  if (!folderEl) return;
  const current = folderEl.value || '';
  const folders = Array.from(new Set((tests || [])
    .map((t) => getEffectiveFolderPath(t))
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  folderEl.innerHTML = `<option value="">All Folders</option>${folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}`;
  folderEl.value = folders.includes(current) ? current : '';
}

function getProjectTestsFilters() {
  const searchEl = document.getElementById('project-tests-search');
  const typeEl = document.getElementById('project-tests-type-filter');
  const folderEl = document.getElementById('project-tests-folder-filter');
  const statusEl = document.getElementById('project-tests-status-filter');
  return {
    search: (searchEl?.value || '').trim().toLowerCase(),
    type: typeEl?.value || '',
    folder: folderEl?.value || '',
    statuses: statusEl
      ? Array.from(statusEl.selectedOptions || []).map(o => o.value).filter(Boolean)
      : []
  };
}

function applyProjectTestsFilters(tests, inEditMode) {
  if (!Array.isArray(tests)) return [];
  const { search, type, folder, statuses } = getProjectTestsFilters();

  let result = tests.slice();

  // In non-edit mode, only show active tests
  if (!inEditMode) {
    result = result.filter(t => t.is_active);
  }

  if (search) {
    result = result.filter(t => {
      const name = (t.name || '').toLowerCase();
      const ticket = normalizeTicketUrlsFromTest(t).join(' ').toLowerCase();
      const folderPath = getEffectiveFolderPath(t).toLowerCase();
      return name.includes(search) || ticket.includes(search) || folderPath.includes(search);
    });
  }

  if (type) {
    result = result.filter(t => t.test_type === type);
  }

  if (folder) {
    result = result.filter(t => getEffectiveFolderPath(t) === folder);
  }

  if (statuses && statuses.length > 0) {
    result = result.filter(t => {
      const stats = t.stats || {};
      const lastStatus = stats.last_status || 'not_run';
      return statuses.includes(lastStatus);
    });
  }

  return result;
}

function renderProjectTestsTable(projectId) {
  const tableEl = document.getElementById('project-tests-table');
  if (!tableEl) return;

  const allTests = window.currentProjectTests || [];
  const inEditMode = !!window.projectTestsEditMode;
  const tests = applyProjectTestsFilters(allTests, inEditMode);

  if (!tests || tests.length === 0) {
    tableEl.innerHTML = `
      <div class="empty-state">
        <p>No tests match the current filters. Adjust filters or click <strong>Sync from specs</strong> to load tests from API specs, SOAP operations, and UI tests.</p>
      </div>
    `;
    return;
  }

  const groupedRows = [];
  let lastFolderLabel = null;
  tests.forEach((t) => {
      const folderPath = getEffectiveFolderPath(t);
      const folderPathArg = (folderPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const folderLabel = folderPath || 'No folder';
      const folderKey = folderPath || '__NO_FOLDER__';
      const collapseKey = `${projectId}::${folderKey}`;
      const isCollapsed = !!window.projectTestsCollapsedFolders[collapseKey];
      if (folderLabel !== lastFolderLabel) {
        groupedRows.push(`
          <tr class="folder-group-row">
            <td colspan="${inEditMode ? '12' : '10'}">
              <button
                type="button"
                class="folder-group-toggle"
                onclick="window.toggleProjectTestsFolderGroup(${projectId}, '${folderPathArg}')"
                aria-expanded="${isCollapsed ? 'false' : 'true'}"
                title="${isCollapsed ? 'Expand folder' : 'Collapse folder'}"
              >
                <span class="folder-group-chevron">${isCollapsed ? '&#9656;' : '&#9662;'}</span>
                <svg class="folder-group-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                <span class="folder-group-label">Folder: ${escapeHtml(folderLabel)}</span>
              </button>
            </td>
          </tr>
        `);
        lastFolderLabel = folderLabel;
      }
      if (isCollapsed) {
        return;
      }
      const stats = t.stats || {};
      const lastStatus = stats.last_status || 'not_run';
      const hasStatusSet = lastStatus && lastStatus !== 'not_run';
      const lastRunAtRaw = stats.last_run_at || (hasStatusSet ? stats.updated_at : null);
      const lastRunAt = lastRunAtRaw ? formatDateTime(lastRunAtRaw) : '—';
      const totalRuns = stats.total_runs != null ? stats.total_runs : 0;
      const lastRunBy = stats.last_run_by_username ? escapeHtml(stats.last_run_by_username) : '—';
      const ticketUrls = normalizeTicketUrlsFromTest(t);
      const ticketDisplay = ticketUrls.length === 0
        ? '—'
        : ticketUrls.map((u) => `<a class="ticket-link" href="${escapeHtml(u)}" target="_blank" rel="noopener" title="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join('<span class="ticket-link-sep"> · </span>');
      const typeLabel =
        t.source_kind === 'manual' ? 'Manual Test' :
        t.test_type === 'soap' ? 'SOAP' :
        t.test_type === 'ui_builtin' ? 'UI (built-in)' :
        t.test_type === 'ui_recorded' ? 'UI (recorded)' :
        t.test_type === 'manual' ? 'Manual Test' :
        t.test_type === 'other' ? 'Other' :
        'API';
      const activeLabel = t.is_active ? 'Yes' : 'No';
      const statusClass =
        lastStatus === 'passed'
          ? 'passed'
          : lastStatus === 'failed'
            ? 'failed'
            : lastStatus === 'partial_failed'
              ? 'partial_failed'
              : lastStatus === 'running'
                ? 'running'
                : lastStatus === 'cancelled'
                  ? 'cancelled'
                  : 'pending';
      const activeCell = inEditMode
        ? `<button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick="window.toggleProjectTestActive(${projectId}, ${t.id}, ${t.is_active ? 'true' : 'false'})"
           >${activeLabel}</button>`
        : activeLabel;
      const deleteCell = inEditMode
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="window.deleteProjectTest(${projectId}, ${t.id})">Delete</button>`
        : '';
      const activeCol = inEditMode ? `<td>${activeCell}</td>` : '';
      const actionsCol = inEditMode ? `<td>${deleteCell}</td>` : '';
      const runKind = getCatalogueTestRunKind(t);
      const lastRunId = stats.last_run_id;
      const lastRunType = stats.last_run_type || stats.last_run_source || '';
      const historyTitle = lastRunId ? 'Open last test run' : 'No run yet';
      const historyBtn = lastRunId
        ? `<button type="button" class="btn btn-outline btn-sm" onclick='window.openLastRunForTest(${lastRunId}, ${JSON.stringify(String(lastRunType))})' title="${historyTitle}">History</button>`
        : `<button type="button" class="btn btn-outline btn-sm" disabled title="${historyTitle}">History</button>`;
      const runBtn = runKind
        ? `<button type="button" class="btn btn-outline btn-sm" onclick="window.runProjectCatalogueTest(${projectId}, ${t.id}, '${runKind}')" title="Run this test only">Run</button>`
        : `<span class="project-test-actions-placeholder muted" title="Run is only available for tests synced from API collections (Sync from specs) or linked UI recordings—not for manual-only catalogue rows.">—</span>`;
      const runHistoryCell = `<td class="project-test-actions-cell"><div class="project-test-row-actions">${runBtn} ${historyBtn}</div></td>`;
      const checkCell = `<td class="project-test-col-check"><input type="checkbox" class="project-test-row-check" data-project-test-id="${t.id}" aria-label="Select row" /></td>`;
      const nameCell = `<button type="button" class="link-button" onclick="window.viewProjectTestDetails(${projectId}, ${t.id})">${escapeHtml(t.name || '')}</button>`;
      const folderOrigin = t.folder_path_override
        ? '<span class="muted" title="User override"> (override)</span>'
        : (t.default_folder_path ? '<span class="muted" title="From source"> (source)</span>' : '');
      const folderCell = folderPath
        ? `<span title="${escapeHtml(folderPath)}">${escapeHtml(folderPath)}</span>${folderOrigin}`
        : '<span class="muted">—</span>';
      groupedRows.push(`
        <tr data-project-test-id="${t.id}">
          ${checkCell}
          <td>${nameCell}</td>
          <td>${folderCell}</td>
          <td>${typeLabel}</td>
          <td><span class="status-badge ${statusClass}">${lastStatus}</span></td>
          <td>${lastRunAt}</td>
          <td>${totalRuns}</td>
          <td>${lastRunBy}</td>
          <td>${ticketDisplay}</td>
          ${runHistoryCell}
          ${activeCol}
          ${actionsCol}
        </tr>
      `);
    });

  tableEl.innerHTML = `
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th class="project-test-col-check"><input type="checkbox" id="project-tests-select-all" title="Select all visible tests" aria-label="Select all visible tests" /></th>
              <th>Name</th>
              <th>Folder</th>
              <th>Type</th>
              <th>Last status</th>
              <th>Last run</th>
              <th>Total runs</th>
              <th>Last run by</th>
              <th>Tickets</th>
              <th>Actions</th>
              ${inEditMode ? '<th>Active</th><th>Delete</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${groupedRows.join('')}
          </tbody>
        </table>
      </div>
    `;
  const selectAll = document.getElementById('project-tests-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      document.querySelectorAll('#project-tests-table .project-test-row-check').forEach((cb) => {
        cb.checked = selectAll.checked;
      });
    });
  }
}

// Load project tests & coverage table
async function loadProjectTests(projectId) {
  const tableEl = document.getElementById('project-tests-table');
  if (!tableEl) return;
  try {
    tableEl.innerHTML = '<p class="muted">Loading tests…</p>';
    const tests = await apiRequest(`/projects/${projectId}/tests/catalogue`);
    window.currentProjectTests = Array.isArray(tests) ? tests : [];
    updateProjectTestsFolderFilterOptions(window.currentProjectTests);
    renderProjectTestsTable(projectId);
  } catch (err) {
    console.error('Error loading project tests:', err);
    tableEl.innerHTML = '<div class="empty-state"><p>Failed to load tests.</p></div>';
  }
}

window.runProjectCatalogueTest = (projectId, projectTestId, kind, testSnapshot) => {
  const test = testSnapshot || (window.currentProjectTests || []).find((x) => x.id === projectTestId);
  const defaultName = test ? `[Single] ${test.name || 'test'}` : '[Single] test';

  if (kind === 'api') {
    const envs = typeof window.getProjectSavedEnvironments === 'function'
      ? window.getProjectSavedEnvironments(projectId)
      : [];
    const options = envs.map((e) => `<option value="${escapeHtml(String(e.id))}">${escapeHtml(e.name || '')}</option>`).join('');
    const content = `
      <form id="single-test-run-form">
        <div class="form-group">
          <label for="single-test-env-select">Environment</label>
          <select id="single-test-env-select" class="form-control" style="width:100%;">
            <option value="">None (collection defaults only)</option>
            ${options}
          </select>
          <p class="muted form-help" style="margin-top:8px;">Uses the same saved environments as <strong>Run API Tests</strong> (stored in this browser).</p>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run</button>
        </div>
      </form>
    `;
    showModal('Run API test', content);
    document.getElementById('single-test-run-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const envId = document.getElementById('single-test-env-select').value;
      let envVars = {};
      if (typeof window.mergeSavedEnvironmentIntoEnvVars === 'function') {
        envVars = window.mergeSavedEnvironmentIntoEnvVars(projectId, envId, {});
      }
      hideModal();
      try {
        const body = { name: defaultName };
        if (Object.keys(envVars).length > 0) body.envVars = envVars;
        await apiRequest(`/projects/${projectId}/tests/${projectTestId}/run`, { method: 'POST', body });
        alert('Run started. Results appear in Test Runs; coverage updates when the run finishes.');
        await loadProjectTests(projectId);
        if (typeof window.loadProjectCoverageSummary === 'function') {
          window.loadProjectCoverageSummary(projectId);
        }
      } catch (err) {
        alert('Error: ' + (err.message || err));
      }
    });
    return;
  }

  if (kind === 'ui_recorded') {
    const urlVal = test && test.endpoint ? escapeHtml(test.endpoint) : '';
    const content = `
      <form id="single-ui-test-run-form">
        <div class="form-group">
          <label for="single-ui-base-url">Base URL (optional)</label>
          <input type="url" id="single-ui-base-url" class="form-control" placeholder="https://…" value="${urlVal}">
          <p class="muted form-help" style="margin-top:8px;">Leave empty to use the URL from the recorded test or project defaults.</p>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run</button>
        </div>
      </form>
    `;
    showModal('Run UI test', content);
    document.getElementById('single-ui-test-run-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = document.getElementById('single-ui-base-url').value.trim();
      hideModal();
      try {
        const body = { name: defaultName };
        if (raw) body.baseUrl = raw;
        await apiRequest(`/projects/${projectId}/tests/${projectTestId}/run`, { method: 'POST', body });
        alert('Run started. Results appear in Test Runs; coverage updates when the run finishes.');
        await loadProjectTests(projectId);
        if (typeof window.loadProjectCoverageSummary === 'function') {
          window.loadProjectCoverageSummary(projectId);
        }
      } catch (err) {
        alert('Error: ' + (err.message || err));
      }
    });
  }
};

window.runProjectCatalogueTestFromGlobal = (projectId, projectTestId, kind, testSnapshot) => {
  window.runProjectCatalogueTest(projectId, projectTestId, kind, testSnapshot);
};

window.runBatchProjectCatalogueTests = async (projectId) => {
  const checked = document.querySelectorAll('#project-tests-table .project-test-row-check:checked');
  const ids = [...checked].map((cb) => parseInt(cb.getAttribute('data-project-test-id'), 10));
  if (ids.length === 0) {
    alert('Select at least one test using the checkboxes.');
    return;
  }
  const tests = (window.currentProjectTests || []).filter((t) => ids.includes(t.id));
  const runnable = tests.filter((t) => getCatalogueTestRunKind(t));
  if (runnable.length === 0) {
    alert('None of the selected rows can be run individually. Sync from specs for API tests or link UI recordings.');
    return;
  }
  const hasApi = runnable.some((t) => getCatalogueTestRunKind(t) === 'api');
  const hasUi = runnable.some((t) => getCatalogueTestRunKind(t) === 'ui_recorded');
  if (hasApi && hasUi) {
    alert('Run all selected cannot mix API and UI tests. Select only API rows or only UI (recorded) rows.');
    return;
  }
  if (hasApi) {
    const envs = typeof window.getProjectSavedEnvironments === 'function'
      ? window.getProjectSavedEnvironments(projectId)
      : [];
    const options = envs.map((e) => `<option value="${escapeHtml(String(e.id))}">${escapeHtml(e.name || '')}</option>`).join('');
    const content = `
      <form id="batch-test-run-form">
        <p class="muted" style="margin-bottom:12px;">${runnable.length} API test(s) will run with the same environment.</p>
        <div class="form-group">
          <label for="batch-test-env-select">Environment</label>
          <select id="batch-test-env-select" class="form-control" style="width:100%;">
            <option value="">None (collection defaults only)</option>
            ${options}
          </select>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run all</button>
        </div>
      </form>
    `;
    showModal('Run all selected API tests', content);
    document.getElementById('batch-test-run-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const envId = document.getElementById('batch-test-env-select').value;
      let envVars = {};
      if (typeof window.mergeSavedEnvironmentIntoEnvVars === 'function') {
        envVars = window.mergeSavedEnvironmentIntoEnvVars(projectId, envId, {});
      }
      hideModal();
      let started = 0;
      for (const t of runnable) {
        try {
          const body = { name: `[Batch] ${t.name || 'test'}` };
          if (Object.keys(envVars).length > 0) body.envVars = envVars;
          await apiRequest(`/projects/${projectId}/tests/${t.id}/run`, { method: 'POST', body });
          started++;
        } catch (err) {
          console.error(err);
        }
      }
      alert(`${started} run(s) queued. View Test Runs for progress.`);
      await loadProjectTests(projectId);
      if (typeof window.loadProjectCoverageSummary === 'function') {
        window.loadProjectCoverageSummary(projectId);
      }
    });
    return;
  }
  const content = `
    <form id="batch-ui-test-run-form">
      <p class="muted" style="margin-bottom:12px;">${runnable.length} UI test(s) will run sequentially.</p>
      <div class="form-group">
        <label for="batch-ui-base-url">Base URL (optional, applies to all if set)</label>
        <input type="url" id="batch-ui-base-url" class="form-control" placeholder="Leave empty to use each test’s URL">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Run all</button>
      </div>
    </form>
  `;
  showModal('Run all selected UI tests', content);
  document.getElementById('batch-ui-test-run-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = document.getElementById('batch-ui-base-url').value.trim();
    hideModal();
    let started = 0;
    for (const t of runnable) {
      try {
        const body = { name: `[Batch] ${t.name || 'test'}` };
        if (raw) body.baseUrl = raw;
        else if (t.endpoint && String(t.endpoint).trim()) body.baseUrl = String(t.endpoint).trim();
        await apiRequest(`/projects/${projectId}/tests/${t.id}/run`, { method: 'POST', body });
        started++;
      } catch (err) {
        console.error(err);
      }
    }
    alert(`${started} run(s) queued. View Test Runs for progress.`);
    await loadProjectTests(projectId);
    if (typeof window.loadProjectCoverageSummary === 'function') {
      window.loadProjectCoverageSummary(projectId);
    }
  });
};

// Download Tests & Coverage report (HTML file with interactive filtering, no edit)
window.downloadProjectTestsReport = () => {
  const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
  const projectId = editModeBtn?.getAttribute('data-project-id');
  if (!projectId) {
    alert('Please select a project first.');
    return;
  }

  const projectNameEl = document.getElementById('project-detail-name');
  const projectName = (projectNameEl?.textContent || '').trim() || `Project ${projectId}`;

  const inEditMode = !!window.projectTestsEditMode;
  const allTests = window.currentProjectTests || [];
  const filtered = applyProjectTestsFilters(allTests, inEditMode);
  const coverage = window.currentProjectCoverageSummary || null;

  const now = new Date();
  const iso = now.toISOString();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const { search, type, statuses } = getProjectTestsFilters();
  const statusFilterSelected = new Set(statuses || []);
  const reportStatusOptions = [
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'partial_failed', label: 'Partial Failed' },
    { value: 'running', label: 'Running' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'not_run', label: 'Not run' }
  ];
  const reportStatusMenuRowsHtml = reportStatusOptions.map(({ value, label }) => {
    const checked = statusFilterSelected.has(value) ? ' checked' : '';
    return `<label><input type="checkbox" value="${value}"${checked} /> ${label}</label>`;
  }).join('');
  const selectedStatusArr = Array.from(statusFilterSelected);
  const reportStatusLabelInitial =
    selectedStatusArr.length === 0
      ? 'All statuses'
      : selectedStatusArr.length === 1
        ? (reportStatusOptions.find((o) => o.value === selectedStatusArr[0]) || {}).label || '1 selected'
        : `${selectedStatusArr.length} selected`;

  const safeHtml = (str) => String(str || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const coverageSection = (() => {
    if (!coverage || !coverage.computed) return '<p>No coverage summary data.</p>';
    const c = coverage.computed;
    return `
      <div class="cards">
        <div class="card">
          <div class="card-label">Active tests in coverage</div>
          <div class="card-value">${c.totalTests}</div>
          <div class="card-subtext">${c.testsEverRun} tests have been run at least once</div>
        </div>
        <div class="card">
          <div class="card-label">Total tests passed</div>
          <div class="card-value success">${c.passed}</div>
          <div class="card-subtext">${c.successPct}% of active tests</div>
        </div>
        <div class="card">
          <div class="card-label">Total tests failed</div>
          <div class="card-value error">${c.failed + c.partial}</div>
          <div class="card-subtext">${c.coveragePct}% coverage (passed / failed / partial)</div>
        </div>
        <div class="card">
          <div class="card-label">Not yet run</div>
          <div class="card-value">${c.notRun}</div>
          <div class="card-subtext">Active tests with no successful or failed runs yet</div>
        </div>
      </div>
    `;
  })();

  const rowsHtml = filtered.map((t) => {
    const stats = t.stats || {};
    const lastStatus = stats.last_status || 'not_run';
    const hasStatusSet = lastStatus && lastStatus !== 'not_run';
    const lastRunAtRaw = stats.last_run_at || (hasStatusSet ? stats.updated_at : null);
    const lastRunAt = lastRunAtRaw ? formatDateTime(lastRunAtRaw) : '—';
    const totalRuns = stats.total_runs != null ? stats.total_runs : 0;
    const lastRunBy = stats.last_run_by_username || '—';
    const typeLabel =
      t.test_type === 'soap' ? 'SOAP' :
      t.test_type === 'ui_builtin' ? 'UI (built-in)' :
      t.test_type === 'ui_recorded' ? 'UI (recorded)' :
      t.test_type === 'manual' ? 'Manual Test' :
      t.test_type === 'other' ? 'Other' :
      'API';
    const ticket = normalizeTicketUrlsFromTest(t).join(' ');
    const folder = getEffectiveFolderPath(t) || '';
    const statusClass =
      lastStatus === 'passed' ? 'passed' :
      lastStatus === 'failed' ? 'failed' :
      lastStatus === 'partial_failed' ? 'partial_failed' :
      lastStatus === 'running' ? 'running' :
      lastStatus === 'cancelled' ? 'cancelled' : 'pending';
    const statusLabel = (lastStatus || 'not_run').toUpperCase().replace(/_/g, ' ');

    return `
      <tr
        data-name="${safeHtml(t.name || '')}"
        data-type="${safeHtml(t.test_type || '')}"
        data-status="${safeHtml(lastStatus)}"
        data-ticket="${safeHtml(ticket)}"
        data-folder="${safeHtml(folder)}"
      >
        <td>${safeHtml(t.name || '')}</td>
        <td>${safeHtml(folder || '—')}</td>
        <td>${safeHtml(typeLabel)}</td>
        <td><span class="status-badge ${statusClass}">${safeHtml(statusLabel)}</span></td>
        <td>${safeHtml(lastRunAt)}</td>
        <td>${safeHtml(String(totalRuns))}</td>
        <td>${safeHtml(lastRunBy)}</td>
        <td>${(() => {
          const urls = normalizeTicketUrlsFromTest(t);
          if (!urls.length) return '—';
          return urls.map((u) => `<a href="${safeHtml(u)}" target="_blank" rel="noopener">${safeHtml(u)}</a>`).join(' · ');
        })()}</td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tests &amp; Coverage report – ${safeHtml(projectName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --color-primary: #14b8a6;
      --color-primary-dark: #0d9488;
      --color-gray-50: #f9fafb;
      --color-gray-100: #f3f4f6;
      --color-gray-200: #e5e7eb;
      --color-gray-300: #d1d5db;
      --color-gray-500: #6b7280;
      --color-gray-700: #374151;
      --color-white: #ffffff;
      --color-text-inverse: #ffffff;
      --color-success: #10b981;
      --color-error: #ef4444;
      --color-warning: #f59e0b;
      --color-text-muted: #6b7280;
      --color-text-primary: #111827;
      --color-text-secondary: #6b7280;
      --color-text-tertiary: #9ca3af;
      --spacing-xs: 4px;
      --spacing-sm: 8px;
      --spacing-md: 12px;
      --spacing-xl: 24px;
      --radius-sm: 4px;
      --radius-md: 8px;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
      --shadow-md: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      --transition-base: 200ms ease-in-out;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      background: var(--color-gray-100);
      color: #111827;
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      background: var(--color-white);
      min-height: 100vh;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
    }
    .page-header {
      background: #00474F;
      color: #ffffff;
      padding: 20px 24px;
    }
    .page-header h1 {
      font-size: 22px;
      margin: 0 0 4px 0;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .page-header .meta {
      font-size: 13px;
      color: rgba(249,250,251,0.8);
    }
    .page-body {
      padding: 24px;
      background: var(--color-gray-100);
    }
    h2 {
      font-size: 18px;
      margin-top: 0;
      margin-bottom: 8px;
      color: #111827;
    }
    .section {
      background: var(--color-white);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      margin-bottom: 20px;
      border: 1px solid var(--color-gray-200);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }
    .card {
      background: var(--color-white);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--color-primary), #5eead4);
    }
    .card-label {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--color-gray-500);
      margin-bottom: 6px;
    }
    .card-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--color-primary);
    }
    .card-value.success {
      color: #10b981;
    }
    .card-value.error {
      color: #ef4444;
    }
    .card-subtext {
      font-size: 12px;
      color: var(--color-gray-500);
      margin-top: 4px;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
      margin-bottom: 12px;
    }
    .filters input[type="text"],
    .filters select {
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-md);
      border: 2px solid var(--color-primary);
      font-size: 14px;
      background: var(--color-white);
      color: var(--color-text-primary);
      transition: border-color var(--transition-base), box-shadow var(--transition-base);
    }
    .filters input[type="text"]:focus,
    .filters select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.25);
    }
    /* Same dropdown pattern as Tests & Coverage (multi-select) */
    .multi-select {
      position: relative;
      min-width: 220px;
    }
    .multi-select-trigger {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-md);
      border: 2px solid var(--color-primary);
      background: var(--color-white);
      color: var(--color-text-primary);
      cursor: pointer;
      font-size: 14px;
      font: inherit;
      transition: border-color var(--transition-base), box-shadow var(--transition-base), transform var(--transition-base);
    }
    .multi-select-trigger:hover {
      border-color: var(--color-primary-dark);
    }
    .multi-select-trigger:focus-visible {
      outline: none;
      box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.25);
    }
    .multi-select-label {
      font-weight: 600;
      color: var(--color-text-secondary);
    }
    .multi-select-value {
      flex: 1;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--color-text-primary);
    }
    .multi-select-caret {
      font-size: 10px;
      color: var(--color-text-tertiary);
    }
    .multi-select-menu {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      min-width: 100%;
      padding: var(--spacing-sm);
      background: var(--color-white);
      border-radius: var(--radius-md);
      border: 2px solid var(--color-gray-200);
      box-shadow: var(--shadow-lg);
      z-index: 40;
      display: none;
    }
    .multi-select-menu.open {
      display: block;
    }
    .multi-select-menu label {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-xs) var(--spacing-sm);
      font-size: 14px;
      cursor: pointer;
    }
    .multi-select-menu label:hover {
      background: var(--color-gray-100);
      border-radius: var(--radius-sm);
    }
    .multi-select-menu input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: var(--color-primary);
    }
    /* Match app .btn / .btn-primary / .btn-secondary (Tests & Coverage filters) */
    .filters .btn {
      padding: var(--spacing-sm) var(--spacing-xl);
      border-radius: var(--radius-md);
      border: none;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      line-height: 1.5;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-sm);
      transition: all var(--transition-base);
    }
    .filters .btn:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .filters .btn-primary {
      background: var(--color-primary);
      color: var(--color-text-inverse);
      box-shadow: var(--shadow-sm);
    }
    .filters .btn-primary:hover {
      background: var(--color-primary-dark);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
    .filters .btn-primary:active {
      transform: translateY(0);
      box-shadow: var(--shadow-sm);
    }
    .filters .btn-secondary {
      background: var(--color-gray-200);
      color: var(--color-text-primary);
    }
    .filters .btn-secondary:hover {
      background: var(--color-gray-300);
      transform: translateY(-1px);
    }
    .filters .btn-secondary:active {
      transform: translateY(0);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      background: var(--color-white);
      border-radius: 12px;
      overflow: hidden;
    }
    thead {
      background: var(--color-gray-50);
    }
    th,
    td {
      padding: 8px 10px;
      font-size: 13px;
      text-align: left;
      border-bottom: 1px solid var(--color-gray-200);
    }
    th {
      font-weight: 600;
      color: #4b5563;
    }
    tr:last-child td {
      border-bottom: none;
    }
    tbody tr:nth-child(even) {
      background: var(--color-gray-50);
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .count {
      font-size: 13px;
      color: var(--color-gray-500);
      margin-top: 4px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: var(--spacing-xs) var(--spacing-md);
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      box-shadow: var(--shadow-sm);
      white-space: nowrap;
    }
    #tests-table td:nth-child(3) {
      white-space: nowrap;
    }
    .status-badge.passed {
      background: var(--color-success);
      color: var(--color-text-inverse);
    }
    .status-badge.failed {
      background: var(--color-error);
      color: var(--color-text-inverse);
    }
    .status-badge.partial_failed {
      background: var(--color-warning);
      color: var(--color-text-inverse);
    }
    .status-badge.running {
      background: var(--color-warning);
      color: var(--color-text-inverse);
    }
    .status-badge.cancelled {
      background: #94a3b8;
      color: var(--color-text-inverse);
    }
    .status-badge.pending {
      background: var(--color-text-muted);
      color: var(--color-text-inverse);
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="page-header">
      <h1>Tests &amp; Coverage report</h1>
      <div class="meta">
        Project: <strong>${safeHtml(projectName)}</strong> (ID: ${safeHtml(projectId)})<br>
        Generated at: ${safeHtml(iso)}
      </div>
    </div>
    <div class="page-body">
      <div class="section">
        <h2>Coverage summary</h2>
        ${coverageSection}
      </div>

      <div class="section">
        <h2>Tests (filtered snapshot)</h2>
        <div class="filters">
          <input type="text" id="filter-search" placeholder="Search by name or ticket..." />
          <select id="filter-type">
            <option value="">All Types</option>
            <option value="api">API</option>
            <option value="soap">SOAP</option>
            <option value="ui_builtin">UI (built-in)</option>
            <option value="ui_recorded">UI (recorded)</option>
            <option value="manual">Manual Test</option>
            <option value="other">Other</option>
          </select>
          <div class="multi-select project-tests-status-multiselect" id="report-status-filter-wrap">
            <button type="button" class="multi-select-trigger" id="report-status-trigger" aria-haspopup="listbox" aria-expanded="false">
              <span class="multi-select-label">Last status</span>
              <span class="multi-select-value" id="report-status-label">${safeHtml(reportStatusLabelInitial)}</span>
              <span class="multi-select-caret" aria-hidden="true">&#9662;</span>
            </button>
            <div class="multi-select-menu" id="report-status-menu" role="listbox">
              ${reportStatusMenuRowsHtml}
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="filter-apply">Apply</button>
          <button type="button" class="btn btn-secondary" id="filter-clear">Clear</button>
        </div>
        <div class="count" id="filtered-count"></div>

        <table id="tests-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Folder</th>
              <th>Type</th>
              <th>Last status</th>
              <th>Last run</th>
              <th>Total runs</th>
              <th>Last run by</th>
              <th>Tickets</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    (function () {
      const searchInput = document.getElementById('filter-search');
      const typeSelect = document.getElementById('filter-type');
      const statusMenu = document.getElementById('report-status-menu');
      const statusTrigger = document.getElementById('report-status-trigger');
      const statusLabel = document.getElementById('report-status-label');
      const applyBtn = document.getElementById('filter-apply');
      const clearBtn = document.getElementById('filter-clear');
      const tbody = document.querySelector('#tests-table tbody');
      const countEl = document.getElementById('filtered-count');

      function selectedStatuses() {
        if (!statusMenu) return [];
        return Array.from(statusMenu.querySelectorAll('input[type="checkbox"]:checked')).map(function (cb) { return cb.value; });
      }

      function syncReportStatusLabel() {
        if (!statusMenu || !statusLabel) return;
        const boxes = Array.from(statusMenu.querySelectorAll('input[type="checkbox"]'));
        const selectedValues = boxes.filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
        if (selectedValues.length === 0) {
          statusLabel.textContent = 'All statuses';
        } else if (selectedValues.length === 1) {
          var one = boxes.find(function (cb) { return cb.checked; });
          statusLabel.textContent = one && one.parentElement ? one.parentElement.textContent.trim() : '1 selected';
        } else {
          statusLabel.textContent = selectedValues.length + ' selected';
        }
      }

      function applyFilters() {
        const search = (searchInput.value || '').toLowerCase();
        const type = typeSelect.value;
        const statuses = selectedStatuses();
        let visible = 0;

        Array.from(tbody.querySelectorAll('tr')).forEach((row) => {
          const name = (row.getAttribute('data-name') || '').toLowerCase();
          const ticket = (row.getAttribute('data-ticket') || '').toLowerCase();
          const rowType = row.getAttribute('data-type') || '';
          const rowStatus = row.getAttribute('data-status') || '';

          let ok = true;
          if (search) {
            ok = name.includes(search) || ticket.includes(search);
          }
          if (ok && type) {
            ok = rowType === type;
          }
          if (ok && statuses.length > 0) {
            ok = statuses.indexOf(rowStatus) !== -1;
          }

          row.style.display = ok ? '' : 'none';
          if (ok) visible++;
        });

        if (countEl) {
          countEl.textContent = visible + ' test' + (visible === 1 ? '' : 's') + ' shown in table';
        }
      }

      if (statusTrigger && statusMenu) {
        statusTrigger.addEventListener('click', function (e) {
          e.stopPropagation();
          var open = statusMenu.classList.toggle('open');
          statusTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        statusMenu.addEventListener('change', function () {
          syncReportStatusLabel();
        });
        document.addEventListener('click', function (e) {
          if (!statusMenu.classList.contains('open')) return;
          var t = e.target;
          if (t && statusMenu.contains(t)) return;
          if (t && statusTrigger.contains(t)) return;
          statusMenu.classList.remove('open');
          statusTrigger.setAttribute('aria-expanded', 'false');
        });
      }

      if (applyBtn) applyBtn.addEventListener('click', applyFilters);
      if (clearBtn) clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (typeSelect) typeSelect.value = '';
        if (statusMenu) {
          statusMenu.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
        }
        syncReportStatusLabel();
        if (statusMenu) statusMenu.classList.remove('open');
        if (statusTrigger) statusTrigger.setAttribute('aria-expanded', 'false');
        applyFilters();
      });

      syncReportStatusLabel();
      applyFilters();
    })();
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeProjectSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `project-${projectId}`;
  a.download = `${safeProjectSlug}-tests-coverage-report-${datePart}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Manually add a project test in edit mode
window.addProjectTest = (projectId) => {
  const content = `
    <form id="add-project-test-form">
      <div class="form-group">
        <label for="add-project-test-name">Name <span class="required">*</span></label>
        <input type="text" id="add-project-test-name" required>
      </div>
      <div class="form-group">
        <label for="add-project-test-type">Type</label>
        <select id="add-project-test-type">
          <option value="api">API</option>
          <option value="soap">SOAP</option>
          <option value="ui_recorded">UI (recorded)</option>
          <option value="manual">Manual Test</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-group">
        <label for="add-project-test-method">Method</label>
        <input type="text" id="add-project-test-method" placeholder="GET, POST, UI, SOAP...">
      </div>
      <div class="form-group">
        <label for="add-project-test-endpoint">Endpoint / Target</label>
        <input type="text" id="add-project-test-endpoint" placeholder="/path or URL (optional)">
      </div>
      <div class="form-group">
        <label for="add-project-test-description">Description</label>
        <textarea id="add-project-test-description" placeholder="Optional"></textarea>
      </div>
      <div class="form-group">
        <label for="add-project-test-ticket-urls">Ticket URLs</label>
        <textarea id="add-project-test-ticket-urls" rows="4" placeholder="https://jira.example.com/browse/KEY-123&#10;https://jira.example.com/browse/KEY-456"></textarea>
        <p class="muted form-help" style="margin-top:6px;">One URL per line (e.g. Jira issues linked to this test).</p>
      </div>
      <div class="form-group">
        <label for="add-project-test-folder-path">Folder path</label>
        <input type="text" id="add-project-test-folder-path" placeholder="Release/Smoke">
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="add-project-test-active" checked>
          Active in coverage
        </label>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create</button>
      </div>
    </form>
  `;

  showModal('Add test', content);
  document.getElementById('add-project-test-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('add-project-test-name').value.trim();
    if (!name) {
      alert('Name is required.');
      return;
    }
    const test_type = document.getElementById('add-project-test-type').value || 'api';
    const method = document.getElementById('add-project-test-method').value.trim();
    const endpoint = document.getElementById('add-project-test-endpoint').value.trim();
    const description = document.getElementById('add-project-test-description').value;
    const ticket_urls = parseTicketUrlsTextarea(document.getElementById('add-project-test-ticket-urls').value);
    const folder_path_override = document.getElementById('add-project-test-folder-path').value.trim();
    const is_active = document.getElementById('add-project-test-active').checked;
    try {
      await apiRequest(`/projects/${projectId}/tests`, {
        method: 'POST',
        body: { name, test_type, method, endpoint, description, is_active, ticket_urls, folder_path_override }
      });
      hideModal();
      await loadProjectTests(projectId);
      if (typeof window.loadProjectCoverageSummary === 'function') {
        window.loadProjectCoverageSummary(projectId);
      }
    } catch (err) {
      alert('Error creating test: ' + (err.message || err));
    }
  });
};

// Upload project tests from CSV file (edit mode)
window.showUploadProjectTestsModal = (projectId) => {
  const content = `
    <form id="upload-project-tests-form">
      <div class="form-group">
        <p style="margin-bottom: 12px;">
          <button type="button" class="btn btn-secondary btn-sm" id="download-project-tests-template-btn">
            Download template
          </button>
          <span class="muted" style="margin-left: 8px;">Use the template to see the expected columns and format.</span>
        </p>
        <label>Upload CSV file</label>
        <div class="file-upload-area" id="project-tests-file-upload-area">
          <p id="project-tests-upload-prompt">Click to select or drag and drop</p>
          <p class="file-upload-hint">Semicolon-delimited CSV (`;`) with columns: Name, Type, Method, Endpoint, Description, Ticket URLs (use | between multiple URLs), Folder path, Active</p>
          <input type="file" id="project-tests-file" accept=".csv" style="display: none;">
        </div>
        <div id="project-tests-selected-file-card" class="selected-file-card" style="display: none;">
          <div class="selected-file-card-inner">
            <svg class="selected-file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div class="selected-file-info">
              <span class="selected-file-label">File included</span>
              <span id="project-tests-selected-file-name" class="selected-file-name"></span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm selected-file-change" id="project-tests-change-file-btn">Change file</button>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Upload</button>
      </div>
    </form>
  `;

  showModal('Upload tests from file', content);

  document.getElementById('download-project-tests-template-btn')?.addEventListener('click', () => {
    window.location.href = `/api/projects/${projectId}/tests/catalogue/template`;
  });

  const fileInput = document.getElementById('project-tests-file');
  const fileUploadArea = document.getElementById('project-tests-file-upload-area');
  const selectedCard = document.getElementById('project-tests-selected-file-card');
  const selectedFileName = document.getElementById('project-tests-selected-file-name');
  const uploadPrompt = document.getElementById('project-tests-upload-prompt');

  function updateFileDisplay() {
    const hasFile = fileInput.files && fileInput.files.length > 0;
    if (hasFile) {
      selectedFileName.textContent = fileInput.files[0].name;
      selectedCard.style.display = 'block';
      uploadPrompt.textContent = 'Drop a different file or click to replace';
      fileUploadArea.classList.add('has-file');
    } else {
      selectedCard.style.display = 'none';
      uploadPrompt.textContent = 'Click to select or drag and drop';
      fileUploadArea.classList.remove('has-file');
    }
  }

  fileUploadArea.addEventListener('click', (e) => {
    if (!e.target.closest('#project-tests-change-file-btn')) fileInput.click();
  });

  document.getElementById('project-tests-change-file-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value = '';
    updateFileDisplay();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) updateFileDisplay();
  });

  fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('dragover');
  });
  fileUploadArea.addEventListener('dragleave', () => {
    fileUploadArea.classList.remove('dragover');
  });
  fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      updateFileDisplay();
    }
  });

  document.getElementById('upload-project-tests-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select a CSV file');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const response = await fetch(`/api/projects/${projectId}/tests/import`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      let message = `${data.created} test(s) created.`;
      if (data.errors && data.errors.length > 0) {
        message += ` ${data.errors.length} row(s) had errors: ${data.errors.map((x) => `row ${x.row}: ${x.message}`).join('; ')}`;
      }
      hideModal();
      alert(message);
      await loadProjectTests(projectId);
      if (typeof window.loadProjectCoverageSummary === 'function') {
        window.loadProjectCoverageSummary(projectId);
      }
    } catch (err) {
      alert('Error uploading file: ' + (err.message || err));
    }
  });
};

// Toggle active flag directly from the table
window.toggleProjectTestActive = async (projectId, projectTestId, isActive) => {
  const newValue = !isActive;
  try {
    await apiRequest(`/projects/${projectId}/tests/${projectTestId}`, {
      method: 'PATCH',
      body: { is_active: newValue }
    });
    await loadProjectTests(projectId);
    if (typeof window.loadProjectCoverageSummary === 'function') {
      window.loadProjectCoverageSummary(projectId);
    }
  } catch (err) {
    alert('Error updating test active flag: ' + (err.message || err));
  }
};

// Delete a single project test (with confirmation)
window.deleteProjectTest = async (projectId, projectTestId) => {
  if (!confirm('Delete this test from the Tests & Coverage list? This does not delete historical runs, only the catalogue entry.')) {
    return;
  }
  try {
    await apiRequest(`/projects/${projectId}/tests/${projectTestId}`, {
      method: 'DELETE'
    });
    await loadProjectTests(projectId);
    if (typeof window.loadProjectCoverageSummary === 'function') {
      window.loadProjectCoverageSummary(projectId);
    }
  } catch (err) {
    alert('Error deleting test: ' + (err.message || err));
  }
};

// Edit a single project test (name, description, active)
window.editProjectTest = async (projectId, projectTestId) => {
  try {
    const tests = await apiRequest(`/projects/${projectId}/tests/catalogue`);
    const test = (tests || []).find(t => t.id === projectTestId);
    if (!test) {
      alert('Test not found.');
      return;
    }
    const content = `
      <form id="edit-project-test-form">
        <div class="form-group">
          <label for="edit-project-test-name">Name</label>
          <input type="text" id="edit-project-test-name" value="${escapeHtml(test.name || '')}">
        </div>
        <div class="form-group">
          <label for="edit-project-test-type">Type</label>
          <select id="edit-project-test-type">
            <option value="api" ${test.test_type === 'api' ? 'selected' : ''}>API</option>
            <option value="soap" ${test.test_type === 'soap' ? 'selected' : ''}>SOAP</option>
            <option value="ui_recorded" ${test.test_type === 'ui_recorded' ? 'selected' : ''}>UI (recorded)</option>
            <option value="manual" ${test.test_type === 'manual' ? 'selected' : ''}>Manual Test</option>
            <option value="other" ${test.test_type && !['api','soap','ui_recorded','manual'].includes(test.test_type) ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label for="edit-project-test-method">Method</label>
          <input type="text" id="edit-project-test-method" value="${escapeHtml(test.method || '')}" placeholder="GET, POST, UI, SOAP...">
        </div>
        <div class="form-group">
          <label for="edit-project-test-endpoint">Endpoint / Target</label>
          <input type="text" id="edit-project-test-endpoint" value="${escapeHtml(test.endpoint || '')}" placeholder="/path or URL (optional)">
        </div>
        <div class="form-group">
          <label for="edit-project-test-description">Description</label>
          <textarea id="edit-project-test-description" placeholder="Optional">${escapeHtml(test.description || '')}</textarea>
        </div>
      <div class="form-group">
        <label for="edit-project-test-ticket-urls">Ticket URLs</label>
        <textarea id="edit-project-test-ticket-urls" rows="4" placeholder="https://jira.example.com/browse/KEY-123">${escapeHtml(ticketUrlsTextareaValue(test))}</textarea>
        <p class="muted form-help" style="margin-top:6px;">One URL per line.</p>
      </div>
        <div class="form-group">
          <label for="edit-project-test-folder-path">Folder path override</label>
          <input type="text" id="edit-project-test-folder-path" value="${escapeHtml(test.folder_path_override || '')}" placeholder="Release/Smoke">
          <small class="form-help">Source folder: ${escapeHtml(test.default_folder_path || '—')}</small>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="edit-project-test-active" ${test.is_active ? 'checked' : ''}>
            Active in coverage
          </label>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `;
    showModal('Edit test', content);
    document.getElementById('edit-project-test-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-project-test-name').value.trim();
      const test_type = document.getElementById('edit-project-test-type').value || test.test_type || 'api';
      const method = document.getElementById('edit-project-test-method').value.trim();
      const endpoint = document.getElementById('edit-project-test-endpoint').value.trim();
      const description = document.getElementById('edit-project-test-description').value;
      const ticket_urls = parseTicketUrlsTextarea(document.getElementById('edit-project-test-ticket-urls').value);
      const folder_path_override = document.getElementById('edit-project-test-folder-path').value.trim();
      const is_active = document.getElementById('edit-project-test-active').checked;
      try {
        await apiRequest(`/projects/${projectId}/tests/${projectTestId}`, {
          method: 'PATCH',
          body: { name, description, is_active, method, endpoint, test_type, ticket_urls, folder_path_override }
        });
        hideModal();
        await loadProjectTests(projectId);
        if (typeof window.loadProjectCoverageSummary === 'function') {
          window.loadProjectCoverageSummary(projectId);
        }
      } catch (err2) {
        alert('Error saving test: ' + (err2.message || err2));
      }
    });
  } catch (err) {
    alert('Error loading test: ' + (err.message || err));
  }
};

// View and add notes for a project test (with editable fields and Save)
window.viewProjectTestDetails = async (projectId, projectTestId) => {
  try {
    const [tests, notes, users] = await Promise.all([
      apiRequest(`/projects/${projectId}/tests/catalogue`),
      apiRequest(`/projects/${projectId}/tests/${projectTestId}/notes`),
      apiRequest('/users')
    ]);
    const test = (tests || []).find(t => t.id === projectTestId);
    if (!test) {
      alert('Test not found.');
      return;
    }
    const listHtml = (notes || []).length
      ? notes.map(n => {
          const when = n.created_at ? formatDateTime(n.created_at) : '';
          return `<div class="note-item">
            <div class="note-meta">${when}</div>
            <div class="note-body">${escapeHtml(n.note || '')}</div>
          </div>`;
        }).join('')
      : '<p class="muted">No notes yet. Add the first note for this test.</p>';

    const lastRunId = test.stats?.last_run_id;
    const lastRunType = (test.stats?.last_run_type || test.stats?.last_run_source || '');
    const viewLastRunHtml = lastRunId
      ? `<p style="margin-bottom: 16px;"><button type="button" class="btn btn-secondary btn-sm" id="view-last-run-btn" data-last-run-id="${lastRunId}" data-last-run-type="${String(lastRunType).replace(/"/g, '&quot;')}">View last run</button></p>`
      : '';

    const content = `
      <div class="project-test-details">
        <form id="edit-project-test-details-form">
          <div class="form-group">
            <label for="project-test-detail-name">Name</label>
            <input type="text" id="project-test-detail-name" value="${escapeHtml(test.name || '')}">
          </div>
          <div class="form-group">
            <label for="project-test-detail-type">Type</label>
            <select id="project-test-detail-type">
              <option value="api" ${test.test_type === 'api' ? 'selected' : ''}>API</option>
              <option value="soap" ${test.test_type === 'soap' ? 'selected' : ''}>SOAP</option>
              <option value="ui_recorded" ${test.test_type === 'ui_recorded' ? 'selected' : ''}>UI (recorded)</option>
              <option value="manual" ${test.test_type === 'manual' ? 'selected' : ''}>Manual Test</option>
              <option value="other" ${test.test_type && !['api','soap','ui_recorded','manual'].includes(test.test_type) ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="project-test-detail-method">Method</label>
            <input type="text" id="project-test-detail-method" value="${escapeHtml(test.method || '')}" placeholder="GET, POST, UI, SOAP...">
          </div>
          <div class="form-group">
            <label for="project-test-detail-endpoint">Endpoint / Target</label>
            <input type="text" id="project-test-detail-endpoint" value="${escapeHtml(test.endpoint || '')}" placeholder="/path or URL (optional)">
          </div>
          <div class="form-group">
            <label for="project-test-detail-description">Description</label>
            <textarea id="project-test-detail-description" placeholder="Optional">${escapeHtml(test.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label for="project-test-detail-ticket-urls">Ticket URLs</label>
            <textarea id="project-test-detail-ticket-urls" rows="4" placeholder="https://jira.example.com/browse/KEY-123">${escapeHtml(ticketUrlsTextareaValue(test))}</textarea>
            <p class="muted form-help" style="margin-top:6px;">One URL per line (e.g. Jira issues).</p>
          </div>
          <div class="form-group">
            <label for="project-test-detail-folder-path">Folder path override</label>
            <input type="text" id="project-test-detail-folder-path" value="${escapeHtml(test.folder_path_override || '')}" placeholder="Release/Smoke">
            <p class="muted" style="margin-top:6px;">Source folder: ${escapeHtml(test.default_folder_path || '—')} | Effective folder: ${escapeHtml(getEffectiveFolderPath(test) || '—')}</p>
          </div>
          <div class="form-group">
            <label for="project-test-detail-status">Status</label>
            <select id="project-test-detail-status">
              <option value="not_run" ${(test.stats?.last_status || 'not_run') === 'not_run' ? 'selected' : ''}>Not run</option>
              <option value="passed" ${test.stats?.last_status === 'passed' ? 'selected' : ''}>Passed</option>
              <option value="failed" ${test.stats?.last_status === 'failed' ? 'selected' : ''}>Failed</option>
              <option value="partial_failed" ${test.stats?.last_status === 'partial_failed' ? 'selected' : ''}>Partial failed</option>
              <option value="running" ${test.stats?.last_status === 'running' ? 'selected' : ''}>Running</option>
              <option value="cancelled" ${test.stats?.last_status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Last run by</label>
            <p class="form-static" id="project-test-detail-last-run-by">${escapeHtml(test.stats?.last_run_by_username || '—')}</p>
          </div>
          <div class="form-group">
            <label for="project-test-detail-run-by">Run by</label>
            <select id="project-test-detail-run-by">
              <option value="">—</option>
              ${(users || []).map(u => `<option value="${u.id}" ${(test.stats?.last_run_by_user_id === u.id) ? 'selected' : ''}>${escapeHtml(u.display_name || u.username || '')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="project-test-detail-active" ${test.is_active ? 'checked' : ''}>
              Active in coverage
            </label>
          </div>
          ${viewLastRunHtml}
          <div style="display: flex; gap: 10px; justify-content: flex-end; margin-bottom: 16px;">
            <button type="button" class="btn btn-secondary" onclick="hideModal()">Close</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
        <div class="project-test-notes-list">
          ${listHtml}
        </div>
        <form id="add-project-test-note-form" style="margin-top: 16px;">
          <div class="form-group">
            <label for="project-test-note-text">Add note</label>
            <textarea id="project-test-note-text" rows="3" placeholder="Notes about this test (e.g. why it is failing, dependencies, rollout decisions)"></textarea>
          </div>
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button type="submit" class="btn btn-primary">Add note</button>
          </div>
        </form>
      </div>
    `;
    showModal('Test details & notes', content);
    const viewLastRunBtn = document.getElementById('view-last-run-btn');
    if (viewLastRunBtn) {
      viewLastRunBtn.addEventListener('click', () => {
        hideModal();
        window.openLastRunForTest(Number(viewLastRunBtn.dataset.lastRunId), viewLastRunBtn.dataset.lastRunType || '');
      });
    }
    document.getElementById('edit-project-test-details-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('project-test-detail-name').value.trim();
      const test_type = document.getElementById('project-test-detail-type').value || test.test_type || 'api';
      const method = document.getElementById('project-test-detail-method').value.trim();
      const endpoint = document.getElementById('project-test-detail-endpoint').value.trim();
      const description = document.getElementById('project-test-detail-description').value;
      const ticket_urls = parseTicketUrlsTextarea(document.getElementById('project-test-detail-ticket-urls').value);
      const folder_path_override = document.getElementById('project-test-detail-folder-path').value.trim();
      const is_active = document.getElementById('project-test-detail-active').checked;
      const last_status = document.getElementById('project-test-detail-status').value || 'not_run';
      const runByEl = document.getElementById('project-test-detail-run-by');
      const last_run_by_user_id = runByEl ? (runByEl.value === '' ? null : parseInt(runByEl.value, 10)) : undefined;
      try {
        const body = { name, description, is_active, method, endpoint, test_type, ticket_urls, folder_path_override, last_status };
        if (last_run_by_user_id !== undefined) body.last_run_by_user_id = last_run_by_user_id;
        await apiRequest(`/projects/${projectId}/tests/${projectTestId}`, {
          method: 'PATCH',
          body
        });
        hideModal();
        await loadProjectTests(projectId);
        if (typeof window.loadProjectCoverageSummary === 'function') {
          window.loadProjectCoverageSummary(projectId);
        }
      } catch (err2) {
        alert('Error saving test: ' + (err2.message || err2));
      }
    });
    document.getElementById('add-project-test-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = document.getElementById('project-test-note-text').value.trim();
      if (!note) {
        alert('Please enter a note.');
        return;
      }
      try {
        await apiRequest(`/projects/${projectId}/tests/${projectTestId}/notes`, {
          method: 'POST',
          body: { note }
        });
        hideModal();
        window.viewProjectTestDetails(projectId, projectTestId);
      } catch (err2) {
        alert('Error adding note: ' + (err2.message || err2));
      }
    });
  } catch (err) {
    alert('Error loading test details: ' + (err.message || err));
  }
};

// Open last run (API/SOAP -> test-run-detail, UI -> playwright run detail)
window.openLastRunForTest = (lastRunId, lastRunType) => {
  const type = (lastRunType || '').toLowerCase();
  if (type === 'ui' || type === 'ui_run') {
    if (typeof window.showView === 'function') window.showView('test-runs');
    if (typeof window.viewPlaywrightRun === 'function') window.viewPlaywrightRun(lastRunId);
  } else {
    if (typeof window.showView === 'function') window.showView('test-runs');
    if (typeof window.viewTestRun === 'function') window.viewTestRun(lastRunId);
  }
};

// Remove API spec from project
window.removeApiSpecFromProject = async (projectId, apiSpecId) => {
  if (!confirm('Remove this API spec from the project?')) return;
  
  try {
    await apiRequest(`/projects/${projectId}/api-specs/${apiSpecId}`, {
      method: 'DELETE'
    });
    
    viewProject(projectId);
  } catch (error) {
    alert('Error removing API spec: ' + error.message);
  }
};

// Delete collection
window.deleteCollection = async (collectionId, projectId) => {
  if (!confirm('Are you sure you want to delete this collection? This action cannot be undone.')) return;
  
  try {
    await apiRequest(`/collections/${collectionId}`, {
      method: 'DELETE'
    });
    
    // Refresh the project view to update the collections list
    if (projectId) {
      viewProject(projectId);
    } else {
      // If no project ID, reload collections if we're on a collections page
      if (typeof loadCollections === 'function') {
        loadCollections();
      }
    }
    
    alert('Collection deleted successfully');
  } catch (error) {
    alert('Error deleting collection: ' + error.message);
  }
};

function renderCollectionItemsHtml(items, depth = 0) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const indent = depth * 16;
  return `
    <ul style="list-style: none; margin: 0; padding-left: ${indent}px;">
      ${items.map((item) => {
        const name = escapeHtml(item?.name || 'Unnamed');
        if (item?.request) {
          const method = escapeHtml(item.request?.method || 'GET');
          let url = '';
          if (item.request?.url) {
            url = typeof item.request.url === 'string'
              ? item.request.url
              : (item.request.url.raw || '');
          }
          const safeUrl = escapeHtml(url || '');
          return `
            <li style="margin: 6px 0; padding: 8px 10px; border: 1px solid var(--color-gray-200); border-radius: 8px; background: var(--color-gray-50);">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="status-badge running" style="text-transform:none; letter-spacing:0;">${method}</span>
                <strong>${name}</strong>
              </div>
              ${safeUrl ? `<div class="muted" style="margin-top:4px; word-break: break-all;">${safeUrl}</div>` : ''}
            </li>
          `;
        }
        const children = Array.isArray(item?.item) ? item.item : [];
        return `
          <li style="margin: 8px 0;">
            <div style="font-weight: 600; color: var(--color-text-primary);">📁 ${name}</div>
            ${renderCollectionItemsHtml(children, depth + 1)}
          </li>
        `;
      }).join('')}
    </ul>
  `;
}

window.viewCollectionContents = async (collectionId, projectId) => {
  try {
    const collections = await apiRequest(`/projects/${projectId}/collections`);
    const collection = (collections || []).find((c) => Number(c.id) === Number(collectionId));
    if (!collection) {
      alert('Collection not found.');
      return;
    }
    const rootItems = Array.isArray(collection.collection_json?.item) ? collection.collection_json.item : [];
    const contentHtml = rootItems.length
      ? `
        <div class="form-group" style="margin-bottom: 8px;">
          <label>Collection</label>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <p class="muted" style="margin:0;">${escapeHtml(collection.name || '')}</p>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick="window.downloadCollectionJson(${collection.id}, ${projectId}, '${String(collection.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            >
              Download collection
            </button>
          </div>
        </div>
        <div style="max-height: 60vh; overflow: auto; border: 1px solid var(--color-gray-200); border-radius: 10px; padding: 12px; background: var(--color-white);">
          ${renderCollectionItemsHtml(rootItems)}
        </div>
      `
      : `<p class="muted">This collection has no items.</p>`;
    showModal(`Collection content: ${collection.name || collectionId}`, contentHtml);
  } catch (error) {
    alert('Error loading collection content: ' + (error.message || error));
  }
};

window.downloadCollectionJson = async (collectionId, projectId, suggestedName) => {
  try {
    let collection = null;
    try {
      collection = await apiRequest(`/collections/${collectionId}`);
    } catch (_) {
      const collections = await apiRequest(`/projects/${projectId}/collections`);
      collection = (collections || []).find((c) => Number(c.id) === Number(collectionId)) || null;
    }
    if (!collection || !collection.collection_json) {
      alert('Collection JSON not available.');
      return;
    }

    const safeBase = (suggestedName || collection.name || `collection-${collectionId}`)
      .toString()
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 120) || `collection-${collectionId}`;
    const filename = (collection.original_is_exact && collection.original_file_name)
      ? String(collection.original_file_name)
      : `${safeBase}.postman_collection.json`;

    const payload = (collection.original_is_exact && typeof collection.original_file_content === 'string')
      ? collection.original_file_content
      : JSON.stringify(collection.collection_json, null, 2);

    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    alert('Error downloading collection: ' + (error.message || error));
  }
};

// Upload API Spec
function showUploadApiSpecModal() {
  const content = `
    <form id="upload-api-spec-form">
      <div class="form-group">
        <label>Upload API Specification File (OpenAPI YAML/JSON or WSDL)</label>
        <div class="file-upload-area" id="file-upload-area">
          <p>Click to select or drag and drop</p>
          <p style="font-size: 12px; color: #666; margin-top: 10px;">Supports .yaml, .yml, .json, .wsdl, .xml files</p>
          <input type="file" id="api-spec-file" accept=".yaml,.yml,.json,.wsdl,.xml" style="display: none;">
        </div>
        <div id="file-name" style="margin-top: 10px; font-size: 14px; color: #666;"></div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Upload</button>
      </div>
    </form>
  `;
  
  showModal('Upload API Specification', content);
  
  const fileInput = document.getElementById('api-spec-file');
  const fileUploadArea = document.getElementById('file-upload-area');
  const fileName = document.getElementById('file-name');
  
  fileUploadArea.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      fileName.textContent = `Selected: ${e.target.files[0].name}`;
    }
  });
  
  // Drag and drop
  fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('dragover');
  });
  
  fileUploadArea.addEventListener('dragleave', () => {
    fileUploadArea.classList.remove('dragover');
  });
  
  fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      fileName.textContent = `Selected: ${e.dataTransfer.files[0].name}`;
    }
  });
  
  document.getElementById('upload-api-spec-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!fileInput.files.length) {
      alert('Please select a file');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    
    try {
      const response = await fetch('/api/api-specs/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
      
      hideModal();
      loadApiSpecs();
      alert('API specification uploaded successfully');
    } catch (error) {
      alert('Error uploading file: ' + error.message);
    }
  });
}

// Upload Postman Collection
function showUploadPostmanCollectionModal() {
  const projectId = document.getElementById('upload-postman-collection-btn')?.getAttribute('data-project-id');
  
  const content = `
    <form id="upload-postman-collection-form">
      <div class="form-group">
        <label>Upload Postman Collection (JSON)</label>
        <div class="file-upload-area" id="postman-file-upload-area">
          <p id="postman-upload-prompt">Click to select or drag and drop</p>
          <p class="file-upload-hint">Supports .json Postman collection files (v2.0 / v2.1)</p>
          <input type="file" id="postman-collection-file" accept=".json" style="display: none;">
        </div>
        <div id="postman-selected-file-card" class="selected-file-card" style="display: none;">
          <div class="selected-file-card-inner">
            <svg class="selected-file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div class="selected-file-info">
              <span class="selected-file-label">File included</span>
              <span id="postman-selected-file-name" class="selected-file-name"></span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm selected-file-change" id="postman-change-file-btn">Change file</button>
          </div>
        </div>
      </div>
      ${projectId ? `
      <div class="form-group">
        <label>
          <input type="checkbox" id="add-to-project" checked>
          Add to current project
        </label>
      </div>
      ` : ''}
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Upload</button>
      </div>
    </form>
  `;
  
  showModal('Upload Postman Collection', content);
  
  const fileInput = document.getElementById('postman-collection-file');
  const fileUploadArea = document.getElementById('postman-file-upload-area');
  const selectedCard = document.getElementById('postman-selected-file-card');
  const selectedFileName = document.getElementById('postman-selected-file-name');
  const uploadPrompt = document.getElementById('postman-upload-prompt');
  
  function updateFileDisplay() {
    const hasFile = fileInput.files && fileInput.files.length > 0;
    if (hasFile) {
      selectedFileName.textContent = fileInput.files[0].name;
      selectedCard.style.display = 'block';
      uploadPrompt.textContent = 'Drop a different file or click to replace';
      fileUploadArea.classList.add('has-file');
    } else {
      selectedCard.style.display = 'none';
      uploadPrompt.textContent = 'Click to select or drag and drop';
      fileUploadArea.classList.remove('has-file');
    }
  }
  
  fileUploadArea.addEventListener('click', (e) => {
    if (!e.target.closest('#postman-change-file-btn')) fileInput.click();
  });
  
  document.getElementById('postman-change-file-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value = '';
    updateFileDisplay();
    fileInput.click();
  });
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) updateFileDisplay();
  });
  
  // Drag and drop
  fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('dragover');
  });
  
  fileUploadArea.addEventListener('dragleave', () => {
    fileUploadArea.classList.remove('dragover');
  });
  
  fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      updateFileDisplay();
    }
  });
  
  document.getElementById('upload-postman-collection-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!fileInput.files.length) {
      alert('Please select a Postman collection file');
      return;
    }
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    if (projectId && document.getElementById('add-to-project')?.checked) {
      formData.append('projectId', projectId);
    }

    try {
      const response = await fetch('/api/collections/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        let errorMessage = 'Upload failed';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          // If response is not JSON, get text
          errorMessage = await response.text() || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const collection = await response.json();

      if (projectId && document.getElementById('add-to-project')?.checked) {
        hideModal();
        viewProject(projectId);
        alert('Postman collection uploaded and added to this project.');
      } else {
        hideModal();
        alert('Postman collection uploaded successfully!');
        if (typeof loadCollections === 'function') {
          loadCollections();
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading Postman collection: ' + error.message);
    }
  });
}

// Add API Spec to Project
function showAddApiSpecToProjectModal() {
  const projectId = document.getElementById('add-api-spec-btn').getAttribute('data-project-id');
  
  apiRequest('/api-specs').then(apiSpecs => {
    const projectApiSpecs = document.querySelectorAll('[data-api-spec-id]');
    const projectApiSpecIds = Array.from(projectApiSpecs).map(el => 
      parseInt(el.getAttribute('data-api-spec-id'))
    );
    
    const availableSpecs = apiSpecs.filter(spec => !projectApiSpecIds.includes(spec.id));
    
    if (availableSpecs.length === 0) {
      alert('No available API specs to add. Upload some API specs first.');
      return;
    }
    
    const content = `
      <form id="add-api-spec-form">
        <div class="form-group">
          <label for="api-spec-select">Select API Specification</label>
          <select id="api-spec-select" required>
            <option value="">Choose an API spec...</option>
            ${availableSpecs.map(spec => `
              <option value="${spec.id}">${spec.name} (${spec.format.toUpperCase()})</option>
            `).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add to Project</button>
        </div>
      </form>
    `;
    
    showModal('Add API Spec to Project', content);
    
    document.getElementById('add-api-spec-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const apiSpecId = document.getElementById('api-spec-select').value;
      
      try {
        await apiRequest(`/projects/${projectId}/api-specs/${apiSpecId}`, {
          method: 'POST'
        });
        
        hideModal();
        viewProject(projectId);
      } catch (error) {
        alert('Error adding API spec: ' + error.message);
      }
    });
  }).catch(error => {
    alert('Error loading API specs: ' + error.message);
  });
}

// Run Tests (handled in testRunner.js)
function showRunTestsModal() {
  // This will be implemented in testRunner.js
}

// Run Fuzz modal: select API Spec (OpenAPI), base URL, run name; POST /api/fuzz-runs/execute
async function showRunFuzzModal() {
  const projectId = document.getElementById('run-fuzz-btn')?.getAttribute('data-project-id');
  if (!projectId) {
    alert('Please select a project first.');
    return;
  }
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    const openApiSpecs = (project.apiSpecs || []).filter(s => s.format !== 'wsdl');
    if (openApiSpecs.length === 0) {
      alert('This project has no OpenAPI specs (YAML/JSON). Add an API spec to run fuzz tests.');
      return;
    }
    const specOptions = openApiSpecs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const content = `
      <div class="fuzz-modal-intro" style="margin-bottom: 20px; padding: 16px; background: var(--color-bg-muted, #f3f4f6); border-radius: 10px; border-left: 4px solid var(--color-primary, #14b8a6);">
        <p style="font-weight: 600; margin-bottom: 8px; color: var(--color-text, #1f2937);">Intent</p>
        <p style="font-size: 14px; line-height: 1.5; color: var(--color-text-secondary, #4b5563); margin-bottom: 12px;">
          Fuzz tests (powered by CATS) automatically send thousands of invalid, boundary, and edge-case inputs to your API based on its OpenAPI contract. The goal is to find bugs, undocumented behavior, and security issues by checking that the service rejects bad requests and responds as the contract implies.
        </p>
        <p style="font-weight: 600; margin-bottom: 8px; color: var(--color-text, #1f2937);">Some of the tests performed</p>
        <ul style="font-size: 13px; line-height: 1.6; color: var(--color-text-secondary, #4b5563); margin: 0; padding-left: 20px;">
          <li>Invalid payloads (malformed JSON, wrong types, null/empty values)</li>
          <li>Boundary and size fuzzing (very large strings, numbers, arrays)</li>
          <li>Wrong content types and HTTP headers</li>
          <li>Extra, missing, or renamed fields vs the contract</li>
          <li>Contract and schema validation (response codes and response body consistency)</li>
          <li>Optional security checks (e.g. injection-style payloads when enabled)</li>
        </ul>
      </div>
      <form id="run-fuzz-form">
        <div class="form-group">
          <label for="fuzz-api-spec">API Spec (OpenAPI) *</label>
          <select id="fuzz-api-spec" required>
            <option value="">Select API spec...</option>
            ${specOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="fuzz-base-url">Base URL (server URL for CATS) *</label>
          <input type="url" id="fuzz-base-url" required placeholder="https://api.example.com">
        </div>
        <div class="form-group">
          <label for="fuzz-run-name">Run name *</label>
          <input type="text" id="fuzz-run-name" required placeholder="e.g. Fuzz run 1">
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Run Fuzz</button>
        </div>
      </form>
    `;
    showModal('Run Fuzz', content);
    document.getElementById('run-fuzz-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiSpecId = document.getElementById('fuzz-api-spec').value;
      const serverUrl = document.getElementById('fuzz-base-url').value.trim();
      const name = document.getElementById('fuzz-run-name').value.trim();
      if (!apiSpecId || !serverUrl || !name) {
        alert('Please fill API Spec, Base URL, and Run name.');
        return;
      }
      try {
        await apiRequest('/fuzz-runs/execute', {
          method: 'POST',
          body: { projectId: Number(projectId), apiSpecId: Number(apiSpecId), name, serverUrl }
        });
        hideModal();
        showView('test-runs');
        if (typeof loadTestRuns === 'function') loadTestRuns();
        alert('Fuzz run started. It appears in Test Runs as running.');
      } catch (err) {
        alert('Error starting fuzz run: ' + (err.message || err));
      }
    });
  } catch (err) {
    alert('Error loading project: ' + (err.message || err));
  }
}

// Run SOAP modal: select WSDL spec, operations, run name; POST /soap-runs/execute
async function showRunSoapModal() {
  const projectId = document.getElementById('run-soap-btn')?.getAttribute('data-project-id');
  if (!projectId) {
    alert('Please select a project first.');
    return;
  }
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    const wsdlSpecs = (project.apiSpecs || []).filter(s => s.format === 'wsdl');
    if (wsdlSpecs.length === 0) {
      alert('This project has no WSDL API specs. Add a WSDL spec to the project to run SOAP tests.');
      return;
    }
    const specOptions = wsdlSpecs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const content = `
      <form id="run-soap-form" style="display: flex; flex-direction: column; height: 100%;">
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="soap-run-name">Test Run Name *</label>
          <input type="text" id="soap-run-name" required placeholder="e.g., Release 1.0" style="width: 100%; padding: 10px; font-size: 14px;">
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="soap-api-spec">Select WSDL API Spec *</label>
          <select id="soap-api-spec" required style="width: 100%; padding: 10px; border: 2px solid var(--color-primary, #14b8a6); border-radius: 4px; background: var(--color-white, white); color: var(--color-text-primary, #1f2937); font-size: 14px;">
            <option value="">Choose a WSDL spec...</option>
            ${specOptions}
          </select>
          <p style="font-size: 12px; color: var(--color-text-secondary, #6b7280); margin-top: 6px;">Select the WSDL spec and operations to run. Results appear in Test Runs with run type SOAP.</p>
        </div>
        <div class="form-group" id="soap-operations-group" style="display: none; flex: 1; flex-direction: column; min-height: 0; margin-bottom: 20px;">
          <label style="margin-bottom: 12px; display: block;">Select SOAP operations to Run</label>
          <div style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-secondary" id="soap-select-all">Select All</button>
            <button type="button" class="btn btn-sm btn-secondary" id="soap-deselect-all">Deselect All</button>
          </div>
          <div id="soap-operations-list" style="max-height: 600px; overflow-y: auto; border: 1px solid var(--color-gray-300, #d1d5db); border-radius: 4px; padding: 15px; background: var(--color-gray-50, #f9fafb); color: var(--color-text-primary, #1f2937);">
            <!-- Filled when spec is selected -->
          </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--color-gray-200, #e5e7eb); flex-shrink: 0;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="run-soap-submit" disabled>Run SOAP</button>
        </div>
      </form>
    `;
    showModal('Run SOAP', content);

    const specSelect = document.getElementById('soap-api-spec');
    const operationsGroup = document.getElementById('soap-operations-group');
    const operationsList = document.getElementById('soap-operations-list');
    const runNameInput = document.getElementById('soap-run-name');
    const submitBtn = document.getElementById('run-soap-submit');

    function updateSoapSubmitState() {
      const checked = operationsList.querySelectorAll('.soap-op-checkbox:checked');
      submitBtn.disabled = checked.length === 0 || !runNameInput.value.trim();
    }

    document.getElementById('soap-select-all')?.addEventListener('click', () => {
      operationsList.querySelectorAll('.soap-op-checkbox').forEach(cb => { cb.checked = true; });
      updateSoapSubmitState();
    });
    document.getElementById('soap-deselect-all')?.addEventListener('click', () => {
      operationsList.querySelectorAll('.soap-op-checkbox').forEach(cb => { cb.checked = false; });
      updateSoapSubmitState();
    });

    specSelect.addEventListener('change', async () => {
      const apiSpecId = specSelect.value;
      operationsList.innerHTML = '';
      operationsGroup.style.display = 'none';
      submitBtn.disabled = true;
      if (!apiSpecId) return;
      try {
        const operations = await apiRequest(`/api-specs/${apiSpecId}/soap-operations`);
        if (operations.length === 0) {
          operationsList.innerHTML = '<p style="margin: 0; color: var(--color-text-secondary, #6b7280); font-style: italic;">No operations in this WSDL.</p>';
        } else {
          operationsList.innerHTML = operations.map(op => `
            <div class="test-item" data-soap-op-id="${op.id}">
              <div class="test-item-left">
                <input type="checkbox" class="soap-op-checkbox test-checkbox" value="${op.id}" data-name="${(op.name || '').replace(/"/g, '&quot;')}">
              </div>
              <div class="test-item-body">
                <div class="test-item-row">
                  <span class="test-item-name" style="flex: 1; min-width: 200px;">📁 ${op.name || op.operation_name || op.id}</span>
                </div>
              </div>
            </div>
          `).join('');
        }
        operationsGroup.style.display = 'flex';
        updateSoapSubmitState();
        operationsList.querySelectorAll('.soap-op-checkbox').forEach(cb => cb.addEventListener('change', updateSoapSubmitState));
      } catch (err) {
        operationsList.innerHTML = '<p style="margin: 0; color: var(--color-error, #dc2626);">Failed to load operations.</p>';
        operationsGroup.style.display = 'flex';
      }
    });

    runNameInput.addEventListener('input', updateSoapSubmitState);

    document.getElementById('run-soap-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiSpecId = specSelect.value;
      const operationIds = Array.from(operationsList.querySelectorAll('.soap-op-checkbox:checked')).map(cb => parseInt(cb.value, 10));
      const name = runNameInput.value.trim();
      if (!apiSpecId || operationIds.length === 0 || !name) {
        alert('Please select a WSDL spec, at least one operation, and enter a run name.');
        return;
      }
      try {
        await apiRequest('/soap-runs/execute', {
          method: 'POST',
          body: { projectId: Number(projectId), apiSpecId: Number(apiSpecId), operationIds, name }
        });
        hideModal();
        showView('test-runs');
        if (typeof loadTestRuns === 'function') loadTestRuns();
        alert('SOAP run started. It appears in Test Runs as running.');
      } catch (err) {
        alert('Error starting SOAP run: ' + (err.message || err));
      }
    });

    // Trigger load for first spec if only one
    if (wsdlSpecs.length === 1) specSelect.dispatchEvent(new Event('change'));
  } catch (err) {
    alert('Error loading project: ' + (err.message || err));
  }
}

// Flatten collection items for flow task picker (path = array of indices)
function flattenCollectionItems(items, parentPath = [], collectionId, out = []) {
  if (!items || !Array.isArray(items)) return out;
  items.forEach((item, index) => {
    const path = [...parentPath, index];
    if (item.request) {
      out.push({ collectionId, path, name: item.name || 'Unnamed request' });
    } else if (item.item && Array.isArray(item.item)) {
      flattenCollectionItems(item.item, path, collectionId, out);
    }
  });
  return out;
}

function showCreateFlowModal(projectId) {
  const content = `
    <form id="create-flow-form">
      <div class="form-group">
        <label for="flow-name">Flow name *</label>
        <input type="text" id="flow-name" required placeholder="e.g. Smoke test">
      </div>
      <div class="form-group">
        <label for="flow-description">Description</label>
        <textarea id="flow-description" placeholder="Optional"></textarea>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create</button>
      </div>
    </form>
  `;
  showModal('Create flow', content);
  document.getElementById('create-flow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('flow-name').value.trim();
    const description = document.getElementById('flow-description').value.trim();
    try {
      await apiRequest(`/projects/${projectId}/flows`, {
        method: 'POST',
        body: { name, description: description || null }
      });
      hideModal();
      viewProject(projectId);
    } catch (err) {
      alert('Error creating flow: ' + (err.message || err));
    }
  });
}

window.editFlow = async (flowId, projectId) => {
  try {
    const flow = await apiRequest(`/flows/${flowId}`);
    const collections = await apiRequest(`/projects/${projectId}/collections`);
    const recordedTests = await apiRequest(`/projects/${projectId}/recorded-tests`);
    const apiOptions = [];
    collections.forEach(c => {
      const items = flattenCollectionItems(c.collection_json?.item || [], [], c.id);
      items.forEach(it => apiOptions.push({ ...it, collectionName: c.name }));
    });
    const tasks = (flow.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    const taskListId = 'flow-edit-task-list';
    const content = `
      <form id="edit-flow-form">
        <div class="form-group">
          <label for="edit-flow-name">Flow name *</label>
          <input type="text" id="edit-flow-name" value="${(flow.name || '').replace(/"/g, '&quot;')}" required>
        </div>
        <div class="form-group">
          <label for="edit-flow-description">Description</label>
          <textarea id="edit-flow-description">${(flow.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        </div>
        <div class="form-group">
          <label>Tasks (order preserved)</label>
          <div id="${taskListId}" class="flow-task-list"></div>
          <div class="flow-add-task" style="margin-top: 12px;">
            <select id="flow-add-task-type">
              <option value="api">API test</option>
              <option value="ui">UI test</option>
            </select>
            <select id="flow-add-api-task" style="display:inline-block; max-width: 320px;">
              <option value="">Select API test...</option>
              ${apiOptions.map(o => `<option value="${o.collectionId}|${o.path.join('.')}">${(o.collectionName || '')} – ${(o.name || 'Unnamed').substring(0, 50)}</option>`).join('')}
            </select>
            <select id="flow-add-ui-task" style="display:none; max-width: 320px;">
              <option value="">Select UI test...</option>
              ${recordedTests.map(r => `<option value="${r.id}">${(r.name || 'Unnamed').substring(0, 50)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-secondary" id="flow-add-task-btn">Add task</button>
          </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `;
    showModal('Edit flow', content);
    let flowTasksData = tasks.map(t => ({ task_type: t.task_type, task_ref: t.task_ref || {}, position: t.position }));
    const renderTaskList = () => {
      const el = document.getElementById(taskListId);
      el.innerHTML = flowTasksData.map((t, i) => {
        const label = t.task_ref?.label || (t.task_type === 'api' ? `API: ${t.task_ref?.collectionId}` : `UI: ${t.task_ref?.recordedTestId || ''}`);
        return `<div class="flow-task-item" data-index="${i}" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span class="run-type-badge run-type-${t.task_type}">${t.task_type === 'api' ? 'API' : 'UI'}</span>
          <span style="flex:1;font-size:14px;">${(label || 'Task').substring(0, 60)}</span>
          <button type="button" class="btn btn-secondary" onclick="window.moveFlowTask(${i}, -1)" ${i === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" class="btn btn-secondary" onclick="window.moveFlowTask(${i}, 1)" ${i === flowTasksData.length - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" class="btn btn-danger" onclick="window.removeFlowTask(${i})">Remove</button>
        </div>`;
      }).join('') || '<p class="muted">No tasks. Add API or UI tasks below.</p>';
    };
    window.moveFlowTask = (index, delta) => {
      const ni = index + delta;
      if (ni < 0 || ni >= flowTasksData.length) return;
      [flowTasksData[index], flowTasksData[ni]] = [flowTasksData[ni], flowTasksData[index]];
      renderTaskList();
    };
    window.removeFlowTask = (index) => {
      flowTasksData.splice(index, 1);
      renderTaskList();
    };
    renderTaskList();
    const addType = document.getElementById('flow-add-task-type');
    const addApi = document.getElementById('flow-add-api-task');
    const addUi = document.getElementById('flow-add-ui-task');
    addType.addEventListener('change', () => {
      addApi.style.display = addType.value === 'api' ? 'inline-block' : 'none';
      addUi.style.display = addType.value === 'ui' ? 'inline-block' : 'none';
    });
    addUi.style.display = 'none';
    document.getElementById('flow-add-task-btn').addEventListener('click', () => {
      if (addType.value === 'api') {
        const v = addApi.value;
        if (!v) return;
        const [cid, pathStr] = v.split('|');
        const path = pathStr.split('.').map(Number);
        const opt = addApi.options[addApi.selectedIndex];
        const label = opt ? opt.text : '';
        flowTasksData.push({ task_type: 'api', task_ref: { collectionId: Number(cid), path, label: label || undefined } });
      } else {
        const v = addUi.value;
        if (!v) return;
        const opt = addUi.options[addUi.selectedIndex];
        const label = opt ? opt.text : '';
        flowTasksData.push({ task_type: 'ui', task_ref: { recordedTestId: Number(v), label: label || undefined } });
      }
      renderTaskList();
    });
    document.getElementById('edit-flow-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-flow-name').value.trim();
      const description = document.getElementById('edit-flow-description').value.trim();
      const flowTasks = flowTasksData.map((t, i) => ({ task_type: t.task_type, task_ref: { ...t.task_ref } }));
      try {
        await apiRequest(`/flows/${flowId}`, {
          method: 'PUT',
          body: { name, description: description || null, flowTasks }
        });
        hideModal();
        viewProject(projectId);
      } catch (err) {
        alert('Error saving flow: ' + (err.message || err));
      }
    });
  } catch (err) {
    alert('Error loading flow: ' + (err.message || err));
  }
};

window.deleteFlow = async (flowId, projectId) => {
  if (!confirm('Delete this flow? This cannot be undone.')) return;
  try {
    await apiRequest(`/flows/${flowId}`, { method: 'DELETE' });
    viewProject(projectId);
  } catch (err) {
    alert('Error deleting flow: ' + (err.message || err));
  }
};

window.runFlow = async (flowId, flowName) => {
  const content = `
    <form id="run-flow-form">
      <div class="form-group">
        <label for="run-flow-name">Run name</label>
        <input type="text" id="run-flow-name" value="${(flowName || 'Flow run').replace(/"/g, '&quot;')}" placeholder="Name for this run">
      </div>
      <div class="form-group">
        <label for="run-flow-base-url">Base URL (for UI tests)</label>
        <input type="url" id="run-flow-base-url" placeholder="https://example.com">
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Run</button>
      </div>
    </form>
  `;
  showModal('Run flow', content);
  document.getElementById('run-flow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const runNamePrefix = document.getElementById('run-flow-name').value.trim() || flowName;
    const baseUrl = document.getElementById('run-flow-base-url').value.trim() || undefined;
    try {
      const result = await apiRequest(`/flows/${flowId}/execute`, {
        method: 'POST',
        body: { runNamePrefix, baseUrl }
      });
      hideModal();
      alert(`Flow execution started. ${(result.apiRunIds?.length || 0) + (result.uiRunIds?.length || 0)} run(s) queued. View Test Runs for progress.`);
      showView('test-runs');
      loadTestRuns();
    } catch (err) {
      alert('Error starting flow: ' + (err.message || err));
    }
  });
};

// Schedule helpers: build cron from user-friendly preset + time/date
function scheduleBuildCron(preset, opts) {
  const [hour, min] = (opts.time || '09:00').split(':').map(n => parseInt(n, 10) || 0);
  const minute = min;
  const hourCron = hour;
  if (preset === 'daily') return `${minute} ${hourCron} * * *`;
  if (preset === 'weekly') {
    const dow = opts.dayOfWeek != null ? opts.dayOfWeek : 1; // 0=Sun..6=Sat
    return `${minute} ${hourCron} * * ${dow}`;
  }
  if (preset === 'monthly') {
    const dom = Math.min(31, Math.max(1, parseInt(opts.dayOfMonth, 10) || 1));
    return `${minute} ${hourCron} ${dom} * *`;
  }
  return null;
}

function scheduleParseCron(cron) {
  if (!cron || !cron.trim()) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { preset: 'custom', cron };
  const [min, hr, dom, month, dow] = parts;
  const hour = parseInt(hr, 10);
  const minute = parseInt(min, 10);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (month !== '*') return { preset: 'custom', cron };
  if (dom !== '*' && dow !== '*') return { preset: 'custom', cron };
  if (dow !== '*') return { preset: 'weekly', time, dayOfWeek: parseInt(dow, 10), cron };
  if (dom !== '*') return { preset: 'monthly', time, dayOfMonth: parseInt(dom, 10), cron };
  return { preset: 'daily', time, cron };
}

function showCreateScheduleModal(projectId) {
  apiRequest(`/projects/${projectId}/flows`).then(flows => {
    const content = `
      <form id="create-schedule-form" class="schedule-form">
        <div class="form-group">
          <label for="schedule-target">Target</label>
          <select id="schedule-target">
            <option value="">Whole project</option>
            ${(flows || []).map(f => `<option value="${f.id}">Flow: ${(f.name || '').replace(/"/g, '&quot;')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Schedule type</label>
          <div class="schedule-type-tabs">
            <label class="radio-label"><input type="radio" name="schedule-type" value="cron" checked> Date &amp; time (cron)</label>
            <label class="radio-label"><input type="radio" name="schedule-type" value="repeat"> Repeat every</label>
          </div>

          <div id="schedule-cron-section">
            <div class="form-group">
              <label for="schedule-cron-preset">When to run</label>
              <select id="schedule-cron-preset">
                <option value="daily">Daily at a set time</option>
                <option value="weekly">Weekly on a weekday</option>
                <option value="monthly">Monthly on a day</option>
                <option value="custom">Custom cron expression</option>
              </select>
            </div>
            <div id="schedule-cron-daily" class="schedule-preset-row">
              <label for="schedule-cron-time">Time</label>
              <input type="time" id="schedule-cron-time" value="09:00">
            </div>
            <div id="schedule-cron-weekly" class="schedule-preset-row" style="display:none;">
              <label for="schedule-cron-dow">Day of week</label>
              <select id="schedule-cron-dow">
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
              <label for="schedule-cron-time-w">Time</label>
              <input type="time" id="schedule-cron-time-w" value="09:00">
            </div>
            <div id="schedule-cron-monthly" class="schedule-preset-row" style="display:none;">
              <label for="schedule-cron-dom">Day of month (1–31)</label>
              <input type="number" id="schedule-cron-dom" min="1" max="31" value="1">
              <label for="schedule-cron-time-m">Time</label>
              <input type="time" id="schedule-cron-time-m" value="09:00">
            </div>
            <div id="schedule-cron-custom" class="schedule-preset-row" style="display:none;">
              <label for="schedule-cron-raw">Cron expression</label>
              <input type="text" id="schedule-cron-raw" placeholder="e.g. 0 2 * * * (min hour day month dow)">
              <small class="muted">Format: minute hour day-of-month month day-of-week. Example: 0 9 * * * = daily at 09:00</small>
            </div>
          </div>

          <div id="schedule-repeat-wrap" class="schedule-repeat-wrap" style="display:none;">
            <label for="schedule-repeat-num">Repeat every</label>
            <input type="number" id="schedule-repeat-num" min="1" value="30">
            <select id="schedule-repeat-unit">
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="radio-label"><input type="checkbox" id="schedule-enabled" checked> Enabled</label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    `;
    showModal('Create schedule', content);
    const typeCron = document.querySelector('input[name="schedule-type"][value="cron"]');
    const typeRepeat = document.querySelector('input[name="schedule-type"][value="repeat"]');
    const cronSection = document.getElementById('schedule-cron-section');
    const repeatWrap = document.getElementById('schedule-repeat-wrap');
    const presetSelect = document.getElementById('schedule-cron-preset');
    const dailyRow = document.getElementById('schedule-cron-daily');
    const weeklyRow = document.getElementById('schedule-cron-weekly');
    const monthlyRow = document.getElementById('schedule-cron-monthly');
    const customRow = document.getElementById('schedule-cron-custom');

    function showCronPreset() {
      const v = presetSelect.value;
      dailyRow.style.display = v === 'daily' ? 'flex' : 'none';
      weeklyRow.style.display = v === 'weekly' ? 'flex' : 'none';
      monthlyRow.style.display = v === 'monthly' ? 'flex' : 'none';
      customRow.style.display = v === 'custom' ? 'block' : 'none';
    }
    presetSelect.addEventListener('change', showCronPreset);
    showCronPreset();

    typeCron.addEventListener('change', () => {
      cronSection.style.display = 'block';
      repeatWrap.style.display = 'none';
    });
    typeRepeat.addEventListener('change', () => {
      cronSection.style.display = 'none';
      repeatWrap.style.display = 'flex';
    });

    document.getElementById('create-schedule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const flow_id = document.getElementById('schedule-target').value || null;
      const enabled = document.getElementById('schedule-enabled').checked;
      let cron_expression = null;
      let repeat_interval_minutes = null;
      if (document.querySelector('input[name="schedule-type"]:checked').value === 'cron') {
        const preset = presetSelect.value;
        if (preset === 'custom') {
          cron_expression = document.getElementById('schedule-cron-raw').value.trim() || null;
          if (!cron_expression) { alert('Enter a cron expression'); return; }
        } else {
          const time = preset === 'daily' ? document.getElementById('schedule-cron-time').value
            : preset === 'weekly' ? document.getElementById('schedule-cron-time-w').value
            : document.getElementById('schedule-cron-time-m').value;
          const dayOfWeek = preset === 'weekly' ? parseInt(document.getElementById('schedule-cron-dow').value, 10) : undefined;
          const dayOfMonth = preset === 'monthly' ? parseInt(document.getElementById('schedule-cron-dom').value, 10) : undefined;
          cron_expression = scheduleBuildCron(preset, { time, dayOfWeek, dayOfMonth });
        }
      } else {
        const num = parseInt(document.getElementById('schedule-repeat-num').value, 10);
        const unit = document.getElementById('schedule-repeat-unit').value;
        if (!num || num < 1) { alert('Enter a repeat value (≥ 1)'); return; }
        repeat_interval_minutes = unit === 'hours' ? num * 60 : num;
      }
      try {
        await apiRequest(`/projects/${projectId}/schedules`, {
          method: 'POST',
          body: { flow_id, cron_expression, repeat_interval_minutes, enabled }
        });
        hideModal();
        viewProject(projectId);
      } catch (err) {
        alert('Error creating schedule: ' + (err.message || err));
      }
    });
  }).catch(err => alert('Error loading flows: ' + (err.message || err)));
}

window.editSchedule = async (scheduleId, projectId) => {
  try {
    const schedule = await apiRequest(`/schedules/${scheduleId}`);
    const flows = await apiRequest(`/projects/${projectId}/flows`);
    const useCron = !!schedule.cron_expression;
    const parsed = schedule.cron_expression ? scheduleParseCron(schedule.cron_expression) : null;
    const repeatMin = schedule.repeat_interval_minutes || null;
    const repeatNum = repeatMin ? (repeatMin >= 60 && repeatMin % 60 === 0 ? repeatMin / 60 : repeatMin) : 30;
    const repeatUnit = repeatMin && repeatMin >= 60 && repeatMin % 60 === 0 ? 'hours' : 'minutes';
    const content = `
      <form id="edit-schedule-form" class="schedule-form">
        <div class="form-group">
          <label for="edit-schedule-target">Target</label>
          <select id="edit-schedule-target">
            <option value="" ${!schedule.flow_id ? 'selected' : ''}>Whole project</option>
            ${(flows || []).map(f => `<option value="${f.id}" ${schedule.flow_id === f.id ? 'selected' : ''}>Flow: ${(f.name || '').replace(/"/g, '&quot;')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Schedule type</label>
          <div class="schedule-type-tabs">
            <label class="radio-label"><input type="radio" name="edit-schedule-type" value="cron" ${useCron ? 'checked' : ''}> Date &amp; time (cron)</label>
            <label class="radio-label"><input type="radio" name="edit-schedule-type" value="repeat" ${!useCron ? 'checked' : ''}> Repeat every</label>
          </div>

          <div id="edit-schedule-cron-section" style="display:${useCron ? 'block' : 'none'};">
            <div class="form-group">
              <label for="edit-schedule-cron-preset">When to run</label>
              <select id="edit-schedule-cron-preset">
                <option value="daily" ${parsed && parsed.preset === 'daily' ? 'selected' : ''}>Daily at a set time</option>
                <option value="weekly" ${parsed && parsed.preset === 'weekly' ? 'selected' : ''}>Weekly on a weekday</option>
                <option value="monthly" ${parsed && parsed.preset === 'monthly' ? 'selected' : ''}>Monthly on a day</option>
                <option value="custom" ${!parsed || parsed.preset === 'custom' ? 'selected' : ''}>Custom cron expression</option>
              </select>
            </div>
            <div id="edit-schedule-cron-daily" class="schedule-preset-row" style="display:${parsed && parsed.preset === 'daily' ? 'flex' : 'none'};">
              <label for="edit-schedule-cron-time">Time</label>
              <input type="time" id="edit-schedule-cron-time" value="${parsed && parsed.preset === 'daily' && parsed.time ? parsed.time : '09:00'}">
            </div>
            <div id="edit-schedule-cron-weekly" class="schedule-preset-row" style="display:${parsed && parsed.preset === 'weekly' ? 'flex' : 'none'};">
              <label for="edit-schedule-cron-dow">Day of week</label>
              <select id="edit-schedule-cron-dow">
                <option value="0" ${parsed && parsed.dayOfWeek === 0 ? 'selected' : ''}>Sunday</option>
                <option value="1" ${parsed && parsed.dayOfWeek === 1 ? 'selected' : ''}>Monday</option>
                <option value="2" ${parsed && parsed.dayOfWeek === 2 ? 'selected' : ''}>Tuesday</option>
                <option value="3" ${parsed && parsed.dayOfWeek === 3 ? 'selected' : ''}>Wednesday</option>
                <option value="4" ${parsed && parsed.dayOfWeek === 4 ? 'selected' : ''}>Thursday</option>
                <option value="5" ${parsed && parsed.dayOfWeek === 5 ? 'selected' : ''}>Friday</option>
                <option value="6" ${parsed && parsed.dayOfWeek === 6 ? 'selected' : ''}>Saturday</option>
              </select>
              <label for="edit-schedule-cron-time-w">Time</label>
              <input type="time" id="edit-schedule-cron-time-w" value="${parsed && parsed.preset === 'weekly' && parsed.time ? parsed.time : '09:00'}">
            </div>
            <div id="edit-schedule-cron-monthly" class="schedule-preset-row" style="display:${parsed && parsed.preset === 'monthly' ? 'flex' : 'none'};">
              <label for="edit-schedule-cron-dom">Day of month (1–31)</label>
              <input type="number" id="edit-schedule-cron-dom" min="1" max="31" value="${parsed && parsed.preset === 'monthly' && parsed.dayOfMonth ? parsed.dayOfMonth : 1}">
              <label for="edit-schedule-cron-time-m">Time</label>
              <input type="time" id="edit-schedule-cron-time-m" value="${parsed && parsed.preset === 'monthly' && parsed.time ? parsed.time : '09:00'}">
            </div>
            <div id="edit-schedule-cron-custom" class="schedule-preset-row" style="display:${!parsed || parsed.preset === 'custom' ? 'block' : 'none'};">
              <label for="edit-schedule-cron-raw">Cron expression</label>
              <input type="text" id="edit-schedule-cron-raw" value="${(schedule.cron_expression || '').replace(/"/g, '&quot;')}" placeholder="e.g. 0 2 * * *">
              <small class="muted">Format: minute hour day-of-month month day-of-week</small>
            </div>
          </div>

          <div id="edit-schedule-repeat-wrap" class="schedule-repeat-wrap" style="display:${!useCron ? 'flex' : 'none'};">
            <label for="edit-schedule-repeat-num">Repeat every</label>
            <input type="number" id="edit-schedule-repeat-num" min="1" value="${repeatNum}">
            <select id="edit-schedule-repeat-unit">
              <option value="minutes" ${repeatUnit === 'minutes' ? 'selected' : ''}>minutes</option>
              <option value="hours" ${repeatUnit === 'hours' ? 'selected' : ''}>hours</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="radio-label"><input type="checkbox" id="edit-schedule-enabled" ${schedule.enabled ? 'checked' : ''}> Enabled</label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `;
    showModal('Edit schedule', content);
    const typeCron = document.querySelector('input[name="edit-schedule-type"][value="cron"]');
    const typeRepeat = document.querySelector('input[name="edit-schedule-type"][value="repeat"]');
    const cronSection = document.getElementById('edit-schedule-cron-section');
    const repeatWrap = document.getElementById('edit-schedule-repeat-wrap');
    const presetSelect = document.getElementById('edit-schedule-cron-preset');
    const dailyRow = document.getElementById('edit-schedule-cron-daily');
    const weeklyRow = document.getElementById('edit-schedule-cron-weekly');
    const monthlyRow = document.getElementById('edit-schedule-cron-monthly');
    const customRow = document.getElementById('edit-schedule-cron-custom');

    function showEditCronPreset() {
      const v = presetSelect.value;
      dailyRow.style.display = v === 'daily' ? 'flex' : 'none';
      weeklyRow.style.display = v === 'weekly' ? 'flex' : 'none';
      monthlyRow.style.display = v === 'monthly' ? 'flex' : 'none';
      customRow.style.display = v === 'custom' ? 'block' : 'none';
    }
    presetSelect.addEventListener('change', showEditCronPreset);

    typeCron.addEventListener('change', () => { cronSection.style.display = 'block'; repeatWrap.style.display = 'none'; });
    typeRepeat.addEventListener('change', () => { cronSection.style.display = 'none'; repeatWrap.style.display = 'flex'; });

    document.getElementById('edit-schedule-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const flow_id = document.getElementById('edit-schedule-target').value || null;
      const enabled = document.getElementById('edit-schedule-enabled').checked;
      let cron_expression = null;
      let repeat_interval_minutes = null;
      if (document.querySelector('input[name="edit-schedule-type"]:checked').value === 'cron') {
        const preset = presetSelect.value;
        if (preset === 'custom') {
          cron_expression = document.getElementById('edit-schedule-cron-raw').value.trim() || null;
          if (!cron_expression) { alert('Enter a cron expression'); return; }
        } else {
          const time = preset === 'daily' ? document.getElementById('edit-schedule-cron-time').value
            : preset === 'weekly' ? document.getElementById('edit-schedule-cron-time-w').value
            : document.getElementById('edit-schedule-cron-time-m').value;
          const dayOfWeek = preset === 'weekly' ? parseInt(document.getElementById('edit-schedule-cron-dow').value, 10) : undefined;
          const dayOfMonth = preset === 'monthly' ? parseInt(document.getElementById('edit-schedule-cron-dom').value, 10) : undefined;
          cron_expression = scheduleBuildCron(preset, { time, dayOfWeek, dayOfMonth });
        }
      } else {
        const num = parseInt(document.getElementById('edit-schedule-repeat-num').value, 10);
        const unit = document.getElementById('edit-schedule-repeat-unit').value;
        if (!num || num < 1) { alert('Enter a repeat value (≥ 1)'); return; }
        repeat_interval_minutes = unit === 'hours' ? num * 60 : num;
      }
      try {
        await apiRequest(`/schedules/${scheduleId}`, {
          method: 'PUT',
          body: { flow_id, cron_expression, repeat_interval_minutes, enabled }
        });
        hideModal();
        viewProject(projectId);
      } catch (err) {
        alert('Error saving schedule: ' + (err.message || err));
      }
    });
  } catch (err) {
    alert('Error loading schedule: ' + (err.message || err));
  }
};

window.deleteSchedule = async (scheduleId, projectId) => {
  if (!confirm('Delete this schedule?')) return;
  try {
    await apiRequest(`/schedules/${scheduleId}`, { method: 'DELETE' });
    viewProject(projectId);
  } catch (err) {
    alert('Error deleting schedule: ' + (err.message || err));
  }
};

window.triggerSchedule = async (scheduleId) => {
  try {
    await apiRequest(`/schedules/${scheduleId}/trigger`, { method: 'POST' });
    alert('Schedule run started. Check Test Runs for progress.');
    const projectId = document.getElementById('create-schedule-btn')?.getAttribute('data-project-id');
    if (projectId) viewProject(projectId);
  } catch (err) {
    alert('Error triggering schedule: ' + (err.message || err));
  }
};


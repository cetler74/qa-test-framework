// Project management functions

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
    const otherUsers = (users || []).filter(u => u.id !== ownerId);
    const sharedOptions = otherUsers.map(u =>
      `<option value="${u.id}" ${sharedIds.includes(u.id) ? 'selected' : ''}>${escapeHtml(u.display_name || u.username)}</option>`
    ).join('');

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
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
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

      try {
        await apiRequest(`/projects/${projectId}`, {
          method: 'PUT',
          body: { name, description, visibility, shared_user_ids }
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

    const editBtn = document.getElementById('project-detail-edit-btn');
    if (editBtn) {
      editBtn.style.display = 'none';
      editBtn.removeAttribute('data-project-id');
      editBtn.onclick = null;
    }

    const canManage = window.currentUser && (window.currentUser.is_admin || (project.owner && project.owner.id === window.currentUser.id));
    if (editBtn && canManage) {
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
              <h3>${collection.name}</h3>
              <p>${itemCount} item(s)</p>
            </div>
            <div class="list-item-actions">
              <button class="btn btn-danger" onclick="deleteCollection(${collection.id}, ${projectId})" title="Delete collection">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }
    
    showView('project-detail');
  } catch (error) {
    console.error('Error loading project:', error);
    alert('Error loading project: ' + error.message);
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
      
      // If project ID is provided and checkbox is checked, add to project
      if (projectId && document.getElementById('add-to-project')?.checked) {
        try {
          // First, create a dummy API spec for this collection (or we can modify backend to allow collections without API specs)
          // For now, we'll just refresh the project view
          hideModal();
          viewProject(projectId);
          alert('Postman collection uploaded successfully!');
        } catch (addError) {
          hideModal();
          alert('Collection uploaded, but error adding to project: ' + addError.message);
        }
      } else {
        hideModal();
        alert('Postman collection uploaded successfully!');
        // Refresh collections if on collections view
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


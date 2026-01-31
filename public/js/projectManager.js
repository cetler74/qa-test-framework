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

    const content = `
      <form id="edit-project-form">
        <div class="form-group">
          <label for="edit-project-name">Project Name *</label>
          <input type="text" id="edit-project-name" value="${project.name}" required>
        </div>
        <div class="form-group">
          <label for="edit-project-description">Description</label>
          <textarea id="edit-project-description">${project.description || ''}</textarea>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    `;

    showModal('Edit Project', content);

    document.getElementById('edit-project-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('edit-project-name').value;
      const description = document.getElementById('edit-project-description').value;

      try {
        await apiRequest(`/projects/${projectId}`, {
          method: 'PUT',
          body: { name, description }
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

// View Project
window.viewProject = async (projectId) => {
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    
    document.getElementById('project-detail-name').textContent = project.name;
    document.getElementById('project-detail-description').textContent = project.description || 'No description';
    
    // Store project ID for later use
    document.getElementById('add-api-spec-btn').setAttribute('data-project-id', projectId);
    document.getElementById('upload-postman-collection-btn').setAttribute('data-project-id', projectId);
    document.getElementById('run-tests-btn').setAttribute('data-project-id', projectId);
    const runUiTestBtn = document.getElementById('run-ui-test-btn');
    const manageProjectRecordedBtn = document.getElementById('manage-project-recorded-tests-btn');
    if (runUiTestBtn) runUiTestBtn.setAttribute('data-project-id', projectId);
    if (manageProjectRecordedBtn) manageProjectRecordedBtn.setAttribute('data-project-id', projectId);
    
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
        <label>Upload API Specification File (YAML or JSON)</label>
        <div class="file-upload-area" id="file-upload-area">
          <p>Click to select or drag and drop</p>
          <p style="font-size: 12px; color: #666; margin-top: 10px;">Supports .yaml, .yml, .json files</p>
          <input type="file" id="api-spec-file" accept=".yaml,.yml,.json" style="display: none;">
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
        <label>Upload Postman Collection JSON File</label>
        <div class="file-upload-area" id="postman-file-upload-area">
          <p>Click to select or drag and drop</p>
          <p style="font-size: 12px; color: #666; margin-top: 10px;">Supports .json Postman collection files</p>
          <input type="file" id="postman-collection-file" accept=".json" style="display: none;">
        </div>
        <div id="postman-file-name" style="margin-top: 10px; font-size: 14px; color: #666;"></div>
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
  const fileName = document.getElementById('postman-file-name');
  
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


// API Base URL
const API_BASE = '/api';

// Auth state
let currentUser = null;

function authSourceLabel(source) {
  const s = (source || 'local');
  if (s === 'ad') return 'Active Directory';
  if (s === 'pam') return 'OS account';
  return 'Local';
}

function escapeHtmlLite(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function headerEvidenceHtml(headerEvidence) {
  const list = headerEvidence && Array.isArray(headerEvidence.list) ? headerEvidence.list : [];
  if (list.length === 0) return '';
  return `<pre class="header-evidence-block">${list.map((header) => `${escapeHtmlLite(header.name)}: ${escapeHtmlLite(header.value)}`).join('\n')}</pre>`;
}

function traceEvidenceHtml(traceEvidence) {
  const items = traceEvidence && Array.isArray(traceEvidence.items) ? traceEvidence.items : [];
  if (items.length === 0) return '';
  return `<pre class="header-evidence-block">${items.map((item) => `${escapeHtmlLite(item.source || 'header')} ${escapeHtmlLite(item.name)}: ${escapeHtmlLite(item.value)}`).join('\n')}</pre>`;
}

function rateLimitEvidenceHtml(evidence) {
  if (!evidence || !evidence.classification) return '';
  if (evidence.classification === 'setup_auth') {
    return '<p><strong>Rate Limit Validation:</strong> Not Applicable (setup/auth request)</p>';
  }
  const validation = evidence.validation || {};
  const formatVerdict = (windowName) => {
    const verdict = validation[windowName];
    return verdict
      ? `${escapeHtmlLite(verdict.status)} (${escapeHtmlLite(verdict.reason)})`
      : 'inconclusive (not_evaluated)';
  };
  return `<div><strong>Route Rate Limit Validation:</strong>
    <p>Phase: ${escapeHtmlLite(evidence.phase || 'unknown')}</p>
    <p>Second: ${formatVerdict('second')}</p>
    <p>Minute: ${formatVerdict('minute')}</p>
    <p>Global and generic RateLimit headers are diagnostic only.</p>
  </div>`;
}

function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  currentUser = null;
  window.currentUser = null;
}

function hideLoginView() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-container').style.display = '';
}

async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      currentUser = await res.json();
      window.currentUser = currentUser;
      hideLoginView();
      const userNameEl = document.getElementById('user-name');
      const userMenuEl = document.getElementById('user-menu');
      const avatarEl = document.getElementById('user-dropdown-avatar');
      if (userNameEl) userNameEl.textContent = currentUser.display_name || currentUser.username;
      if (userMenuEl) userMenuEl.style.display = 'flex';
      if (avatarEl) {
        const name = currentUser.display_name || currentUser.username || '?';
        avatarEl.textContent = name.charAt(0).toUpperCase();
      }
      const userMgmtItem = document.getElementById('settings-item-user-management');
      if (userMgmtItem) userMgmtItem.style.display = currentUser.is_admin ? 'flex' : 'none';
      const usageItem = document.getElementById('settings-item-usage-analytics');
      if (usageItem) usageItem.style.display = currentUser.is_admin ? 'flex' : 'none';
      // Load user-scoped environments into the in-memory cache
      if (typeof window.loadUserEnvironments === 'function') {
        window.loadUserEnvironments().catch(() => {});
      }
      if (typeof window.loadOnboardingProgress === 'function') {
        window.loadOnboardingProgress().catch(() => {});
      }
      return true;
    }
  } catch (e) {}
  currentUser = null;
  window.currentUser = null;
  showLoginView();
  return false;
}

// Utility functions
window.trackUsage = function trackUsage(action) {
  try {
    fetch(`${API_BASE}/usage-events`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    }).catch(() => {});
  } catch (err) {}
};

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    credentials: 'include',
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
    const data = await response.json().catch(() => ({}));
    
    if (response.status === 401) {
      showLoginView();
      throw new Error('Authentication required');
    }
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

// View management (store previous view so "Back" from Run UI Tests / UI Test Detail returns to it)
function showView(viewId) {
  if (viewId !== 'test-run-detail') {
    clearDetailPolling();
  }
  const activeEl = document.querySelector('.view.active');
  if (activeEl && activeEl.id === 'test-runs-view') {
    clearInterval(window._testRunsRefreshInterval);
    window._testRunsRefreshInterval = null;
    if (viewId !== 'test-runs') {
      window.testRunsEditMode = false;
      const trEditBtn = document.getElementById('toggle-test-runs-edit-mode-btn');
      if (trEditBtn) {
        trEditBtn.textContent = 'Edit mode';
        trEditBtn.setAttribute('aria-pressed', 'false');
        trEditBtn.classList.remove('btn-primary');
        trEditBtn.classList.add('btn-secondary');
      }
    }
  }
  const currentId = activeEl && activeEl.id ? activeEl.id.replace(/-view$/, '') : null;
  if (currentId && currentId !== viewId) {
    window._uiTestsReturnView = currentId;
  }
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  document.getElementById(`${viewId}-view`).classList.add('active');
  if (currentId !== viewId) {
    scrollAppToTop();
  }
  
  // Update nav buttons (Settings gets active when on api-specs or ui-tests)
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const navBtn = document.querySelector(`.main-nav .nav-btn[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
  const settingsNavBtn = document.getElementById('settings-nav-btn');
  if (settingsNavBtn && (viewId === 'api-specs' || viewId === 'ui-tests' || viewId === 'project-access' || viewId === 'postman-to-openapi' || viewId === 'user-management' || viewId === 'usage-analytics')) {
    settingsNavBtn.classList.add('active');
  }
  closeSettingsDropdown();
  closeUserDropdown();
}

function closeSettingsDropdown() {
  const menu = document.getElementById('settings-dropdown-menu');
  const btn = document.getElementById('settings-nav-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeUserDropdown() {
  const container = document.querySelector('.user-dropdown');
  const menu = document.getElementById('user-dropdown-menu');
  const trigger = document.getElementById('user-dropdown-trigger');
  if (container) container.classList.remove('open');
  if (menu) menu.classList.remove('open');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

// Modal management
let modalReturnFocus = null;

function showModal(title, content, purpose) {
  const modal = document.querySelector('#modal-overlay .modal');
  if (modal) modal.className = 'modal';
  document.querySelector('.modal-header-actions')?.remove();
  document.getElementById('modal-title').textContent = title;
  let purposeEl = document.getElementById('modal-purpose');
  if (!purposeEl) {
    purposeEl = document.createElement('p');
    purposeEl.id = 'modal-purpose';
    purposeEl.className = 'modal-purpose';
    document.getElementById('modal-title').insertAdjacentElement('afterend', purposeEl);
  }
  purposeEl.textContent = purpose || '';
  purposeEl.hidden = !purpose;
  const body = document.getElementById('modal-body');
  body.innerHTML = content;
  body.querySelectorAll('.modal-actions, .form-actions').forEach((el) => el.classList.add('action-bar'));
  modalReturnFocus = document.activeElement;
  document.getElementById('modal-overlay').classList.add('active');
  const focusable = body.querySelector('input, select, textarea, button');
  (focusable || document.querySelector('#modal-overlay .modal-close'))?.focus();
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  const back = modalReturnFocus;
  modalReturnFocus = null;
  if (back && typeof back.focus === 'function') back.focus();
}

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = true } = {}) {
  const overlay = document.getElementById('confirm-overlay');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const cancelBtn = document.getElementById('confirm-cancel');
  const okBtn = document.getElementById('confirm-ok');
  if (!overlay || !okBtn || !cancelBtn) return Promise.resolve(false);
  titleEl.textContent = title || 'Confirm';
  messageEl.textContent = message || '';
  okBtn.textContent = confirmLabel;
  okBtn.classList.toggle('btn-danger', !!danger);
  okBtn.classList.toggle('btn-primary', !danger);
  const previous = document.activeElement;
  overlay.classList.add('active');
  cancelBtn.focus();
  return new Promise((resolve) => {
    const finish = (value) => {
      overlay.classList.remove('active');
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      okBtn.removeEventListener('keydown', onOkKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
      resolve(value);
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onBackdrop = (event) => {
      if (event.target === overlay) finish(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && danger) {
        event.preventDefault();
      }
    };
    const onOkKey = (event) => {
      if (danger && event.key === 'Enter') event.preventDefault();
    };
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    okBtn.addEventListener('keydown', onOkKey);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

window.confirmDialog = confirmDialog;

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  const navCollapseBtn = document.getElementById('nav-collapse-btn');
  const appFrame = document.querySelector('.app-frame');
  function setNavCollapsed(collapsed) {
    if (!appFrame || !navCollapseBtn) return;
    appFrame.classList.toggle('nav-collapsed', collapsed);
    navCollapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const label = collapsed ? 'Show navigation' : 'Hide navigation';
    navCollapseBtn.setAttribute('aria-label', label);
    navCollapseBtn.title = label;
    try { localStorage.setItem('qa-nav-collapsed', collapsed ? '1' : '0'); } catch (err) {}
  }
  try {
    if (localStorage.getItem('qa-nav-collapsed') === '1') setNavCollapsed(true);
  } catch (err) {}
  navCollapseBtn?.addEventListener('click', () => {
    setNavCollapsed(!appFrame.classList.contains('nav-collapsed'));
  });

  // Auth: check session first
  await checkAuth();

  document.querySelectorAll('.login-strategy-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const strategy = tab.getAttribute('data-strategy');
      document.getElementById('login-strategy').value = strategy;
      document.querySelectorAll('.login-strategy-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('login-error').style.display = 'none';
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const strategy = document.getElementById('login-strategy').value;
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');
    errEl.style.display = 'none';
    submitBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || 'Login failed';
        errEl.style.display = 'block';
        return;
      }
      await checkAuth();
      if (currentUser) loadViewData('dashboard');
    } catch (err) {
      errEl.textContent = err.message || 'Login failed';
      errEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) {}
    showLoginView();
  });

  document.getElementById('user-dropdown-environments')?.addEventListener('click', () => {
    closeUserDropdown();
    showUserEnvironmentsModal();
  });

  document.getElementById('user-dropdown-profile')?.addEventListener('click', () => {
    closeUserDropdown();
    const u = currentUser || window.currentUser;
    const isLocal = u && u.auth_source === 'local';
    const changePasswordSection = isLocal ? `
      <div class="form-group" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color, #e5e7eb);">
        <h4 style="margin: 0 0 12px 0;">Change password</h4>
        <form id="profile-change-password-form" class="modal-form">
          <div class="form-group">
            <label for="profile-current-password">Current password</label>
            <input type="password" id="profile-current-password" autocomplete="current-password" required />
          </div>
          <div class="form-group">
            <label for="profile-new-password">New password</label>
            <input type="password" id="profile-new-password" minlength="6" autocomplete="new-password" required />
          </div>
          <div class="form-group">
            <label for="profile-new-password-confirm">Confirm new password</label>
            <input type="password" id="profile-new-password-confirm" minlength="6" autocomplete="new-password" required />
          </div>
          <p id="profile-change-password-error" class="login-error" style="display: none;"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Update password</button>
          </div>
        </form>
      </div>
    ` : '<p style="margin-top: 16px; color: var(--text-muted, #6b7280);">Password is managed by your organization (SSO/LDAP).</p>';
    const body = `
      <div class="profile-modal-content">
        <p><strong>Username</strong>: ${(u && u.username) ? String(u.username).replace(/</g, '&lt;') : ''}</p>
        <p><strong>Display name</strong>: ${(u && (u.display_name || u.username)) ? String(u.display_name || u.username).replace(/</g, '&lt;') : ''}</p>
        <p><strong>Sign-in method</strong>: ${u ? authSourceLabel(u.auth_source) : ''}</p>
        ${changePasswordSection}
      </div>
    `;
    showModal('Profile', body);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (btn.id === 'settings-nav-btn') {
        e.preventDefault();
        e.stopPropagation();
        closeUserDropdown();
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

  // User dropdown: toggle on trigger, close Settings when opening
  const userDropdownTrigger = document.getElementById('user-dropdown-trigger');
  if (userDropdownTrigger) {
    userDropdownTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsDropdown();
      const container = document.querySelector('.user-dropdown');
      const menu = document.getElementById('user-dropdown-menu');
      if (container && menu) {
        const isOpen = !menu.classList.contains('open');
        menu.classList.toggle('open', isOpen);
        container.classList.toggle('open', isOpen);
        userDropdownTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    });
  }

  // Close both dropdowns when clicking outside
  document.addEventListener('click', () => {
    closeSettingsDropdown();
    closeUserDropdown();
  });
  document.querySelector('.settings-dropdown')?.addEventListener('click', (e) => e.stopPropagation());
  document.querySelector('.user-dropdown')?.addEventListener('click', (e) => e.stopPropagation());

  // User management: Create user button, form, cancel
  const createUserBtn = document.getElementById('user-management-create-btn');
  const createUserCard = document.getElementById('user-management-create-card');
  const createUserForm = document.getElementById('user-management-create-form');
  const createUserCancel = document.getElementById('user-management-create-cancel');
  if (createUserBtn) {
    createUserBtn.addEventListener('click', () => {
      if (createUserCard) createUserCard.style.display = 'block';
    });
  }
  if (createUserCancel) {
    createUserCancel.addEventListener('click', () => {
      if (createUserCard) createUserCard.style.display = 'none';
      const errEl = document.getElementById('user-management-create-error');
      if (errEl) errEl.style.display = 'none';
    });
  }
  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('new-user-username')?.value?.trim();
      const password = document.getElementById('new-user-password')?.value;
      const display_name = document.getElementById('new-user-display-name')?.value?.trim();
      const is_admin = document.getElementById('new-user-is-admin')?.checked;
      const errEl = document.getElementById('user-management-create-error');
      if (errEl) errEl.style.display = 'none';
      if (!username) {
        if (errEl) { errEl.textContent = 'Username is required.'; errEl.style.display = 'block'; }
        return;
      }
      if (!password || password.length < 6) {
        if (errEl) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; }
        return;
      }
      try {
        await apiRequest('/users', {
          method: 'POST',
          body: { username, password, display_name, is_admin: !!is_admin }
        });
        if (createUserCard) createUserCard.style.display = 'none';
        createUserForm.reset();
        loadUserManagement();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Failed to create user.';
          errEl.style.display = 'block';
        }
      }
    });
  }

  // Postman to OpenAPI: convert and download
  const postmanToOpenApiForm = document.getElementById('postman-to-openapi-form');
  if (postmanToOpenApiForm) {
    postmanToOpenApiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('postman-to-openapi-file');
      const errEl = document.getElementById('postman-to-openapi-error');
      const submitBtn = document.getElementById('postman-to-openapi-submit');
      if (errEl) errEl.style.display = 'none';
      if (!fileInput?.files?.length) {
        if (errEl) { errEl.textContent = 'Please select a Postman collection file.'; errEl.style.display = 'block'; }
        return;
      }
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      submitBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/convert/postman-to-openapi`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        if (!res.ok) {
          const text = await res.text();
          let msg = res.statusText;
          try {
            const data = JSON.parse(text);
            if (data && data.error) msg = data.error;
          } catch (_) {
            if (text && text.length < 200) msg = text;
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        const disp = res.headers.get('Content-Disposition');
        const match = disp && disp.match(/filename="?([^";\n]+)"?/);
        const filename = match ? match[1].trim() : 'converted.openapi.yaml';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Conversion failed.';
          errEl.style.display = 'block';
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // User management: Edit, Change password, Suspend, Delete (delegated)
  document.getElementById('app-container')?.addEventListener('click', async (e) => {
    const list = document.getElementById('user-management-list');
    if (!list || !list.contains(e.target)) return;
    const btn = e.target.closest('[data-action="edit-user"], [data-action="change-password-user"], [data-action="suspend-user"], [data-action="delete-user"]');
    if (!btn) return;
    e.preventDefault();
    const userId = parseInt(btn.getAttribute('data-user-id'), 10);
    if (!userId) return;
    if (btn.getAttribute('data-action') === 'edit-user') {
      const displayName = btn.getAttribute('data-display-name') || '';
      const isAdmin = btn.getAttribute('data-is-admin') === '1';
      const body = `
        <form id="edit-user-form" class="modal-form" data-user-id="${userId}">
          <div class="form-group">
            <label for="edit-user-display-name">Display name</label>
            <input type="text" id="edit-user-display-name" value="${(displayName || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="edit-user-is-admin" ${isAdmin ? 'checked' : ''} />
              Administrator
            </label>
          </div>
          <p id="edit-user-error" class="login-error" style="display: none;"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          </div>
        </form>
      `;
      showModal('Edit user', body);
    } else if (btn.getAttribute('data-action') === 'change-password-user') {
      const body = `
        <form id="change-password-form" class="modal-form" data-user-id="${userId}">
          <div class="form-group">
            <label for="edit-user-password">New password</label>
            <input type="password" id="edit-user-password" minlength="6" autocomplete="new-password" required />
            <p class="form-hint">At least 6 characters.</p>
          </div>
          <div class="form-group">
            <label for="edit-user-password-confirm">Confirm password</label>
            <input type="password" id="edit-user-password-confirm" minlength="6" autocomplete="new-password" required />
          </div>
          <p id="change-password-error" class="login-error" style="display: none;"></p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Update password</button>
            <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          </div>
        </form>
      `;
      showModal('Change password', body);
    } else if (btn.getAttribute('data-action') === 'suspend-user') {
      const currentlySuspended = btn.getAttribute('data-suspended') === '1';
      try {
        await apiRequest('/users/' + userId, { method: 'PATCH', body: { suspended: !currentlySuspended } });
        loadUserManagement();
      } catch (err) {
        alert(err.message || 'Failed to update user');
      }
    } else if (btn.getAttribute('data-action') === 'delete-user') {
      const username = btn.getAttribute('data-username') || 'this user';
      if (!(await confirmDialog({ title: 'Delete user', message: `Delete user “${username}”? This cannot be undone.`, confirmLabel: 'Delete user' }))) return;
      try {
        await apiRequest('/users/' + userId, { method: 'DELETE' });
        loadUserManagement();
      } catch (err) {
        alert(err.message || 'Failed to delete user');
      }
    }
  });

  // Modal form submit: Edit user and Change password
  document.getElementById('modal-overlay')?.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.id === 'edit-user-form') {
      e.preventDefault();
      const userId = form.getAttribute('data-user-id');
      const display_name = document.getElementById('edit-user-display-name')?.value?.trim();
      const is_admin = document.getElementById('edit-user-is-admin')?.checked;
      const errEl = document.getElementById('edit-user-error');
      if (errEl) errEl.style.display = 'none';
      try {
        await apiRequest('/users/' + userId, { method: 'PATCH', body: { display_name: display_name || undefined, is_admin: !!is_admin } });
        hideModal();
        loadUserManagement();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to save.'; errEl.style.display = 'block'; }
      }
    } else if (form.id === 'change-password-form') {
      e.preventDefault();
      const userId = form.getAttribute('data-user-id');
      const password = document.getElementById('edit-user-password')?.value;
      const confirmPassword = document.getElementById('edit-user-password-confirm')?.value;
      const errEl = document.getElementById('change-password-error');
      if (errEl) errEl.style.display = 'none';
      if (!password || password.length < 6) {
        if (errEl) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; }
        return;
      }
      if (password !== confirmPassword) {
        if (errEl) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; }
        return;
      }
      try {
        await apiRequest('/users/' + userId, { method: 'PATCH', body: { password } });
        hideModal();
        loadUserManagement();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to update password.'; errEl.style.display = 'block'; }
      }
    } else if (form.id === 'profile-change-password-form') {
      e.preventDefault();
      const currentPassword = document.getElementById('profile-current-password')?.value;
      const newPassword = document.getElementById('profile-new-password')?.value;
      const confirmPassword = document.getElementById('profile-new-password-confirm')?.value;
      const errEl = document.getElementById('profile-change-password-error');
      if (errEl) errEl.style.display = 'none';
      if (!currentPassword) {
        if (errEl) { errEl.textContent = 'Current password is required.'; errEl.style.display = 'block'; }
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        if (errEl) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.style.display = 'block'; }
        return;
      }
      if (newPassword !== confirmPassword) {
        if (errEl) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; }
        return;
      }
      try {
        await apiRequest('/auth/me/change-password', {
          method: 'POST',
          body: { current_password: currentPassword, new_password: newPassword }
        });
        hideModal();
        alert('Password updated successfully.');
      } catch (err) {
        if (errEl) { errEl.textContent = err.message || 'Failed to update password.'; errEl.style.display = 'block'; }
      }
    }
  });

  // Modal close
  document.querySelector('.modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      hideModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('confirm-overlay')?.classList.contains('active')) return;
    if (document.getElementById('modal-overlay')?.classList.contains('active')) hideModal();
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
      localStorage.setItem('theme', newTheme);
      applyTheme(newTheme);
    });
  }

  // Initial load (only when logged in)
  if (currentUser) loadDashboard();

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
      if (typeof window.viewProject !== 'function') { alert('Cannot run'); return; }
      window.viewProject(Number(projectId));
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

  // Global Test Catalogue filters
  const testsCatApply = document.getElementById('tests-catalogue-apply-btn');
  const testsCatClear = document.getElementById('tests-catalogue-clear-btn');
  if (testsCatApply) {
    testsCatApply.addEventListener('click', () => loadGlobalTestsCatalogue());
  }
  if (testsCatClear) {
    testsCatClear.addEventListener('click', () => {
      const proj = document.getElementById('tests-catalogue-project-filter');
      const type = document.getElementById('tests-catalogue-type-filter');
      const status = document.getElementById('tests-catalogue-status-filter');
      if (proj) proj.value = '';
      if (type) type.value = '';
      if (status) status.value = '';
      loadGlobalTestsCatalogue();
    });
  }
  document.getElementById('dashboard-open-projects')?.addEventListener('click', () => {
    showView('projects');
    loadViewData('projects');
  });
  document.getElementById('dashboard-focus-run')?.addEventListener('click', () => {
    const projectSelect = document.getElementById('run-hub-project');
    document.querySelector('.run-hub-card')?.scrollIntoView({ block: 'nearest' });
    projectSelect?.focus();
  });

  // Project Tests & Coverage filters
  const projectTestsApply = document.getElementById('project-tests-apply-btn');
  const projectTestsClear = document.getElementById('project-tests-clear-btn');
  const projectTestsStatusTrigger = document.getElementById('project-tests-status-trigger');
  const projectTestsStatusMenu = document.getElementById('project-tests-status-menu');
  const projectTestsStatusLabel = document.getElementById('project-tests-status-label');
  const projectTestsStatusHidden = document.getElementById('project-tests-status-filter');

  function syncProjectStatusHiddenFromMenu() {
    if (!projectTestsStatusMenu || !projectTestsStatusHidden) return;
    const checkboxes = Array.from(projectTestsStatusMenu.querySelectorAll('input[type="checkbox"]'));
    const selectedValues = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    Array.from(projectTestsStatusHidden.options || []).forEach(opt => {
      opt.selected = selectedValues.includes(opt.value);
    });
    if (projectTestsStatusLabel) {
      if (selectedValues.length === 0) {
        projectTestsStatusLabel.textContent = 'All statuses';
      } else if (selectedValues.length === 1) {
        const single = checkboxes.find(cb => cb.checked);
        projectTestsStatusLabel.textContent = single ? single.parentElement.textContent.trim() : '1 selected';
      } else {
        projectTestsStatusLabel.textContent = `${selectedValues.length} selected`;
      }
    }
  }

  if (projectTestsStatusTrigger && projectTestsStatusMenu) {
    projectTestsStatusTrigger.addEventListener('click', () => {
      projectTestsStatusMenu.classList.toggle('open');
    });
    projectTestsStatusMenu.addEventListener('change', () => {
      syncProjectStatusHiddenFromMenu();
    });
    document.addEventListener('click', (e) => {
      if (!projectTestsStatusMenu.classList.contains('open')) return;
      const target = e.target;
      if (target instanceof Node) {
        if (!projectTestsStatusMenu.contains(target) && !projectTestsStatusTrigger.contains(target)) {
          projectTestsStatusMenu.classList.remove('open');
        }
      }
    });
    // initialise label
    syncProjectStatusHiddenFromMenu();
  }

  if (projectTestsApply) {
    projectTestsApply.addEventListener('click', () => {
      const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
      const projectId = editModeBtn?.getAttribute('data-project-id');
      if (projectId && typeof renderProjectTestsTable === 'function') {
        renderProjectTestsTable(Number(projectId));
      }
    });
  }
  if (projectTestsClear) {
    projectTestsClear.addEventListener('click', () => {
      const search = document.getElementById('project-tests-search');
      const type = document.getElementById('project-tests-type-filter');
      const folder = document.getElementById('project-tests-folder-filter');
      const status = document.getElementById('project-tests-status-filter');
      if (search) search.value = '';
      if (type) type.value = '';
      if (folder) folder.value = '';
      if (status) {
        Array.from(status.options || []).forEach(o => { o.selected = false; });
      }
      if (projectTestsStatusMenu) {
        Array.from(projectTestsStatusMenu.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
          cb.checked = false;
        });
      }
      if (projectTestsStatusLabel) {
        projectTestsStatusLabel.textContent = 'All statuses';
      }
      const editModeBtn = document.getElementById('toggle-project-tests-edit-mode-btn');
      const projectId = editModeBtn?.getAttribute('data-project-id');
      if (projectId && typeof renderProjectTestsTable === 'function') {
        renderProjectTestsTable(Number(projectId));
      }
    });
  }

  // Test Runs pagination controls
  const testRunsPageSize = document.getElementById('test-runs-page-size');
  const testRunsPrev = document.getElementById('test-runs-prev-page');
  const testRunsNext = document.getElementById('test-runs-next-page');
  if (testRunsPageSize) {
    testRunsPageSize.addEventListener('change', () => {
      window.testRunsCurrentPage = 1;
      if (Array.isArray(window.testRunsData)) {
        renderTestRunsList(window.testRunsData);
      }
    });
  }
  if (testRunsPrev) {
    testRunsPrev.addEventListener('click', () => {
      if (!Array.isArray(window.testRunsData) || !window.testRunsData.length) return;
      window.testRunsCurrentPage = Math.max((window.testRunsCurrentPage || 1) - 1, 1);
      renderTestRunsList(window.testRunsData);
      scrollAppToTop();
    });
  }
  if (testRunsNext) {
    testRunsNext.addEventListener('click', () => {
      if (!Array.isArray(window.testRunsData) || !window.testRunsData.length) return;
      const pageSizeSelect = document.getElementById('test-runs-page-size');
      const pageSize = pageSizeSelect ? parseInt(pageSizeSelect.value, 10) || 50 : 50;
      const total = window.testRunsData.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      window.testRunsCurrentPage = Math.min((window.testRunsCurrentPage || 1) + 1, totalPages);
      renderTestRunsList(window.testRunsData);
      scrollAppToTop();
    });
  }

  const toggleTestRunsEditBtn = document.getElementById('toggle-test-runs-edit-mode-btn');
  if (toggleTestRunsEditBtn) {
    toggleTestRunsEditBtn.addEventListener('click', () => {
      window.testRunsEditMode = !window.testRunsEditMode;
      toggleTestRunsEditBtn.textContent = window.testRunsEditMode ? 'Done editing' : 'Edit mode';
      toggleTestRunsEditBtn.setAttribute('aria-pressed', window.testRunsEditMode ? 'true' : 'false');
      toggleTestRunsEditBtn.classList.toggle('btn-primary', window.testRunsEditMode);
      toggleTestRunsEditBtn.classList.toggle('btn-secondary', !window.testRunsEditMode);
      if (Array.isArray(window.testRunsData)) {
        renderTestRunsList(window.testRunsData);
      }
    });
  }

  // Footer collapsible toggle
  const appFooterToggle = document.getElementById('app-footer-toggle');
  const appFooter = document.getElementById('app-footer');
  if (appFooterToggle && appFooter) {
    appFooterToggle.addEventListener('click', () => {
      const isCollapsed = appFooter.classList.toggle('collapsed');
      appFooterToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      appFooterToggle.setAttribute('title', isCollapsed ? 'Expand footer' : 'Collapse footer');
    });
  }

  // Dashboard: click or Enter/Space on a next-scheduled item opens edit schedule modal
  document.getElementById('app-container')?.addEventListener('click', (e) => {
    const item = e.target.closest('#next-scheduled-list .next-scheduled-item');
    if (item && typeof editSchedule === 'function') {
      const scheduleId = parseInt(item.getAttribute('data-schedule-id'), 10);
      const projectId = parseInt(item.getAttribute('data-project-id'), 10);
      if (scheduleId && projectId) editSchedule(scheduleId, projectId);
    }
  });
  document.getElementById('app-container')?.addEventListener('keydown', (e) => {
    const item = e.target.closest('#next-scheduled-list .next-scheduled-item');
    if (item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (typeof editSchedule === 'function') {
        const scheduleId = parseInt(item.getAttribute('data-schedule-id'), 10);
        const projectId = parseInt(item.getAttribute('data-project-id'), 10);
        if (scheduleId && projectId) editSchedule(scheduleId, projectId);
      }
    }
  });

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
    case 'project-access':
      loadProjectAccess();
      break;
    case 'user-management':
      loadUserManagement();
      break;
    case 'usage-analytics':
      loadUsageAnalytics();
      break;
    case 'tests-catalogue':
      loadGlobalTestsCatalogue();
      break;
  }
  const usageByView = {
    dashboard: 'open_dashboard',
    projects: 'open_projects',
    'test-runs': 'open_test_runs',
    'tests-catalogue': 'open_tests_catalogue'
  };
  if (usageByView[view]) window.trackUsage(usageByView[view]);
}

// Global Test Catalogue / Coverage view
async function loadGlobalTestsCatalogue() {
  const projectSelect = document.getElementById('tests-catalogue-project-filter');
  const typeSelect = document.getElementById('tests-catalogue-type-filter');
  const statusSelect = document.getElementById('tests-catalogue-status-filter');
  const metricsEl = document.getElementById('tests-catalogue-metrics');
  const tableEl = document.getElementById('tests-catalogue-table');
  if (!projectSelect || !typeSelect || !statusSelect || !metricsEl || !tableEl) return;

  try {
    // Populate projects dropdown
    const projects = await apiRequest('/projects');
    const currentProject = projectSelect.value || '';
    projectSelect.innerHTML = '<option value=\"\">All Projects</option>' +
      (projects || []).map(p => `<option value=\"${p.id}\" ${String(p.id) === String(currentProject) ? 'selected' : ''}>${(p.name || '').replace(/</g, '&lt;')}</option>`).join('');

    const params = new URLSearchParams();
    const projectId = projectSelect.value;
    const type = typeSelect.value;
    const status = statusSelect.value;
    if (projectId) params.append('projectId', projectId);
    if (type) params.append('test_type', type);
    if (status) params.append('last_status', status);

    tableEl.innerHTML = '<p class=\"muted\">Loading tests…</p>';
    metricsEl.innerHTML = '';

    const tests = await apiRequest(`/tests/catalogue?${params.toString()}`);
    if (!tests || tests.length === 0) {
      tableEl.innerHTML = `
        <div class=\"empty-state\">
          <p>No tests match the current filters.</p>
        </div>
      `;
      metricsEl.innerHTML = '';
      return;
    }

    // Compute coverage metrics based only on ACTIVE tests to match per-project coverage logic
    const activeTests = tests.filter(t => t.is_active);
    if (activeTests.length === 0) {
      tableEl.innerHTML = `
        <div class=\"empty-state\">
          <p>No active tests match the current filters.</p>
        </div>
      `;
      metricsEl.innerHTML = '';
      return;
    }
    const total = activeTests.length;
    const passed = activeTests.filter(t => t.stats && t.stats.last_status === 'passed').length;
    const failed = activeTests.filter(t => t.stats && (t.stats.last_status === 'failed' || t.stats.last_status === 'partial_failed')).length;
    const coveredNow = passed + failed;
    const neverRun = total > 0 ? Math.max(total - coveredNow, 0) : 0;
    const coveragePct = total > 0 ? Math.round((coveredNow / total) * 100) : 0;
    const successPct = total > 0 ? Math.round((passed / total) * 100) : 0;

    metricsEl.innerHTML = `
      <div class=\"dashboard-stats tests-catalogue-stats\">
        <div class=\"stat-card\">
          <div class=\"stat-value\">${total}</div>
          <div class=\"stat-label\">Active tests in coverage</div>
        </div>
        <div class=\"stat-card\">
          <div class=\"stat-value stat-value-success\">${passed}</div>
          <div class=\"stat-label\">Total tests passed</div>
          <div class=\"stat-subtext\">${successPct}% of active tests</div>
        </div>
        <div class=\"stat-card\">
          <div class=\"stat-value stat-value-error\">${failed}</div>
          <div class=\"stat-label\">Total tests failed / partial</div>
          <div class=\"stat-subtext\">${coveragePct}% coverage (passed / failed)</div>
        </div>
        <div class=\"stat-card\">
          <div class=\"stat-value stat-value-muted\">${neverRun}</div>
          <div class=\"stat-label\">Not yet run</div>
          <div class=\"stat-subtext\">Active tests with no covered runs yet</div>
        </div>
      </div>
    `;

    const rows = activeTests.map(t => {
      const stats = t.stats || {};
      const lastStatus = stats.last_status || 'not_run';
      const lastRunAt = stats.last_run_at ? formatDateTime(stats.last_run_at) : '—';
      const totalRuns = stats.total_runs != null ? stats.total_runs : 0;
      const typeLabel =
        t.source_kind === 'manual' ? 'Manual Test' :
        t.test_type === 'soap' ? 'SOAP' :
        t.test_type === 'ui_builtin' ? 'UI (built-in)' :
        t.test_type === 'ui_recorded' ? 'UI (recorded)' :
        t.test_type === 'other' ? 'Other' :
        'API';
      const projectName = t.project && t.project.name ? t.project.name : (t.project_id || '');
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
      const lastRunId = stats.last_run_id;
      const lastRunType = stats.last_run_type || stats.last_run_source || '';
      const historyBtn = lastRunId
        ? `<button type="button" class="btn btn-outline btn-sm" onclick='window.openLastRunForTest(${lastRunId}, ${JSON.stringify(String(lastRunType))})'>History</button>`
        : `<button type="button" class="btn btn-outline btn-sm" disabled title="No run yet">History</button>`;
      const actions = `<div class="project-test-row-actions">${historyBtn}</div>`;
      return `
        <tr>
          <td>${escapeHtml(projectName)}</td>
          <td>${typeLabel}</td>
          <td>${escapeHtml(t.name || '')}</td>
          <td><span class=\"status-badge ${statusClass}\">${lastStatus}</span></td>
          <td>${lastRunAt}</td>
          <td>${totalRuns}</td>
          <td class="project-test-actions-cell">${actions}</td>
        </tr>
      `;
    }).join('');

    tableEl.innerHTML = `
      <div class=\"table-responsive\">
        <table class=\"table\">
          <thead>
            <tr>
              <th>Project</th>
              <th>Type</th>
              <th>Name</th>
              <th>Last status</th>
              <th>Last run</th>
              <th>Total runs</th>
              <th>History</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Error loading global test catalogue:', err);
    metricsEl.innerHTML = '';
    tableEl.innerHTML = '<div class=\"empty-state\"><p>Failed to load test catalogue.</p></div>';
  }
}

async function loadProjectAccess() {
  const listEl = document.getElementById('project-access-list');
  if (!listEl) return;
  try {
    const [projects, users] = await Promise.all([
      apiRequest('/projects'),
      apiRequest('/users')
    ]);
    const canManage = (p) => currentUser && (currentUser.is_admin || (p.owner && p.owner.id === currentUser.id));
    const manageable = projects.filter(canManage);
    if (manageable.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No projects you can manage. Create a project from the Projects view.</p>';
      return;
    }
    listEl.innerHTML = manageable.map(p => {
      const sharedIds = (p.members || p.shared_users || []).map(u => u.id);
      const sharedOpts = (users || []).filter(u => u.id !== (p.owner && p.owner.id)).map(u =>
        `<option value="${u.id}" ${sharedIds.includes(u.id) ? 'selected' : ''}>${u.display_name || u.username}</option>`
      ).join('');
      const vis = (p.visibility || 'private');
      return `
        <div class="project-access-card" data-project-id="${p.id}">
          <div class="project-access-card-header">
            <h3>${(p.name || '').replace(/</g, '&lt;')}</h3>
            <span class="visibility-badge visibility-${vis}">${vis === 'private' ? 'Private' : vis === 'shared' ? 'Shared' : 'Public'}</span>
          </div>
          <div class="form-group">
            <label>Visibility</label>
            <select class="project-access-visibility" data-project-id="${p.id}">
              <option value="private" ${vis === 'private' ? 'selected' : ''}>Private (only you)</option>
              <option value="shared" ${vis === 'shared' ? 'selected' : ''}>Shared (selected users)</option>
              <option value="public" ${vis === 'public' ? 'selected' : ''}>Public (all users)</option>
            </select>
          </div>
          <div class="form-group project-access-shared-wrap" data-project-id="${p.id}" style="display: ${vis === 'shared' ? 'block' : 'none'};">
            <label>Shared with</label>
            <select class="project-access-shared-users" multiple size="3" data-project-id="${p.id}">
              ${sharedOpts}
            </select>
          </div>
          <button type="button" class="btn btn-primary project-access-save-btn" data-project-id="${p.id}">Save</button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.project-access-visibility').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-project-id');
        const wrap = listEl.querySelector(`.project-access-shared-wrap[data-project-id="${id}"]`);
        if (wrap) wrap.style.display = e.target.value === 'shared' ? 'block' : 'none';
      });
    });
    listEl.querySelectorAll('.project-access-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const projectId = btn.getAttribute('data-project-id');
        const visibility = listEl.querySelector(`.project-access-visibility[data-project-id="${projectId}"]`)?.value || 'private';
        const sharedSel = listEl.querySelector(`.project-access-shared-users[data-project-id="${projectId}"]`);
        const shared_user_ids = sharedSel ? Array.from(sharedSel.selectedOptions).map(o => Number(o.value)) : [];
        btn.disabled = true;
        try {
          await apiRequest(`/projects/${projectId}`, {
            method: 'PUT',
            body: { visibility, shared_user_ids }
          });
          loadProjectAccess();
        } catch (err) {
          alert('Failed to save: ' + (err.message || 'Unknown error'));
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = '<p class="empty-state">Failed to load projects.</p>';
  }
}

function usageCountCell(value) {
  const count = Number(value) || 0;
  return `<td>${count}</td>`;
}

function renderUsageTable(title, columns, rows, valueFor) {
  const head = columns.map((column) => `<th>${escapeHtmlLite(column.label)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = columns.map((column) => usageCountCell(valueFor(row, column.key))).join('');
    const name = escapeHtmlLite(row.name || row.username || 'Unknown');
    const username = row.username && row.username !== row.name
      ? `<span class="usage-analytics-username">${escapeHtmlLite(row.username)}</span>`
      : '';
    return `<tr><th scope="row">${name}${username}</th>${cells}</tr>`;
  }).join('');
  return `
    <h3 class="usage-analytics-heading">${escapeHtmlLite(title)}</h3>
    <div class="table-responsive">
      <table class="table usage-analytics-table">
        <thead><tr><th>User</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

async function loadUsageAnalytics() {
  const adminOnly = document.getElementById('usage-analytics-admin-only');
  const content = document.getElementById('usage-analytics-content');
  const runsEl = document.getElementById('usage-analytics-runs');
  const actionsEl = document.getElementById('usage-analytics-actions');
  if (!currentUser || !currentUser.is_admin) {
    if (adminOnly) adminOnly.style.display = 'block';
    if (content) content.style.display = 'none';
    return;
  }
  if (adminOnly) adminOnly.style.display = 'none';
  if (content) content.style.display = 'block';
  if (runsEl) runsEl.innerHTML = '<p class="projects-view-subtitle">Loading usage…</p>';
  if (actionsEl) actionsEl.innerHTML = '';
  try {
    const report = await apiRequest('/usage-analytics');
    const users = Array.isArray(report.users) ? report.users : [];
    const runTypes = Array.isArray(report.runTypes) ? report.runTypes : [];
    const actions = Array.isArray(report.actions) ? report.actions : [];
    if (runsEl) {
      runsEl.innerHTML = renderUsageTable('Tests run', runTypes, users, (row, key) => row.runs?.[key]);
    }
    if (actionsEl) {
      actionsEl.innerHTML = renderUsageTable('Operations used', actions, users, (row, key) => row.actions?.[key]);
    }
  } catch (error) {
    if (runsEl) runsEl.innerHTML = `<p class="empty-state">Could not load usage analytics.</p>`;
    if (actionsEl) actionsEl.innerHTML = '';
  }
}

async function loadUserManagement() {
  const adminOnlyMsg = document.getElementById('user-management-admin-only-msg');
  const content = document.getElementById('user-management-content');
  const createBtn = document.getElementById('user-management-create-btn');
  const createCard = document.getElementById('user-management-create-card');
  const listEl = document.getElementById('user-management-list');

  if (!currentUser || !currentUser.is_admin) {
    if (adminOnlyMsg) adminOnlyMsg.style.display = 'block';
    if (content) content.style.display = 'none';
    if (createBtn) createBtn.style.display = 'none';
    return;
  }

  if (adminOnlyMsg) adminOnlyMsg.style.display = 'none';
  if (content) content.style.display = 'block';
  if (createBtn) createBtn.style.display = 'inline-flex';

  try {
    const users = await apiRequest('/users');
    if (!listEl) return;
    if (!users || users.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No users yet. Create one below.</p>';
    } else {
      const currentUserId = currentUser ? currentUser.id : null;
      listEl.innerHTML = users.map(u => {
        const adminBadge = u.is_admin ? '<span class="visibility-badge visibility-shared">Admin</span>' : '';
        const suspendedBadge = u.suspended ? '<span class="status-badge failed">Suspended</span>' : '';
        const source = u.auth_source || 'local';
        const isSelf = u.id === currentUserId;
        const displayName = (u.display_name || u.username || '').replace(/</g, '&lt;');
        const username = (u.username || '').replace(/</g, '&lt;');
        const editBtn = '<button type="button" class="btn btn-secondary btn-sm" data-action="edit-user" data-user-id="' + u.id + '" data-display-name="' + (u.display_name || '').replace(/"/g, '&quot;') + '" data-is-admin="' + (u.is_admin ? '1' : '0') + '" title="Edit name and role">Edit</button>';
        const pwdBtn = source === 'local' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="change-password-user" data-user-id="' + u.id + '" title="Change password">Change password</button>' : '';
        const suspendBtn = !isSelf ? '<button type="button" class="btn btn-secondary btn-sm" data-action="suspend-user" data-user-id="' + u.id + '" data-suspended="' + (u.suspended ? '1' : '0') + '" title="' + (u.suspended ? 'Unsuspend user' : 'Suspend user') + '">' + (u.suspended ? 'Unsuspend' : 'Suspend') + '</button>' : '';
        const deleteBtn = !isSelf ? '<button type="button" class="btn btn-danger btn-sm" data-action="delete-user" data-user-id="' + u.id + '" data-username="' + username.replace(/"/g, '&quot;') + '" title="Delete user">Delete</button>' : '';
        return `
          <div class="list-item user-management-item" data-user-id="${u.id}">
            <div class="list-item-info">
              <h3>${displayName} ${adminBadge} ${suspendedBadge}</h3>
              <p>${username} · ${authSourceLabel(source)}</p>
            </div>
            <div class="list-item-actions">
              ${editBtn}
              ${pwdBtn}
              ${suspendBtn}
              ${deleteBtn}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    listEl.innerHTML = '<p class="empty-state">Failed to load users.</p>';
  }
}

// ===== My Environments modal — master-detail layout =====
function showUserEnvironmentsModal() {
  let searchText = '', sortMode = 'name', typeFilter = 'all';
  let selectedEnvId = null, revealSecrets = false, varFilterText = '';

  const UI_TEST_VARIABLES_STORAGE_KEY = 'qa_ui_test_variable_groups';

  function loadUiEnvironmentGroups() {
    if (typeof window.getSavedUiTestVariableGroups === 'function') {
      return window.getSavedUiTestVariableGroups();
    }
    try {
      const raw = localStorage.getItem(UI_TEST_VARIABLES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((group) => group && group.id && group.name) : [];
    } catch (_) {
      return [];
    }
  }

  function saveUiEnvironmentGroups(groups) {
    localStorage.setItem(UI_TEST_VARIABLES_STORAGE_KEY, JSON.stringify(Array.isArray(groups) ? groups : []));
  }

  function getEnvironmentItems() {
    const apiItems = (window._userEnvsCache || []).map((env) => ({
      id: `api:${env.id}`,
      rawId: String(env.id),
      kind: 'api',
      typeLabel: 'API',
      usedBy: 'API collection tests',
      name: env.name || 'Unnamed environment',
      variables: Object.fromEntries(Object.entries(env || {}).filter(([key]) => key !== 'id' && key !== 'name')),
      original: env
    }));
    const uiItems = loadUiEnvironmentGroups().map((group) => ({
      id: `ui:${group.id}`,
      rawId: String(group.id),
      kind: 'ui',
      typeLabel: 'UI',
      usedBy: 'UI recorded tests',
      name: group.name || 'Unnamed UI environment',
      variables: group.variables && typeof group.variables === 'object' ? group.variables : {},
      original: group
    }));
    return [...apiItems, ...uiItems];
  }

  function envEntries(env) {
    const source = env && env.variables && typeof env.variables === 'object' ? env.variables : env;
    return Object.entries(source || {}).filter(([key]) => key !== 'id' && key !== 'name');
  }

  function isSensitiveKey(key) {
    return /token|secret|jwt|password|authorization|bearer|api[_-]?key|private/i.test(String(key || ''));
  }

  function displayValue(key, value, revealSecrets) {
    if (isSensitiveKey(key) && !revealSecrets) return '********';
    if (value == null || String(value) === '') return 'empty';
    return String(value);
  }

  function variableLabel(count) {
    return `${count} variable${count === 1 ? '' : 's'}`;
  }

  function getFilteredEnvs() {
    const query = searchText.trim().toLowerCase();
    let envs = getEnvironmentItems();
    if (typeFilter !== 'all') envs = envs.filter(e => e.kind === typeFilter);
    if (query) envs = envs.filter(e => {
      const keys = envEntries(e).map(([k]) => k.toLowerCase());
      return String(e.name).toLowerCase().includes(query)
        || String(e.typeLabel).toLowerCase().includes(query)
        || keys.some(k => k.includes(query));
    });
    envs.sort((a, b) => sortMode === 'variables'
      ? envEntries(b).length - envEntries(a).length || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name));
    return envs;
  }

  function buildUniqueCopyName(baseName) {
    const names = new Set(getEnvironmentItems().map(e => e.name.toLowerCase()));
    let candidate = `Copy of ${baseName || 'Environment'}`;
    let suffix = 2;
    while (names.has(candidate.toLowerCase())) { candidate = `Copy of ${baseName || 'Environment'} ${suffix}`; suffix++; }
    return candidate;
  }

  function findEnvironmentItem(id) { return getEnvironmentItems().find(e => String(e.id) === String(id)); }

  function duplicateUiEnvironment(group) {
    const groups = loadUiEnvironmentGroups();
    saveUiEnvironmentGroups([...groups, { id: `ui-var-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: buildUniqueCopyName(group.name || ''), variables: { ...(group.variables || {}) } }]);
  }

  function deleteUiEnvironment(groupId) {
    saveUiEnvironmentGroups(loadUiEnvironmentGroups().filter(g => String(g.id) !== String(groupId)));
  }

  function openUiEnvironmentManager(groupId = '') {
    hideModal();
    setTimeout(() => {
      if (typeof window.showUiTestVariableGroupsManager === 'function') {
        window.showUiTestVariableGroupsManager(() => { open(); }, groupId || '', { proposedVariables: [] });
      } else {
        alert('UI environment manager is not available. Refresh and try again.'); open();
      }
    }, 50);
  }

  function exportCombinedEnvironments() {
    const items = getEnvironmentItems();
    if (!items.length) { alert('No environments to export.'); return; }
    const payload = items.map(e => ({ name: e.name, type: e.kind, variables: Object.fromEntries(envEntries(e)) }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'my-environments-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta);
    ta.focus(); ta.select(); document.execCommand('copy'); ta.remove();
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────

  function renderSidebarItems() {
    const envs = getFilteredEnvs();
    if (!envs.length) {
      const msg = typeFilter !== 'all' || searchText.trim()
        ? 'No environments match.'
        : 'No environments saved. Click <strong>New API</strong> or <strong>New UI</strong>.';
      return `<p class="user-env-empty">${msg}</p>`;
    }
    return envs.map(e => {
      const envId = e.id;
      const count = envEntries(e).length;
      return `
        <button type="button" class="user-env-sidebar-item${selectedEnvId === envId ? ' active' : ''}" data-env-id="${escapeHtmlLite(envId)}">
          <span class="user-env-sidebar-item-body">
            <span class="user-env-sidebar-item-name">${escapeHtmlLite(e.name)}</span>
            <span class="user-env-kind-badge user-env-kind-${escapeHtmlLite(e.kind)}">${escapeHtmlLite(e.typeLabel)}</span>
          </span>
          <span class="user-env-sidebar-item-meta">${count} var${count === 1 ? '' : 's'}</span>
        </button>
      `;
    }).join('');
  }

  function updateSidebar() {
    const el = document.getElementById('user-env-sidebar-list');
    if (!el) return;
    el.innerHTML = renderSidebarItems();
    el.querySelectorAll('.user-env-sidebar-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-env-id');
        if (selectedEnvId === id) { selectedEnvId = null; } else { selectedEnvId = id; varFilterText = ''; revealSecrets = false; }
        updateSidebar();
        updateDetail();
      });
    });
  }

  // ── Detail panel ──────────────────────────────────────────────────────────

  function renderDetailPanel() {
    if (!selectedEnvId) return `
      <div class="user-env-detail-empty">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V7M4 7a2 2 0 012-2h12a2 2 0 012 2M4 7h16M10 12h4" />
        </svg>
        <p>Select an environment from the list to view and manage its variables.</p>
      </div>`;

    const env = findEnvironmentItem(selectedEnvId);
    if (!env) return `<div class="user-env-detail-empty"><p>Environment not found.</p></div>`;

    const entries = envEntries(env);
    const q = varFilterText.trim().toLowerCase();
    const filtered = q ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v || '').toLowerCase().includes(q)) : entries;
    const hasSensitive = entries.some(([k]) => isSensitiveKey(k));

    const rowsHtml = filtered.length
      ? filtered.map(([k, v]) => `
          <div class="user-env-var-key">${escapeHtmlLite(k)}</div>
          <div class="user-env-var-value${isSensitiveKey(k) && !revealSecrets ? ' user-env-secret' : ''}">${escapeHtmlLite(displayValue(k, v, revealSecrets))}</div>
        `).join('')
      : `<div class="user-env-var-empty" style="grid-column:1/-1;">${q ? 'No variables match this filter.' : 'No variables saved in this environment.'}</div>`;

    return `
      <div class="user-env-detail-header">
        <div class="user-env-detail-title">
          <div class="user-env-title-line">
            <h3>${escapeHtmlLite(env.name)}</h3>
            <span class="user-env-kind-badge user-env-kind-${escapeHtmlLite(env.kind)}">${escapeHtmlLite(env.typeLabel)}</span>
          </div>
          <p class="muted">${variableLabel(entries.length)} · ${escapeHtmlLite(env.usedBy)}</p>
        </div>
        <div class="user-env-detail-actions">
          <button type="button" class="btn btn-sm btn-secondary user-env-edit">Edit</button>
          <button type="button" class="btn btn-sm btn-secondary user-env-copy-json">Copy JSON</button>
          <button type="button" class="btn btn-sm btn-secondary user-env-duplicate">Duplicate</button>
          <button type="button" class="btn btn-sm btn-danger user-env-delete">Delete</button>
        </div>
      </div>
      <div class="user-env-detail-toolbar">
        <input type="search" id="user-env-var-search" class="form-control" placeholder="Filter variables…" value="${escapeHtmlLite(varFilterText)}" autocomplete="off">
        ${hasSensitive ? `<button type="button" class="btn btn-sm btn-secondary" id="user-env-reveal-toggle">${revealSecrets ? 'Hide values' : 'Show values'}</button>` : ''}
      </div>
      <div class="user-env-var-grid user-env-detail-grid">
        ${rowsHtml}
      </div>
    `;
  }

  function updateDetail() {
    const el = document.getElementById('user-env-detail-panel');
    if (!el) return;
    el.innerHTML = renderDetailPanel();
    document.getElementById('user-env-var-search')?.addEventListener('input', ev => { varFilterText = ev.target.value || ''; updateDetail(); });
    document.getElementById('user-env-reveal-toggle')?.addEventListener('click', () => { revealSecrets = !revealSecrets; updateDetail(); });
    document.querySelector('.user-env-copy-json')?.addEventListener('click', async () => {
      const env = findEnvironmentItem(selectedEnvId);
      if (!env) return;
      try {
        await copyText(JSON.stringify({ name: env.name, type: env.kind, variables: Object.fromEntries(envEntries(env)) }, null, 2));
        const btn = document.querySelector('.user-env-copy-json');
        if (btn) { const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = t; }, 1200); }
      } catch (err) { alert('Could not copy: ' + (err.message || err)); }
    });
    document.querySelector('.user-env-duplicate')?.addEventListener('click', async () => {
      const env = findEnvironmentItem(selectedEnvId);
      if (!env) return;
      if (env.kind === 'ui') { duplicateUiEnvironment(env.original); updateSidebar(); return; }
      try {
        const payload = { name: buildUniqueCopyName(env.name), ...Object.fromEntries(envEntries(env)) };
        if (typeof createSavedEnv === 'function') await createSavedEnv(payload);
        else { const cr = await apiRequest('/user/environments', { method: 'POST', body: payload }); window._userEnvsCache = [...(window._userEnvsCache || []), cr]; }
        if (typeof populateEnvSelect === 'function') populateEnvSelect();
        updateSidebar();
      } catch (err) { alert('Error duplicating: ' + (err.message || err)); }
    });
    document.querySelector('.user-env-delete')?.addEventListener('click', async () => {
      const env = findEnvironmentItem(selectedEnvId);
      if (!env) return;
      if (!(await confirmDialog({ title: 'Delete environment', message: `Delete "${env.name}" with ${variableLabel(envEntries(env).length)}?`, confirmLabel: 'Delete environment' }))) return;
      if (env.kind === 'ui') { deleteUiEnvironment(env.rawId); selectedEnvId = null; updateSidebar(); updateDetail(); return; }
      try {
        if (typeof deleteSavedEnv === 'function') await deleteSavedEnv(env.rawId);
        else { await apiRequest(`/user/environments/${env.rawId}`, { method: 'DELETE' }); window._userEnvsCache = (window._userEnvsCache || []).filter(e => String(e.id) !== String(env.rawId)); }
        if (typeof populateEnvSelect === 'function') populateEnvSelect();
        selectedEnvId = null; updateSidebar(); updateDetail();
      } catch (err) { alert('Error deleting: ' + (err.message || err)); }
    });
    document.querySelector('.user-env-edit')?.addEventListener('click', () => {
      const env = findEnvironmentItem(selectedEnvId);
      if (!env) return;
      if (env.kind === 'ui') { openUiEnvironmentManager(env.rawId); return; }
      hideModal();
      setTimeout(() => openEnvEditor(env.original, open), 50);
    });
  }

  // ── Modal shell ───────────────────────────────────────────────────────────

  function open() {
    const content = `
      <div class="user-env-manager-layout">
        <aside class="user-env-sidebar">
          <div class="user-env-sidebar-toolbar">
            <input type="search" id="user-env-search" class="form-control" placeholder="Search…" value="${escapeHtmlLite(searchText)}" autocomplete="off">
            <select id="user-env-sort" class="form-control" aria-label="Sort">
              <option value="name" ${sortMode === 'name' ? 'selected' : ''}>Name A-Z</option>
              <option value="variables" ${sortMode === 'variables' ? 'selected' : ''}>Most variables</option>
            </select>
          </div>
          <div class="user-env-type-tabs">
            <button type="button" class="user-env-type-tab ${typeFilter === 'all' ? 'active' : ''}" data-env-type="all">All</button>
            <button type="button" class="user-env-type-tab ${typeFilter === 'api' ? 'active' : ''}" data-env-type="api">API</button>
            <button type="button" class="user-env-type-tab ${typeFilter === 'ui' ? 'active' : ''}" data-env-type="ui">UI</button>
          </div>
          <div id="user-env-sidebar-list" class="user-env-sidebar-list"></div>
        </aside>
        <div class="user-env-detail" id="user-env-detail-panel"></div>
      </div>
      <div class="user-env-footer">
        <div class="user-env-footer-actions">
          <button class="btn btn-primary btn-sm" id="user-env-new-btn">New API</button>
          <button class="btn btn-secondary btn-sm" id="user-env-new-ui-btn">New UI</button>
          <button class="btn btn-secondary btn-sm" id="user-env-export-btn">Export</button>
          <label class="btn btn-secondary btn-sm user-env-import-label">Import<input type="file" id="user-env-import-input" accept=".json,application/json" style="display:none;"></label>
        </div>
        <button class="btn btn-secondary" id="user-envs-close-btn">Close</button>
      </div>
    `;
    showModal('My Environments', content);
    updateSidebar();
    updateDetail();
    document.getElementById('user-envs-close-btn')?.addEventListener('click', hideModal);
    document.getElementById('user-env-search')?.addEventListener('input', ev => { searchText = ev.target.value || ''; updateSidebar(); });
    document.getElementById('user-env-sort')?.addEventListener('change', ev => { sortMode = ev.target.value || 'name'; updateSidebar(); });
    document.querySelectorAll('.user-env-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        typeFilter = tab.getAttribute('data-env-type') || 'all';
        document.querySelectorAll('.user-env-type-tab').forEach(t => t.classList.toggle('active', t === tab));
        updateSidebar();
      });
    });
    document.getElementById('user-env-new-btn')?.addEventListener('click', () => { hideModal(); setTimeout(() => openEnvEditor(null, open), 50); });
    document.getElementById('user-env-new-ui-btn')?.addEventListener('click', () => { openUiEnvironmentManager(''); });
    document.getElementById('user-env-export-btn')?.addEventListener('click', () => { exportCombinedEnvironments(); });
    document.getElementById('user-env-import-input')?.addEventListener('change', async ev => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      ev.target.value = '';
      let parsed;
      try { const text = await file.text(); parsed = JSON.parse(text); }
      catch { alert('Invalid JSON file.'); return; }
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items.filter(item => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim());
      if (!valid.length) { alert('No valid environments found.'); return; }
      let created = 0, skipped = 0, errors = 0;
      for (const item of valid) {
        const name = item.name.trim();
        const itemType = String(item.type || 'api').toLowerCase() === 'ui' ? 'ui' : 'api';
        const vars = (item.variables && typeof item.variables === 'object') ? item.variables : {};
        if (itemType === 'ui') {
          const groups = loadUiEnvironmentGroups();
          if (groups.find(g => g.name === name)) { skipped++; continue; }
          saveUiEnvironmentGroups([...groups, { id: `ui-var-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, variables: vars }]);
          created++; continue;
        }
        const existing = (window._userEnvsCache || []).find(e => e.name === name);
        try {
          if (existing) { skipped++; }
          else {
            if (typeof createSavedEnv === 'function') await createSavedEnv({ name, ...vars });
            else { const cr = await apiRequest('/user/environments', { method: 'POST', body: { name, ...vars } }); window._userEnvsCache = [...(window._userEnvsCache || []), cr]; }
            created++;
          }
        } catch { errors++; }
      }
      const parts = ['Import complete:'];
      if (created) parts.push(`  \u2022 ${created} created`);
      if (skipped) parts.push(`  \u2022 ${skipped} skipped`);
      if (errors) parts.push(`  \u2022 ${errors} failed`);
      alert(parts.join('\n'));
      selectedEnvId = null; updateSidebar(); updateDetail();
    });
  }

  function openEnvEditor(existingEnv, onBack) {
    const escapedName = existingEnv ? escapeHtmlLite(existingEnv.name || '') : '';

    // Build rows from existing variables (exclude id/name)
    const existingVars = existingEnv
      ? Object.entries(existingEnv).filter(([k]) => k !== 'id' && k !== 'name')
      : [];

    function varRowHtml(k = '', v = '') {
      return `
        <div class="user-env-var-row">
          <input type="text" class="user-env-var-key form-control" placeholder="Variable name" value="${escapeHtmlLite(k)}">
          <input type="text" class="user-env-var-val form-control" placeholder="Value" value="${escapeHtmlLite(v)}">
          <button type="button" class="btn btn-sm btn-danger user-env-var-remove">×</button>
        </div>
      `;
    }

    const content = `
      <form id="user-env-editor-form">
        <div class="form-group" style="margin-bottom:14px;">
          <label for="user-env-name-input">Environment name *</label>
          <input type="text" id="user-env-name-input" class="form-control" value="${escapedName}" placeholder="e.g. Sandbox, Production…" required style="width:100%;">
        </div>
        <div class="form-group">
          <div class="user-env-editor-toolbar">
            <label>Variables</label>
            <div class="user-env-editor-tools">
              <input type="search" id="user-env-var-filter" class="form-control" placeholder="Filter variables">
              <button type="button" class="btn btn-sm btn-secondary" id="user-env-sort-vars">Sort keys A-Z</button>
            </div>
          </div>
          <div id="user-env-vars-list" class="user-env-vars-list">
            ${existingVars.map(([k, v]) => varRowHtml(k, v)).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="user-env-add-var">+ Add variable</button>
        </div>
        <div class="user-env-editor-actions">
          <button type="button" class="btn btn-secondary" id="user-env-editor-back">Back</button>
          <button type="submit" class="btn btn-primary">${existingEnv ? 'Save changes' : 'Create'}</button>
        </div>
      </form>
    `;

    showModal(existingEnv ? 'Edit Environment' : 'New Environment', content);

    document.getElementById('user-env-add-var')?.addEventListener('click', () => {
      const list = document.getElementById('user-env-vars-list');
      if (list) list.insertAdjacentHTML('beforeend', varRowHtml());
      // Wire remove on newly added rows
      wireRemoveButtons();
      applyVariableFilter();
    });

    document.getElementById('user-env-sort-vars')?.addEventListener('click', () => {
      const list = document.getElementById('user-env-vars-list');
      if (!list) return;
      const rows = Array.from(list.querySelectorAll('.user-env-var-row'));
      rows.sort((a, b) => {
        const aKey = a.querySelector('.user-env-var-key')?.value || '';
        const bKey = b.querySelector('.user-env-var-key')?.value || '';
        return aKey.localeCompare(bKey);
      });
      rows.forEach(row => list.appendChild(row));
      applyVariableFilter();
    });

    document.getElementById('user-env-var-filter')?.addEventListener('input', applyVariableFilter);

    function applyVariableFilter() {
      const query = (document.getElementById('user-env-var-filter')?.value || '').trim().toLowerCase();
      document.querySelectorAll('#user-env-vars-list .user-env-var-row').forEach(row => {
        const key = row.querySelector('.user-env-var-key')?.value || '';
        row.style.display = !query || key.toLowerCase().includes(query) ? '' : 'none';
      });
    }

    function wireRemoveButtons() {
      document.querySelectorAll('.user-env-var-remove').forEach(rb => {
        rb.onclick = () => rb.closest('.user-env-var-row')?.remove();
      });
    }
    wireRemoveButtons();

    document.getElementById('user-env-editor-back')?.addEventListener('click', () => {
      hideModal();
      setTimeout(onBack, 50);
    });

    document.getElementById('user-env-editor-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = document.getElementById('user-env-name-input')?.value.trim();
      if (!name) { alert('Please enter a name.'); return; }

      const payload = { name };
      document.querySelectorAll('#user-env-vars-list .user-env-var-row').forEach(row => {
        const k = (row.querySelector('.user-env-var-key')?.value || '').trim();
        const v = (row.querySelector('.user-env-var-val')?.value || '').trim();
        if (k) payload[k] = v;
      });

      try {
        if (existingEnv) {
          if (typeof updateSavedEnv === 'function') {
            await updateSavedEnv(existingEnv.id, payload);
          } else {
            const updated = await apiRequest(`/user/environments/${existingEnv.id}`, { method: 'PUT', body: payload });
            window._userEnvsCache = (window._userEnvsCache || []).map(e => String(e.id) === String(existingEnv.id) ? updated : e);
          }
        } else {
          if (typeof createSavedEnv === 'function') {
            await createSavedEnv(payload);
          } else {
            const created = await apiRequest('/user/environments', { method: 'POST', body: payload });
            window._userEnvsCache = [...(window._userEnvsCache || []), created];
          }
        }
        hideModal();
        setTimeout(open, 50);
      } catch (err) {
        alert('Error saving environment: ' + (err.message || err));
      }
    });
  }

  open();
}

/**
 * Export-selection modal: lets the user pick which environments to export.
 * @param {Function} [onBack] - called after export or cancel to reopen the previous modal
 */
function showEnvExportModal(onBack) {
  const envs = window._userEnvsCache || [];
  if (envs.length === 0) {
    alert('No environments to export.');
    if (onBack) setTimeout(onBack, 50);
    return;
  }

  function buildContent(selectedIds) {
    const rows = envs.map(e => {
      const checked = selectedIds.has(String(e.id)) ? 'checked' : '';
      const safeName = String(e.name || '').replace(/</g, '&lt;');
      const varCount = Object.keys(e).filter(k => k !== 'id' && k !== 'name').length;
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--color-gray-200,#e5e7eb);border-radius:6px;cursor:pointer;margin-bottom:6px;background:var(--color-gray-50,#f9fafb);">
          <input type="checkbox" class="export-env-check" data-env-id="${e.id}" ${checked} style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span style="flex:1;font-weight:500;">${safeName}</span>
          <span style="font-size:12px;color:var(--color-text-secondary,#6b7280);">${varCount} variable${varCount !== 1 ? 's' : ''}</span>
        </label>`;
    }).join('');
    return `
      <div style="margin-bottom:10px;display:flex;gap:8px;">
        <button type="button" class="btn btn-sm btn-secondary" id="export-select-all">Select All</button>
        <button type="button" class="btn btn-sm btn-secondary" id="export-deselect-all">Deselect All</button>
      </div>
      <div style="max-height:320px;overflow-y:auto;">${rows}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;">
        <button type="button" class="btn btn-secondary" id="export-back-btn">${onBack ? '\u2190 Back' : 'Cancel'}</button>
        <button type="button" class="btn btn-primary" id="export-download-btn">Export Selected</button>
      </div>`;
  }

  showModal('Export Environments', buildContent(new Set(envs.map(e => String(e.id)))));

  document.getElementById('export-back-btn')?.addEventListener('click', () => {
    hideModal();
    if (onBack) setTimeout(onBack, 50);
  });

  document.getElementById('export-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.export-env-check').forEach(cb => { cb.checked = true; });
  });

  document.getElementById('export-deselect-all')?.addEventListener('click', () => {
    document.querySelectorAll('.export-env-check').forEach(cb => { cb.checked = false; });
  });

  document.getElementById('export-download-btn')?.addEventListener('click', () => {
    const selected = new Set(Array.from(document.querySelectorAll('.export-env-check:checked')).map(cb => cb.getAttribute('data-env-id')));
    const toExport = envs.filter(e => selected.has(String(e.id)));
    if (toExport.length === 0) { alert('Please select at least one environment.'); return; }
    const exportData = toExport.map(e => { const { id, name, ...vars } = e; return { name, variables: vars }; });
    const filename = toExport.length === 1
      ? toExport[0].name.replace(/[^a-z0-9_-]/gi, '_') + '.json'
      : 'my-environments-' + new Date().toISOString().slice(0, 10) + '.json';
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    hideModal();
    if (onBack) setTimeout(onBack, 50);
  });
}
window.showEnvExportModal = showEnvExportModal;

// Dashboard (unified recent runs: API + UI with type badge, Quick Run, Next scheduled)
async function loadDashboard() {
  try {
    const [projects, apiSpecs, testRunsCount, testRuns, schedules, summary] = await Promise.all([
      apiRequest('/projects'),
      apiRequest('/api-specs'),
      apiRequest('/test-runs/count?type=all').then(r => r.total).catch(() => 0),
      apiRequest('/test-runs?limit=5&type=all'),
      apiRequest('/schedules?nextWithin=24').catch(() => []),
      apiRequest('/dashboard/summary').catch(() => ({
        coverage: { total_active: 0, covered: 0, coverage_pct: 0, passed: 0, failed: 0 },
        activity: { timeseries: [], tests_today: 0, tests_last_7_days: 0 }
      }))
    ]);

    document.getElementById('total-projects').textContent = projects.length;
    document.getElementById('total-api-specs').textContent = apiSpecs.length;
    document.getElementById('total-test-runs').textContent = testRunsCount;

    const coverageEl = document.getElementById('total-test-coverage');
    const coverageSubEl = document.getElementById('total-test-coverage-subtext');
    const tests7dEl = document.getElementById('tests-last-7-days');
    if (coverageEl) coverageEl.textContent = (summary.coverage && summary.coverage.coverage_pct != null) ? summary.coverage.coverage_pct + '%' : '0%';
    if (coverageSubEl) coverageSubEl.textContent = 'of active tests run';
    if (tests7dEl) tests7dEl.textContent = (summary.activity && summary.activity.tests_last_7_days != null) ? summary.activity.tests_last_7_days : 0;

    // Dashboard activity chart (last 7 days from timeseries)
    const chartCanvas = document.getElementById('dashboard-activity-chart');
    if (window._dashboardActivityChart) {
      window._dashboardActivityChart.destroy();
      window._dashboardActivityChart = null;
    }
    if (chartCanvas && typeof Chart !== 'undefined' && summary.activity && Array.isArray(summary.activity.timeseries)) {
      const timeseries = summary.activity.timeseries;
      const last7 = timeseries.slice(-7);
      const labels = last7.map(p => (p.day instanceof Date ? p.day.toISOString().slice(0, 10) : String(p.day).slice(0, 10)));
      const passedValues = last7.map(p => p.passed_tests || 0);
      const failedValues = last7.map(p => p.failed_tests || 0);
      const ctx = chartCanvas.getContext('2d');
      window._dashboardActivityChart = new Chart(ctx, {
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
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, title: { display: false }, grid: { display: false } },
            y: { stacked: true, beginAtZero: true, title: { display: false }, ticks: { precision: 0 } }
          },
          plugins: {
            legend: { display: true, position: 'bottom' },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return context.dataset.label + ': ' + context.parsed.y + ' tests';
                }
              }
            }
          }
        }
      });
    }

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
          const projectId = s.project_id || (s.project && s.project.id) || 0;
          return `<div class="list-item next-scheduled-item" style="padding: 12px 16px; cursor: pointer;" data-schedule-id="${s.id}" data-project-id="${projectId}" role="button" tabindex="0" title="Edit schedule"><div class="list-item-info"><h3 style="font-size: 14px;">${(s.project?.name || 'Project').replace(/</g, '&lt;')} – ${(target || '').replace(/</g, '&lt;')}</h3><p style="font-size: 12px;">Next: ${(next || '').replace(/</g, '&lt;')}</p></div></div>`;
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
          <p>No runs yet. Open a project and run tests to see them here.</p>
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
          <span class="status-badge ${run.status}">${run.status === 'partial_failed' ? 'Partial Failed' : run.status}</span>
        </div>
      `;
      }).join('');
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Projects
const projectsPageState = {
  projects: [],
  uiCountsByProjectId: new Map(),
  filterHandlersReady: false
};

function projectApiTestCount(project) {
  const count = Number(project.api_test_count || 0);
  return Number.isFinite(count) ? count : 0;
}

window.openProjectApiTests = async (projectId) => {
  await window.viewProject(projectId);
  document.getElementById('run-tests-btn')?.click();
};

window.openProjectUiTests = async (projectId) => {
  await window.viewProject(projectId);
  document.getElementById('run-ui-test-btn')?.click();
};

function projectOwnerInfo(project) {
  const owner = project.owner || null;
  return {
    name: owner ? (owner.display_name || owner.username || 'Unknown owner') : 'No owner',
    email: owner && owner.email ? owner.email : ''
  };
}

function projectVisibilityInfo(project) {
  const rawVisibility = String(project.visibility || 'private').toLowerCase();
  const visibility = ['private', 'shared', 'public'].includes(rawVisibility) ? rawVisibility : 'private';
  const label = visibility === 'private' ? 'Private' : visibility === 'shared' ? 'Shared' : 'Public';
  return { visibility, label };
}

function setProjectsMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function updateProjectsMetrics(projects) {
  const total = projects.length;
  const ongoing = projects.filter((project) => (window.normalizeProjectStatus ? window.normalizeProjectStatus(project.status) : 'ongoing') !== 'closed').length;
  const apiTests = projects.reduce((sum, project) => sum + projectApiTestCount(project), 0);
  const uiTests = projects.reduce((sum, project) => sum + (projectsPageState.uiCountsByProjectId.get(Number(project.id)) || 0), 0);
  setProjectsMetric('projects-metric-total', total);
  setProjectsMetric('projects-metric-ongoing', ongoing);
  setProjectsMetric('projects-metric-api-specs', apiTests);
  setProjectsMetric('projects-metric-ui-tests', uiTests);
}

function setupProjectsFilterHandlers() {
  if (projectsPageState.filterHandlersReady) return;
  projectsPageState.filterHandlersReady = true;
  ['projects-search-input', 'projects-status-filter', 'projects-access-filter'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(eventName, renderProjectsList);
  });
}

function getFilteredProjects() {
  const query = String(document.getElementById('projects-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('projects-status-filter')?.value || '');
  const accessFilter = String(document.getElementById('projects-access-filter')?.value || '');

  return projectsPageState.projects.filter((project) => {
    const owner = projectOwnerInfo(project);
    const visibility = projectVisibilityInfo(project);
    const statusClass = window.normalizeProjectStatus ? window.normalizeProjectStatus(project.status) : 'ongoing';
    const statusLabel = window.getProjectStatusLabel ? window.getProjectStatusLabel(project.status) : 'On going';
    const apiTestCount = projectApiTestCount(project);
    const uiTestCount = projectsPageState.uiCountsByProjectId.get(Number(project.id)) || 0;
    const haystack = [
      project.name,
      project.description,
      owner.name,
      owner.email,
      visibility.label,
      statusLabel,
      `${apiTestCount} api tests`,
      `${uiTestCount} ui tests`
    ].filter(Boolean).join(' ').toLowerCase();
    return (!query || haystack.includes(query))
      && (!statusFilter || statusClass === statusFilter)
      && (!accessFilter || visibility.visibility === accessFilter);
  });
}

function renderProjectsList() {
  const projectsList = document.getElementById('projects-list');
  const summaryEl = document.getElementById('projects-list-summary');
  if (!projectsList) return;

  const allProjects = projectsPageState.projects;
  const filtered = getFilteredProjects();
  if (summaryEl) {
    const total = allProjects.length;
    summaryEl.textContent = `${filtered.length} of ${total} project${total === 1 ? '' : 's'} shown`;
  }

  if (allProjects.length === 0) {
    projectsList.innerHTML = `
      <div class="empty-state projects-empty-state">
        <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <h3>No projects yet</h3>
        <p>Create your first project to get started.</p>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    projectsList.innerHTML = `
      <div class="empty-state projects-empty-state">
        <h3>No projects match these filters</h3>
        <p>Try a different search, status, or access filter.</p>
        <button type="button" class="btn btn-secondary" id="projects-clear-filters">Clear filters</button>
      </div>
    `;
    document.getElementById('projects-clear-filters')?.addEventListener('click', () => {
      const searchInput = document.getElementById('projects-search-input');
      const statusFilter = document.getElementById('projects-status-filter');
      const accessFilter = document.getElementById('projects-access-filter');
      if (searchInput) searchInput.value = '';
      if (statusFilter) statusFilter.value = '';
      if (accessFilter) accessFilter.value = '';
      renderProjectsList();
    });
    return;
  }

  projectsList.innerHTML = filtered.map(project => {
    const owner = projectOwnerInfo(project);
    const visibility = projectVisibilityInfo(project);
    const statusClass = window.normalizeProjectStatus ? window.normalizeProjectStatus(project.status) : 'ongoing';
    const statusLabel = window.getProjectStatusLabel ? window.getProjectStatusLabel(project.status) : 'On going';
    const apiTestCount = projectApiTestCount(project);
    const uiTestCount = projectsPageState.uiCountsByProjectId.get(Number(project.id)) || 0;
    const projectId = Number(project.id);
    return `
      <div class="list-item projects-list-row" data-project-id="${projectId}" role="button" tabindex="0" aria-label="Open project ${String(project.name || '').replace(/"/g, '&quot;')}">
        <div class="projects-row-main">
          <div class="projects-row-title-line">
            <h3>${escapeHtmlLite(project.name || 'Untitled project')}</h3>
          </div>
          <p class="projects-row-description">${escapeHtmlLite(project.description || 'No description')}</p>
        </div>
        <div class="projects-row-status"><span class="status-badge ${statusClass}">${escapeHtmlLite(statusLabel)}</span></div>
        <div class="projects-row-details">
          <div class="projects-row-cell projects-row-owner">
            <span class="projects-row-label">Owner</span>
            <span class="projects-row-value">${escapeHtmlLite(owner.name)}${owner.email ? `<span class="project-owner-email">${escapeHtmlLite(owner.email)}</span>` : ''}</span>
          </div>
          <div class="projects-row-cell">
            <span class="projects-row-label">Access</span>
            <span class="visibility-badge visibility-${visibility.visibility}">${visibility.label}</span>
          </div>
          <div class="projects-row-cell projects-row-assets">
            <span class="projects-row-label">Assets</span>
            <span class="projects-asset-chips">
              <span class="projects-asset-chip">${apiTestCount} API test${apiTestCount === 1 ? '' : 's'}</span>
              <span class="projects-asset-chip">${uiTestCount} UI test${uiTestCount === 1 ? '' : 's'}</span>
            </span>
          </div>
        </div>
        <div class="list-item-actions projects-row-actions">
          <button type="button" class="btn btn-primary" onclick="window.viewProject(${projectId})">Open</button>
          <button type="button" class="btn btn-secondary" onclick="window.openProjectApiTests(${projectId})">API tests</button>
          <button type="button" class="btn btn-secondary" onclick="window.openProjectUiTests(${projectId})">UI tests</button>
          <button type="button" class="btn btn-secondary" onclick="window.editProject(${projectId})">Edit</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadProjects() {
  try {
    const [projects, recordedTests] = await Promise.all([
      apiRequest('/projects'),
      apiRequest('/playwright-recorded-tests').catch(() => [])
    ]);

    const uiCountsByProjectId = new Map();
    (Array.isArray(recordedTests) ? recordedTests : []).forEach((test) => {
      (Array.isArray(test.project_ids) ? test.project_ids : []).forEach((projectId) => {
        const key = Number(projectId);
        if (!Number.isInteger(key)) return;
        uiCountsByProjectId.set(key, (uiCountsByProjectId.get(key) || 0) + 1);
      });
    });

    projectsPageState.projects = Array.isArray(projects) ? projects : [];
    projectsPageState.uiCountsByProjectId = uiCountsByProjectId;
    setupProjectsFilterHandlers();
    updateProjectsMetrics(projectsPageState.projects);
    renderProjectsList();
  } catch (error) {
    console.error('Error loading projects:', error);
  }
}

window.normalizeProjectStatus = function normalizeProjectStatus(value) {
  const normalized = String(value == null ? 'ongoing' : value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  return normalized === 'closed' ? 'closed' : 'ongoing';
};

window.getProjectStatusLabel = function getProjectStatusLabel(value) {
  return window.normalizeProjectStatus(value) === 'closed' ? 'Closed' : 'On going';
};

window.isProjectClosed = function isProjectClosed(projectOrStatus) {
  if (projectOrStatus && typeof projectOrStatus === 'object') {
    return window.normalizeProjectStatus(projectOrStatus.status) === 'closed';
  }
  return window.normalizeProjectStatus(projectOrStatus) === 'closed';
};

window.getProjectRunBlockedMessage = function getProjectRunBlockedMessage(projectOrName) {
  if (projectOrName && typeof projectOrName === 'object') {
    const name = String(projectOrName.name || '').trim();
    return name
      ? `Project "${name}" is closed. New test runs are disabled.`
      : 'This project is closed. New test runs are disabled.';
  }

  const name = String(projectOrName || '').trim();
  return name
    ? `Project "${name}" is closed. New test runs are disabled.`
    : 'This project is closed. New test runs are disabled.';
};

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
          <p>Upload an OpenAPI or WSDL file, then link it to a project.</p>
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

// Compact run type badge shared by project and global run lists.
function getRunTypeBadgeHtml(runType) {
  const type = ['ui', 'soap', 'fuzz', 'iterations', 'rate_limit'].includes(runType) ? runType : 'api';
  const labels = { api: 'API', ui: 'UI', soap: 'SOAP', fuzz: 'FUZZ', iterations: 'ITER', rate_limit: 'RATE' };
  return `<span class="run-type-badge run-type-${type}">${labels[type]}</span>`;
}

// When true, Test Runs list shows per-row Delete for removing runs and artifacts.
window.testRunsEditMode = false;

function renderTestRunsList(allRuns) {
  const testRunsList = document.getElementById('test-runs-list');
  const pageSizeSelect = document.getElementById('test-runs-page-size');
  const pageInfo = document.getElementById('test-runs-page-info');
  const pageSize = pageSizeSelect ? parseInt(pageSizeSelect.value, 10) || 50 : 50;
  let runs = Array.isArray(allRuns) ? allRuns.slice() : [];
  const highlightedRunId = window.highlightTestRunId ? String(window.highlightTestRunId) : null;
  if (highlightedRunId) {
    const highlightedIndex = runs.findIndex((run) => String(run.id) === highlightedRunId && (run.runType || 'api') === 'api');
    if (highlightedIndex > 0) {
      const [highlightedRun] = runs.splice(highlightedIndex, 1);
      runs.unshift(highlightedRun);
    }
    if (highlightedIndex >= 0) window.testRunsCurrentPage = 1;
  }
  const total = runs.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const currentPage = Math.min(Math.max(window.testRunsCurrentPage || 1, 1), totalPages);
  window.testRunsCurrentPage = currentPage;

  if (!testRunsList) return;

  if (total === 0) {
    testRunsList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        <h3>No test runs yet</h3>
        <p>Run your first test to see results here</p>
      </div>
    `;
    if (pageInfo) pageInfo.textContent = '0–0 of 0';
    return;
  }

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const pageRuns = runs.slice(startIndex, endIndex);

  testRunsList.innerHTML = pageRuns.map(run => {
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
    const cancelBtn = isRunning
      ? `<button type="button" class="btn btn-error btn-sm" onclick="event.stopPropagation(); cancelTestRun('${runType}', ${run.id})" title="Cancel this run">Cancel</button>`
      : '';
    const deleteBtn = window.testRunsEditMode
      ? `<button type="button" class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteTestRunFromList('${runType}', ${run.id})" title="Delete this run and all artifacts (reports, videos, traces)">Delete</button>`
      : '';
    const runBy = run.runByUser ? (run.runByUser.display_name || run.runByUser.username || '') : null;
    const runByLine = runBy ? `<p style="font-size: 12px; color: #666; margin-top: 4px;">Run by: ${runBy}</p>` : '';
    const isHighlighted = highlightedRunId && String(run.id) === highlightedRunId && runType === 'api';
    return `
    <div class="list-item test-run-list-item${isHighlighted ? ' highlighted' : ''}" tabindex="0" onclick="${onClick}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
      <div class="list-item-info test-run-list-identity">
        <h3>${typeBadge} ${run.name}${isHighlighted ? ' <span style="font-size: 12px; color: var(--color-primary, #14b8a6);">Latest run</span>' : ''}</h3>
        <div class="test-run-list-extra">
          <p>Project: ${projectName}${flowLabel} • ${formatDateTime(run.created_at)}</p>
          <p class="test-run-list-results">
            ${run.passed_tests != null ? run.passed_tests : 0} passed, ${run.failed_tests != null ? run.failed_tests : 0} failed of ${run.total_tests != null ? run.total_tests : 0} total
          </p>
          ${runByLine}
          ${runningLine}
        </div>
      </div>
      <div class="test-run-list-actions">
        <div class="test-run-list-buttons">${cancelBtn}${deleteBtn}</div>
        <span class="status-badge ${run.status || 'pending'}">${run.status === 'partial_failed' ? 'Partial Failed' : (run.status || 'pending')}</span>
      </div>
    </div>
  `;
  }).join('');

  if (pageInfo) {
    pageInfo.textContent = `${startIndex + 1}–${endIndex} of ${total}`;
  }
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
    // Fetch a comfortable upper bound and paginate client-side
    params.append('limit', '500');

    const endpoint = `/test-runs?${params.toString()}`;
    const testRuns = await apiRequest(endpoint);
    window.testRunsData = Array.isArray(testRuns) ? testRuns : [];
    renderTestRunsList(window.testRunsData);
    const hasRunning = Array.isArray(testRuns) && testRuns.some(r => (r.status || '').toLowerCase() === 'running');
    if (hasRunning) {
      clearInterval(window._testRunsRefreshInterval);
      // Refresh every 5s (not 3s) so the page doesn't feel blocked or constantly reloading while tests run
      window._testRunsRefreshInterval = setInterval(loadTestRuns, 5000);
    } else {
      clearInterval(window._testRunsRefreshInterval);
      window._testRunsRefreshInterval = null;
    }
  } catch (error) {
    console.error('Error loading test runs:', error);
    clearInterval(window._testRunsRefreshInterval);
    window._testRunsRefreshInterval = null;
  }
}



// View test run
function mountRunDetailSplit(container, entries, emptyHtml, runKey) {
  if (!container) return;
  if (!entries.length) {
    container.classList.remove('run-detail-split');
    delete container.dataset.selectedIndex;
    delete container.dataset.runKey;
    container.innerHTML = emptyHtml;
    return;
  }
  if (container.dataset.runKey !== String(runKey)) {
    container.dataset.runKey = String(runKey);
    container.dataset.selectedIndex = '0';
  }
  const index = Math.min(
    Math.max(Number(container.dataset.selectedIndex) || 0, 0),
    entries.length - 1
  );
  container.classList.add('run-detail-split');
  container.innerHTML = `
    <div class="run-detail-steps" role="listbox" aria-label="Run results">
      ${entries.map((entry, entryIndex) => `
        <button type="button" class="run-step${entryIndex === index ? ' active' : ''}" role="option" aria-selected="${entryIndex === index}" data-result-index="${entryIndex}">
          ${entry.labelHtml}
        </button>
      `).join('')}
    </div>
    <div class="run-detail-evidence">${entries[index].evidenceHtml}</div>
  `;
  container.querySelectorAll('.run-step').forEach((button) => {
    button.addEventListener('click', () => {
      container.dataset.selectedIndex = button.getAttribute('data-result-index');
      mountRunDetailSplit(container, entries, emptyHtml, runKey);
    });
  });
}

window.mountRunDetailSplit = mountRunDetailSplit;

async function viewTestRun(testRunId) {
  clearDetailPolling();
  try {
    const testRun = await apiRequest(`/test-runs/${testRunId}`);
    const status = (testRun.status || 'pending').toLowerCase();
    const isRunning = status === 'running';

    const runBy = testRun.runByUser ? (testRun.runByUser.display_name || testRun.runByUser.username || '') : null;
    const runByLine = runBy ? `<div style="margin-bottom: 12px; font-size: inherit;"><span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Run by:</span><span style="margin-left: 8px;">${runBy}</span></div>` : '';
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
      ${runByLine}
      <div style="font-size: inherit;">
        <span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">Status:</span>
        <span class="status-badge ${testRun.status}" style="margin-left: 8px;">${testRun.status === 'partial_failed' ? 'Partial Failed' : testRun.status}</span>
        ${isRunning ? '<p style="margin-top: 8px; color: var(--color-warning, #f59e0b); font-weight: 600;">Run in progress — results will update automatically.</p><button type="button" class="btn btn-error btn-sm" onclick="cancelApiTestRun(' + testRunId + '); showView(\'test-runs\'); loadTestRuns();" style="margin-top: 8px;">Cancel run</button>' : ''}
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
    const parseTestIdOrder = (testId) => {
      const match = String(testId || '').match(/TEST-(\d+)/i);
      return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    };

    const sortRunResults = (results) => (results || []).slice().sort((left, right) => {
      const leftExecution = Number.isFinite(Number(left?.execution_order)) ? Number(left.execution_order) : Number.POSITIVE_INFINITY;
      const rightExecution = Number.isFinite(Number(right?.execution_order)) ? Number(right.execution_order) : Number.POSITIVE_INFINITY;
      if (leftExecution !== rightExecution) return leftExecution - rightExecution;

      const leftTestId = parseTestIdOrder(left?.test_id);
      const rightTestId = parseTestIdOrder(right?.test_id);
      if (leftTestId !== rightTestId) return leftTestId - rightTestId;

      return String(left?.test_name || '').localeCompare(String(right?.test_name || ''));
    });

    const orderedResults = sortRunResults(testRun.testResults);
    if (orderedResults.length > 0) {
      // Recalculate statistics from actual test results if database counts are wrong
      const actualTotal = orderedResults.length;
      const actualPassed = orderedResults.filter(r => r.status === 'passed').length;
      const actualFailed = orderedResults.filter(r => r.status === 'failed').length;
      
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
      
      mountRunDetailSplit(resultsList, orderedResults.map(result => {
        const requestHeaders = headerEvidenceHtml(result.request_headers_sent);
        const responseHeaders = headerEvidenceHtml(result.response_headers_received);
        const traceEvidence = traceEvidenceHtml(result.trace_evidence);
        const rateLimitEvidence = rateLimitEvidenceHtml(result.rate_limit_evidence);
        return {
          labelHtml: `
            <span class="test-result-header">
              <span>
                ${result.test_id ? `<span style="margin-right: 8px; font-weight: bold; color: var(--color-primary);">${escapeHtmlLite(result.test_id)}</span>` : ''}
                <span class="method-badge ${escapeHtmlLite(result.method)}">${escapeHtmlLite(result.method)}</span>
                <strong>${escapeHtmlLite(result.test_name)}</strong>
              </span>
              <span class="status-badge ${escapeHtmlLite(result.status)}">${escapeHtmlLite(result.status)}</span>
            </span>
          `,
          evidenceHtml: `
            <div class="test-result-details">
              <p><strong>Endpoint:</strong> ${escapeHtmlLite(result.endpoint)}</p>
              ${result.response_code ? `<p><strong>Response Code:</strong> ${result.response_code}</p>` : ''}
              ${rateLimitEvidence}
              ${traceEvidence ? `<div><strong>Trace Evidence:</strong>${traceEvidence}</div>` : ''}
              ${requestHeaders ? `<div><strong>Requested Headers Sent:</strong>${requestHeaders}</div>` : ''}
              ${responseHeaders ? `<div><strong>Headers Received:</strong>${responseHeaders}</div>` : ''}
              ${result.error_message ? `<p style="color: #f44336;"><strong>Error:</strong> ${escapeHtmlLite(result.error_message)}</p>` : ''}
            </div>
          `
        };
      }), '', testRunId);
    } else {
      const isJwksError = testRun.error_message && /private key not found|signedjwt|generate jwks/i.test(testRun.error_message);
      let emptyMsg;
      if (isRunning) {
        emptyMsg = 'Run in progress. No results yet — they will appear when the run completes.';
      } else if (testRun.error_message) {
        const escapedMsg = testRun.error_message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const jwksCta = isJwksError
          ? `<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" onclick="showGenerateJwksModal(${testRun.project_id})">Generate JWKS / JWT</button></div>`
          : '';
        emptyMsg = `<span style="color:#f44336;font-weight:600;">Run failed:</span> <span style="color:#f44336;">${escapedMsg}</span>${jwksCta}`;
      } else {
        emptyMsg = 'No results for this run. Start it again from the project, or open another run.';
      }
      mountRunDetailSplit(resultsList, [], `
        <div class="empty-state">
          <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p>${emptyMsg}</p>
        </div>
      `, testRunId);
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
    const deleteRunBtn = document.getElementById('delete-test-run-btn');
    if (deleteRunBtn) {
      deleteRunBtn.setAttribute('data-detail-type', 'api');
      deleteRunBtn.setAttribute('data-detail-id', String(testRunId));
      deleteRunBtn.style.display = isRunning ? 'none' : '';
    }
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
        <span class="status-badge ${fuzzRun.status || 'pending'}" style="margin-left: 8px;">${fuzzRun.status === 'partial_failed' ? 'Partial Failed' : (fuzzRun.status || 'pending')}</span>
        ${isRunning ? '<p class="run-status-in-progress" style="margin-top: 8px;">Fuzz run in progress — results will update automatically.</p>' : ''}
        ${(isRunning || (fuzzRun.status || '').toLowerCase() === 'failed') && fuzzRun.progress_message ? `<div class="fuzz-detail-progress"><span style="font-weight: 600; color: var(--color-text-secondary, #6b7280);">${(fuzzRun.status || '').toLowerCase() === 'failed' ? 'Reason:' : 'Progress:'}</span><pre class="fuzz-progress-pre">${(fuzzRun.progress_message || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>` : ''}
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
      mountRunDetailSplit(resultsList, fuzzRun.fuzzResults.map(r => {
        const statusLabel = (r.status === 'error' || r.status === 'failed') && r.response_code != null
          ? `${r.status} (${r.response_code})`
          : (r.status || '—');
        return {
          labelHtml: `
            <span class="test-result-header">
              <span>
                <strong>${r.test_name}</strong>
                ${r.fuzzer_name ? `<span style="margin-left: 8px; font-size: 12px; color: #6b7280;">${r.fuzzer_name}</span>` : ''}
              </span>
              <span class="status-badge ${r.status}">${statusLabel}</span>
            </span>
          `,
          evidenceHtml: `
            <div class="test-result-details">
              ${r.response_code != null ? `<p><strong>Response Code:</strong> ${r.response_code}</p>` : ''}
              ${r.error_message ? `<p style="color: #f44336;"><strong>Error:</strong> ${r.error_message}</p>` : '<p>No extra evidence for this result.</p>'}
            </div>
          `
        };
      }), '', `fuzz-${fuzzRunId}`);
    } else {
      const isFailed = (fuzzRun.status || '').toLowerCase() === 'failed';
      const emptyMsg = isRunning
        ? 'Fuzz run in progress. No results yet — they will appear when the run completes.'
        : isFailed && fuzzRun.total_tests === 0
          ? 'No tests ran. See the reason above (e.g. CATS not installed, invalid OpenAPI, or missing server URL).'
          : 'No fuzz results yet. Check the reason above, then run fuzz again from the project.';
      mountRunDetailSplit(resultsList, [], `
        <div class="empty-state">
          <p>${emptyMsg}</p>
        </div>
      `, `fuzz-${fuzzRunId}`);
    }
    const viewBtn = document.getElementById('view-report-btn');
    const downloadBtn = document.getElementById('download-report-btn');
    viewBtn.removeAttribute('data-test-run-id');
    downloadBtn.removeAttribute('data-test-run-id');
    viewBtn.setAttribute('data-fuzz-run-id', fuzzRunId);
    viewBtn.setAttribute('data-detail-type', 'fuzz');
    downloadBtn.setAttribute('data-fuzz-run-id', fuzzRunId);
    downloadBtn.setAttribute('data-detail-type', 'fuzz');
    const deleteRunBtn = document.getElementById('delete-test-run-btn');
    if (deleteRunBtn) {
      deleteRunBtn.setAttribute('data-detail-type', 'fuzz');
      deleteRunBtn.setAttribute('data-detail-id', String(fuzzRunId));
      deleteRunBtn.style.display = isRunning ? 'none' : '';
    }
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

document.getElementById('delete-test-run-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('delete-test-run-btn');
  const type = btn?.getAttribute('data-detail-type');
  const id = btn?.getAttribute('data-detail-id');
  if (!type || !id) return;
  if (!(await confirmDialog({ title: 'Delete run', message: 'Delete this run and all its artifacts (reports, videos, traces)? This cannot be undone.', confirmLabel: 'Delete run' }))) return;
  try {
    const path = type === 'fuzz' ? `/fuzz-runs/${id}` : type === 'ui' ? `/playwright-runs/${id}` : `/test-runs/${id}`;
    await apiRequest(path, { method: 'DELETE' });
    showView('test-runs');
    loadTestRuns();
    alert('Run deleted successfully.');
  } catch (err) {
    alert('Error deleting run: ' + (err.message || err));
  }
});

// viewProject / editProject are assigned in projectManager.js (do not stub here — a noop breaks list clicks if load order fails)

window.viewTestRun = viewTestRun;
window.viewFuzzRun = viewFuzzRun;
window.loadTestRuns = loadTestRuns;

window.deleteTestRunFromList = async (runType, id) => {
  if (!(await confirmDialog({ title: 'Delete run', message: 'Delete this run and all its artifacts (reports, videos, traces)? This cannot be undone.', confirmLabel: 'Delete run' }))) return;
  try {
    const path = runType === 'ui' ? `/playwright-runs/${id}` : runType === 'fuzz' ? `/fuzz-runs/${id}` : `/test-runs/${id}`;
    await apiRequest(path, { method: 'DELETE' });
    loadTestRuns();
    alert('Run deleted successfully.');
  } catch (err) {
    alert('Error deleting run: ' + (err.message || err));
  }
};

window.cancelApiTestRun = async (testRunId) => {
  await cancelTestRun('api', testRunId);
};

window.cancelTestRun = async (runType, id) => {
  const cancellationMessages = {
    api: 'Cancel this API test run? It will stop after the current request.',
    soap: 'Cancel this SOAP test run? It will stop after the current request.',
    iterations: 'Cancel this iteration test run? It will stop after the current request.',
    rate_limit: 'Cancel this rate-limit test run? It will stop after the current request.',
    ui: 'Cancel this UI test run?',
    fuzz: 'Cancel this fuzz run?'
  };
  const msg = cancellationMessages[runType] || 'Cancel this test run?';
  if (!(await confirmDialog({ title: 'Cancel run', message: msg, confirmLabel: 'Cancel run' }))) return;
  try {
    const path = runType === 'ui'
      ? `/playwright-runs/${id}/cancel`
      : runType === 'fuzz'
        ? `/fuzz-runs/${id}/cancel`
        : `/test-runs/${id}/cancel`;
    await apiRequest(path, { method: 'POST' });
    loadTestRuns();
  } catch (err) {
    alert('Error cancelling run: ' + (err.message || err));
  }
};

window.deleteProject = async (projectId) => {
  if (!(await confirmDialog({ title: 'Delete project', message: 'Are you sure you want to delete this project?', confirmLabel: 'Delete project' }))) return;
  
  try {
    await apiRequest(`/projects/${projectId}`, { method: 'DELETE' });
    loadProjects();
  } catch (error) {
    alert('Error deleting project: ' + error.message);
  }
};

window.deleteApiSpec = async (apiSpecId) => {
  if (!(await confirmDialog({ title: 'Delete API spec', message: 'Are you sure you want to delete this API spec?', confirmLabel: 'Delete API spec' }))) return;
  
  try {
    await apiRequest(`/api-specs/${apiSpecId}`, { method: 'DELETE' });
    loadApiSpecs();
  } catch (error) {
    alert('Error deleting API spec: ' + error.message);
  }
};

// Projects list: capture phase so clicks still open the project even if something stops bubbling; runs after projectManager defines window.viewProject.
function projectsListClickTarget(el) {
  return el && el.nodeType === Node.ELEMENT_NODE ? el : el?.parentElement;
}
document.addEventListener('click', (e) => {
  const t = projectsListClickTarget(e.target);
  if (!t) return;
  const pl = document.getElementById('projects-list');
  if (!pl || !pl.contains(t)) return;
  if (t.closest('.list-item-actions')) return;
  const row = t.closest('.list-item[data-project-id]');
  if (!row || !pl.contains(row)) return;
  const id = row.getAttribute('data-project-id');
  if (!id || typeof window.viewProject !== 'function') return;
  window.viewProject(Number(id));
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = projectsListClickTarget(e.target);
  if (!t) return;
  const pl = document.getElementById('projects-list');
  if (!pl || !pl.contains(t)) return;
  if (t.closest('.list-item-actions')) return;
  const row = t.closest('.list-item[data-project-id]');
  if (!row || !pl.contains(row)) return;
  e.preventDefault();
  const id = row.getAttribute('data-project-id');
  if (!id || typeof window.viewProject !== 'function') return;
  window.viewProject(Number(id));
}, true);

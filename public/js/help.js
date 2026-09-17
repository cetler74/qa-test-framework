const PROJECT_SETUP_TOUR = Object.freeze({
  key: 'project-setup',
  version: '1',
  steps: [
    {
      target: '#project-detail-name',
      title: 'Your project workspace',
      body: 'Use this workspace to connect assets, organize tests, run checks, and review coverage.',
      prepare: () => window.setProjectTab?.('overview')
    },
    {
      target: '#upload-postman-collection-btn',
      title: 'Upload a Postman collection',
      body: 'This is the most common setup path. Upload the original Postman collection to keep its folders, requests, variables, and API test scripts such as pm.test assertions.',
      prepare: () => window.setProjectTab?.('assets')
    },
    {
      target: '#add-api-spec-btn',
      title: 'Add other API assets',
      body: 'You can also add an OpenAPI specification for API and fuzz testing, or a WSDL document for SOAP testing.',
      prepare: () => window.setProjectTab?.('assets')
    },
    {
      target: '#generate-jwks-btn',
      title: 'Generate and publish JWKS',
      body: 'Generate a key pair, copy the public JWKS, and publish it in your external developer portal. Keep the private key and token protected.',
      prepare: () => window.setProjectTab?.('assets')
    },
    {
      target: '#manage-project-recorded-tests-btn',
      title: 'Link recorded UI tests',
      body: 'Manage recorded browser tests and link the relevant journeys to this project.',
      prepare: () => window.setProjectTab?.('tests')
    },
    {
      target: '#project-overview-actions [data-project-run-action="api"]',
      title: 'Configure environments',
      body: 'Open an API run to choose a saved environment and review variable overrides. Saved environments are private to your user account.',
      prepare: () => window.setProjectTab?.('overview')
    },
    {
      target: '#project-overview-actions',
      title: 'Run and review',
      body: 'Choose the appropriate run type here. Results appear in Runs, while Coverage shows passed, failed, partial, and not-run tests.',
      prepare: () => window.setProjectTab?.('overview')
    }
  ]
});

const HELP_TOPICS = Object.freeze({
  dashboard: { title: 'Dashboard', points: ['Review portfolio-level test and project metrics.', 'Use Quick Run to start API, UI, or flow execution.', 'Monitor recent runs, schedules, and seven-day activity.'] },
  projects: { title: 'Projects', points: ['Create workspaces that group assets, tests, runs, and automation.', 'Filter by status and access, then open a project to work in it.', 'Closed projects retain history but cannot start new runs.'], tutorial: true },
  'project.overview': { title: 'Project overview', points: ['Create the project (private or public).', 'Associate users if the project is private and access is needed.', 'Add API assets or a keystore.', 'Define test coverage by area and add manual tests to show passed, failed, and not-run counts.'], tutorial: true },
  'project.tests': { title: 'Project tests', points: ['Browse tests by folder or grouped table.', 'Use Edit mode to add or update manual tests, upload tests in bulk, manage folders, choose active coverage, or delete tests.', 'Synchronize API tests from project specifications or select compatible tests to run together.'], tutorial: true },
  'project.runs': { title: 'Project runs', points: ['Search execution history and inspect results.', 'Rerun compatible historical executions.', 'Delete selected history only when it is no longer needed.'] },
  'project.coverage': { title: 'Project coverage', points: ['Coverage counts active tests with recorded results.', 'Compare passed, failed, partial, and not-run states.', 'Open a folder to inspect individual tests and history.'] },
  'project.assets': { title: 'Project assets', points: ['Upload Postman collections with their folders, requests, variables, and embedded API test scripts preserved.', 'Attach OpenAPI specifications for API/fuzz testing or WSDL documents for SOAP testing.', 'Generate JWKS for the developer portal and link recorded UI tests to the project.'], tutorial: true },
  'project.automation': { title: 'Flows and schedules', points: ['Build ordered flows from API and UI tasks.', 'Configure task environments, variables, and browser artifacts.', 'Schedule a flow or the whole project with cron or repeat intervals.'] },
  'test-runs': { title: 'Test Runs', points: ['Review API, UI, SOAP, fuzz, iteration, and rate-limit runs.', 'Filter by project, type, name, or date.', 'Open a run for detailed evidence, reports, and artifacts.'] },
  'tests-catalogue': { title: 'Test Catalogue', points: ['Review active tests across accessible projects.', 'Filter by project, type, and latest status.', 'Coverage and run history remain scoped to projects you can access.'] },
  'api-specs': { title: 'API Specifications', points: ['Upload OpenAPI YAML/JSON for API and fuzz testing.', 'Upload WSDL documents for SOAP testing.', 'Associate specifications with projects before synchronizing tests.'] },
  'ui-tests': { title: 'Recorded UI Tests', points: ['Create reusable browser tests with Playwright Codegen.', 'Validate generated code before saving it.', 'Link saved tests to projects for UI runs and flows.'] },
  'recorded-tests-list': { title: 'Recorded UI Tests', points: ['Browse the reusable recorded-test library.', 'Edit a test or link it to an accessible project.', 'Linked tests become available to UI runs and flows.'] },
  'project-recorded-tests': { title: 'Project Recorded Tests', points: ['Review recorded tests linked to this project.', 'Add existing tests from the shared recorded-test library.', 'Remove a project link without deleting the reusable test.'], tutorial: true },
  'add-recorded-test': { title: 'Recorded Test Editor', points: ['Launch Playwright Codegen or paste generated JavaScript.', 'Validate and normalize the draft before saving.', 'Choose the project and variable group that the test requires.'] },
  'run-ui-tests': { title: 'Run UI Tests', points: ['Choose linked tests and their execution order.', 'Select browser, timeout, video, trace, and display options.', 'Provide the required variables before starting the run.'] },
  'ui-test-detail': { title: 'UI Run Details', points: ['Review per-test status and assertions.', 'Open video or trace artifacts when available.', 'Use the HTML report for a portable execution record.'] },
  'test-run-detail': { title: 'Run Details', points: ['Review status, duration, and result totals.', 'Inspect request, response, assertion, and trace evidence.', 'Open or download the generated report.'] },
  'project-access': { title: 'Project Access', points: ['Choose private, shared, or public visibility.', 'Owners and administrators control sharing.', 'Access determines which projects, tests, and runs users can view.'] },
  'postman-to-openapi': { title: 'Postman to OpenAPI', points: ['Convert supported Postman collections to OpenAPI YAML.', 'Review the generated contract before using it.', 'Upload the result as an API specification for API or fuzz testing.'] },
  'user-management': { title: 'User Management', points: ['Create and maintain local accounts.', 'Assign administrator access carefully.', 'Suspend users without deleting their project history.'] },
  environments: { title: 'My Environments', points: ['Store reusable variables for your own runs.', 'Import, export, duplicate, or update variable groups.', 'Treat tokens and credentials as secrets and avoid displaying them unnecessarily.'] },
  profile: { title: 'Profile', points: ['Review your identity and authentication source.', 'Local users can update their password here.', 'Directory and OS-account credentials are managed externally.'] },
  'run-api-tests': { title: 'Run API Tests', points: ['Choose collections or selected catalogue tests.', 'Select an environment and review variable precedence.', 'Configure iterations, rate limits, or delays before running.'] },
  'run-detail': { title: 'Run Details', points: ['Review status, duration, and passed/failed totals.', 'Inspect request, response, assertion, and trace evidence.', 'Open or download available reports and artifacts.'] }
});

const onboardingState = new Map();
let activeTour = null;
let helpReturnFocus = null;
let tourReturnFocus = null;

function helpEscape(value) {
  const element = document.createElement('div');
  element.textContent = value == null ? '' : String(value);
  return element.innerHTML;
}

async function loadOnboardingProgress() {
  try {
    const response = await apiRequest('/user/onboarding');
    onboardingState.clear();
    (response.tours || []).forEach((item) => onboardingState.set(`${item.tour_key}:${item.tour_version}`, item));
    return response.tours || [];
  } catch (_) {
    return [];
  }
}

async function setOnboardingStatus(tourKey, tourVersion, status) {
  const progress = await apiRequest(`/user/onboarding/${encodeURIComponent(tourKey)}`, {
    method: 'PUT',
    body: { tour_version: tourVersion, status }
  });
  onboardingState.set(`${tourKey}:${tourVersion}`, progress);
  return progress;
}

function resolveHelpTopic() {
  if (document.getElementById('project-detail-view')?.classList.contains('active')) {
    const tab = document.querySelector('.project-tab[aria-selected="true"]')?.dataset.projectTab || 'overview';
    return `project.${tab}`;
  }
  const activeView = document.querySelector('main > .view.active');
  if (!activeView) return 'dashboard';
  return activeView.id.replace(/-view$/, '');
}

function closeHelp() {
  const backdrop = document.getElementById('help-drawer-backdrop');
  const drawer = document.getElementById('help-drawer');
  backdrop?.classList.remove('open');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden', 'true');
  helpReturnFocus?.focus?.();
  helpReturnFocus = null;
}

function openHelp(topicKey = resolveHelpTopic(), trigger = document.activeElement) {
  const topic = HELP_TOPICS[topicKey] || HELP_TOPICS.dashboard;
  const drawer = document.getElementById('help-drawer');
  const backdrop = document.getElementById('help-drawer-backdrop');
  if (!drawer || !backdrop) return;
  helpReturnFocus = trigger;
  document.getElementById('help-drawer-title').textContent = topic.title;
  document.getElementById('help-drawer-points').innerHTML = topic.points.map((point) => `<li>${helpEscape(point)}</li>`).join('');
  const tutorialButton = document.getElementById('help-start-tutorial');
  tutorialButton.hidden = !topic.tutorial;
  tutorialButton.textContent = window.currentProject?.id ? 'Start project setup tutorial' : 'Choose a project to start tutorial';
  backdrop.classList.add('open');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('help-drawer-close').focus();
}

function getVisibleTarget(selector) {
  return [...document.querySelectorAll(selector)].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
}

function waitForTarget(selector, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const find = () => {
      const target = getVisibleTarget(selector);
      if (target) return resolve(target);
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Tutorial target unavailable: ${selector}`));
      requestAnimationFrame(find);
    };
    find();
  });
}

function positionTour(target) {
  const spotlight = document.getElementById('tour-spotlight');
  const coachmark = document.getElementById('tour-coachmark');
  if (!spotlight || !coachmark || !target) return;
  const rect = target.getBoundingClientRect();
  const gap = 10;
  spotlight.style.left = `${Math.max(4, rect.left - 6)}px`;
  spotlight.style.top = `${Math.max(4, rect.top - 6)}px`;
  spotlight.style.width = `${Math.min(window.innerWidth - 8, rect.width + 12)}px`;
  spotlight.style.height = `${rect.height + 12}px`;
  const coachRect = coachmark.getBoundingClientRect();
  const left = Math.max(12, Math.min(window.innerWidth - coachRect.width - 12, rect.left));
  const below = rect.bottom + gap;
  const top = below + coachRect.height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - coachRect.height - gap);
  coachmark.style.left = `${left}px`;
  coachmark.style.top = `${top}px`;
}

async function showTourStep(index) {
  if (!activeTour) return;
  const step = PROJECT_SETUP_TOUR.steps[index];
  try {
    await step.prepare?.();
    const target = await waitForTarget(step.target);
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    await new Promise((resolve) => setTimeout(resolve, 180));
    activeTour.index = index;
    activeTour.target = target;
    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-body').textContent = step.body;
    document.getElementById('tour-progress').textContent = `${index + 1} of ${PROJECT_SETUP_TOUR.steps.length}`;
    document.getElementById('tour-back').disabled = index === 0;
    document.getElementById('tour-next').textContent = index === PROJECT_SETUP_TOUR.steps.length - 1 ? 'Finish' : 'Next';
    positionTour(target);
  } catch (error) {
    document.getElementById('tour-body').textContent = 'This section is not available right now. You can continue to the next step or replay the tutorial later.';
    activeTour.index = index;
    activeTour.target = null;
  }
}

async function endTour(status) {
  if (!activeTour) return;
  const finishedTour = activeTour;
  activeTour = null;
  document.getElementById('tour-layer')?.classList.remove('open');
  document.getElementById('tour-layer')?.setAttribute('aria-hidden', 'true');
  try {
    await setOnboardingStatus(finishedTour.key, finishedTour.version, status);
  } catch (_) {}
  tourReturnFocus?.focus?.();
  tourReturnFocus = null;
}

async function startProjectSetupTutorial({ replay = false } = {}) {
  if (!window.currentProject?.id) {
    closeHelp();
    if (typeof showView === 'function') showView('projects');
    showModal('Choose a project', '<p>Open a project, then use Help to start the guided setup tutorial.</p>');
    return false;
  }
  closeHelp();
  if (replay) {
    try {
      await apiRequest(`/user/onboarding/${PROJECT_SETUP_TOUR.key}/replay`, {
        method: 'POST',
        body: { tour_version: PROJECT_SETUP_TOUR.version }
      });
    } catch (_) {}
  }
  tourReturnFocus = document.activeElement;
  activeTour = { key: PROJECT_SETUP_TOUR.key, version: PROJECT_SETUP_TOUR.version, index: 0, target: null };
  const layer = document.getElementById('tour-layer');
  layer.classList.add('open');
  layer.setAttribute('aria-hidden', 'false');
  await showTourStep(0);
  document.getElementById('tour-next').focus();
  return true;
}

function showProjectTutorialOffer() {
  showModal('Set up your project', `
    <div class="tutorial-offer">
      <p>Take a short guided tour through assets, JWKS, test catalogue setup, recorded UI tests, environments, and running tests.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="tutorial-offer-skip">Skip</button>
        <button type="button" class="btn btn-primary" id="tutorial-offer-start">Start tutorial</button>
      </div>
    </div>
  `);
  const closeButton = document.querySelector('#modal-overlay .modal-close');
  const overlay = document.getElementById('modal-overlay');
  const persistSkip = () => setOnboardingStatus(PROJECT_SETUP_TOUR.key, PROJECT_SETUP_TOUR.version, 'skipped').catch(() => {});
  const dismissOffer = async() => {
    closeButton?.removeEventListener('click', dismissOffer);
    overlay?.removeEventListener('click', dismissFromBackdrop);
    hideModal();
    await persistSkip();
  };
  const dismissFromBackdrop = (event) => {
    if (event.target === overlay) dismissOffer();
  };
  closeButton?.addEventListener('click', dismissOffer, { once: true });
  overlay?.addEventListener('click', dismissFromBackdrop);
  document.getElementById('tutorial-offer-skip')?.addEventListener('click', dismissOffer);
  document.getElementById('tutorial-offer-start')?.addEventListener('click', async() => {
    closeButton?.removeEventListener('click', dismissOffer);
    overlay?.removeEventListener('click', dismissFromBackdrop);
    hideModal();
    await startProjectSetupTutorial();
  });
}

function initializeHelpUi() {
  document.getElementById('global-help-btn')?.addEventListener('click', (event) => openHelp(resolveHelpTopic(), event.currentTarget));
  document.getElementById('project-help-btn')?.addEventListener('click', (event) => openHelp(resolveHelpTopic(), event.currentTarget));
  document.getElementById('help-drawer-close')?.addEventListener('click', closeHelp);
  document.getElementById('help-drawer-backdrop')?.addEventListener('click', closeHelp);
  document.getElementById('help-start-tutorial')?.addEventListener('click', () => startProjectSetupTutorial({ replay: true }));
  document.getElementById('tour-skip')?.addEventListener('click', () => endTour('skipped'));
  document.getElementById('tour-back')?.addEventListener('click', () => showTourStep(Math.max(0, activeTour.index - 1)));
  document.getElementById('tour-next')?.addEventListener('click', () => {
    if (activeTour.index >= PROJECT_SETUP_TOUR.steps.length - 1) return endTour('completed');
    return showTourStep(activeTour.index + 1);
  });
  document.addEventListener('keydown', (event) => {
    const drawer = document.getElementById('help-drawer');
    const focusRoot = activeTour ? document.getElementById('tour-coachmark') : drawer?.classList.contains('open') ? drawer : null;
    if (event.key === 'Escape') {
      if (activeTour) endTour('skipped');
      else if (drawer?.classList.contains('open')) closeHelp();
      return;
    }
    if (event.key !== 'Tab' || !focusRoot) return;
    const focusable = [...focusRoot.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener('resize', () => activeTour?.target && positionTour(activeTour.target));
  window.addEventListener('scroll', () => activeTour?.target && positionTour(activeTour.target), true);
}

window.loadOnboardingProgress = loadOnboardingProgress;
window.showProjectTutorialOffer = showProjectTutorialOffer;
window.startProjectSetupTutorial = startProjectSetupTutorial;
window.openHelp = openHelp;
window.setProjectTab = window.setProjectTab || (typeof setProjectTab === 'function' ? setProjectTab : undefined);

document.addEventListener('DOMContentLoaded', initializeHelpUi);

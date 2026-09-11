const API_TASK_VERSION = 2;
const UI_TASK_VERSION = 2;

function normalizeVariableMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [String(key), entry == null ? '' : String(entry)]));
}

function normalizePath(path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  const normalized = path.map((part) => Number(part));
  return normalized.every((part) => Number.isInteger(part) && part >= 0) ? normalized : null;
}

function normalizeApiTaskRef(ref = {}) {
  let ordered = Array.isArray(ref.selectedTestsOrdered) ? ref.selectedTestsOrdered : [];
  if (ordered.length === 0 && ref.collectionId && Array.isArray(ref.path)) {
    ordered = [{ collectionId: ref.collectionId, path: ref.path, name: ref.label }];
  }

  const selectedTestsOrdered = ordered.map((test, index) => {
    const collectionId = Number(test.collectionId);
    const path = normalizePath(test.path);
    if (!Number.isInteger(collectionId) || collectionId <= 0 || !path) {
      throw new Error(`API selection ${index + 1} has an invalid collection or path`);
    }
    return {
      collectionId,
      path,
      testId: test.testId || `Flow test ${index + 1}`,
      name: test.name || undefined,
      method: test.method || undefined
    };
  });
  if (selectedTestsOrdered.length === 0) throw new Error('API task must include at least one selected test');

  const selectedTests = {};
  selectedTestsOrdered.forEach(({ collectionId, path }) => {
    if (!selectedTests[collectionId]) selectedTests[collectionId] = [];
    selectedTests[collectionId].push(path);
  });

  const delayBetweenTests = Number(ref.delayBetweenTests || 0);
  return {
    version: API_TASK_VERSION,
    label: ref.label || undefined,
    environmentId: Number.isInteger(Number(ref.environmentId)) && Number(ref.environmentId) > 0 ? Number(ref.environmentId) : null,
    environmentName: ref.environmentName ? String(ref.environmentName) : null,
    selectedTests,
    selectedTestsOrdered,
    envVars: normalizeVariableMap(ref.envVars),
    delayBetweenTests: Number.isFinite(delayBetweenTests) && delayBetweenTests >= 0 ? delayBetweenTests : 0,
    testDelays: ref.testDelays && typeof ref.testDelays === 'object' && !Array.isArray(ref.testDelays) ? ref.testDelays : {}
  };
}

function normalizeUiTaskRef(ref = {}, defaults = {}) {
  let selectedTestIds = Array.isArray(ref.selectedTestIds) ? ref.selectedTestIds : [];
  if (selectedTestIds.length === 0 && ref.recordedTestId) selectedTestIds = [ref.recordedTestId];
  selectedTestIds = selectedTestIds.map(Number);
  if (selectedTestIds.length === 0 || selectedTestIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('UI task must include at least one valid recorded test');
  }

  const timeoutMs = Number(ref.timeoutMs ?? defaults.timeoutMs ?? 30000);
  const slowMo = Number(ref.slowMo ?? 0);
  const browserName = ['chromium', 'firefox', 'webkit'].includes(ref.browserName || ref.browser)
    ? (ref.browserName || ref.browser)
    : 'chromium';
  const video = ['off', 'on', 'retain-on-failure', 'on-first-retry'].includes(ref.video) ? ref.video : 'off';
  const trace = ['off', 'on', 'retain-on-failure', 'on-first-retry'].includes(ref.trace) ? ref.trace : 'off';

  return {
    version: UI_TASK_VERSION,
    label: ref.label || undefined,
    selectedTestIds,
    uiVariables: normalizeVariableMap(ref.uiVariables),
    baseUrl: String(ref.baseUrl ?? defaults.baseUrl ?? '').trim(),
    browserName,
    headless: ref.headless === undefined ? defaults.headless !== false : ref.headless !== false,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
    video,
    trace,
    slowMo: Number.isFinite(slowMo) && slowMo >= 0 ? slowMo : 0
  };
}

function normalizeFlowTask(task, defaults = {}) {
  if (!task || !['api', 'ui'].includes(task.task_type)) throw new Error('Flow task type must be api or ui');
  return {
    task_type: task.task_type,
    task_ref: task.task_type === 'api'
      ? normalizeApiTaskRef(task.task_ref)
      : normalizeUiTaskRef(task.task_ref, defaults)
  };
}

module.exports = { normalizeApiTaskRef, normalizeUiTaskRef, normalizeFlowTask, normalizeVariableMap };
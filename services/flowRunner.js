/**
 * Execute a flow: run each task (API or UI) in order.
 * Creates one test_run or playwright_run per task, all with flow_id set.
 */
const { Flow, FlowTask, Project, TestRun, PlaywrightRun, FuzzRun } = require('../models');
const { executeTests } = require('./testRunner');
const { runPlaywrightTests } = require('./playwrightRunner');
const { executeFuzz } = require('./fuzzRunner');
const playwrightConfig = require('../config/playwright');
const { getProxyForUrlAsync } = require('../lib/proxyConfig');
const { deriveUrlFromEnvVars } = require('../lib/urlUtils');
const { ensureProjectIsRunnable } = require('./projectStatus');

/**
 * Run a flow by id. Executes each flow task in order; each task creates one run (test_run or playwright_run) with flow_id.
 * @param {number} flowId - Flow ID
 * @param {object} options - { runNamePrefix, baseUrl, envVars }
 * @returns {Promise<{ apiRunIds: number[], uiRunIds: number[], fuzzRunIds: number[] }>}
 */
async function executeFlow(flowId, options = {}) {
  const flow = await Flow.findByPk(flowId, {
    include: [{ model: FlowTask, as: 'flowTasks', order: [['position', 'ASC']] }]
  });
  if (!flow) {
    throw new Error(`Flow with ID ${flowId} not found`);
  }

  const projectId = flow.project_id;
  await ensureProjectIsRunnable(projectId);
  const prefix = options.runNamePrefix || flow.name;
  const baseUrl = options.baseUrl || playwrightConfig.baseUrl || '';
  const envVars = options.envVars || null;
  const uiVariables = options.uiVariables || null;

  const tasks = (flow.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
  if (tasks.length === 0) {
    throw new Error(`Flow "${flow.name}" has no tasks`);
  }

  const apiRunIds = [];
  const uiRunIds = [];
  const fuzzRunIds = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const runName = `${prefix} – ${i + 1}/${tasks.length}`;

    if (task.task_type === 'api') {
      const ref = task.task_ref || {};
      const collectionId = ref.collectionId;
      const path = ref.path; // array of indices e.g. [0, 1]
      if (!collectionId || !Array.isArray(path)) {
        console.warn(`[flowRunner] Skipping invalid API task ${task.id}: missing collectionId or path`);
        continue;
      }

      const testRun = await TestRun.create({
        name: runName,
        status: 'running',
        project_id: projectId,
        flow_id: flowId,
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0,
        run_by_user_id: options?.runByUserId ?? null
      });
      apiRunIds.push(testRun.id);

      const selectedTests = { [collectionId]: [path] };
      const selectedTestsOrdered = [{ collectionId, path, testId: `Step ${i + 1}` }];
      const apiProxy = await getProxyForUrlAsync(deriveUrlFromEnvVars(envVars));

      executeTests(projectId, runName, {
        testRunId: testRun.id,
        selectedTests,
        selectedTestsOrdered,
        envVars,
        proxy: apiProxy
      }).catch((err) => {
        console.error(`[flowRunner] API task ${task.id} failed:`, err);
        TestRun.update({ status: 'failed' }, { where: { id: testRun.id } }).catch(() => {});
      });
    } else if (task.task_type === 'ui') {
      const ref = task.task_ref || {};
      const recordedTestId = ref.recordedTestId;
      if (!recordedTestId) {
        console.warn(`[flowRunner] Skipping invalid UI task ${task.id}: missing recordedTestId`);
        continue;
      }

      const run = await PlaywrightRun.create({
        name: runName,
        status: 'running',
        base_url: baseUrl,
        project_id: projectId,
        flow_id: flowId,
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0
      });
      uiRunIds.push(run.id);
      const uiProxy = await getProxyForUrlAsync(baseUrl);

      runPlaywrightTests({
        playwrightRunId: run.id,
        baseUrl: baseUrl.replace(/\/$/, ''),
        headless: playwrightConfig.headless,
        timeoutMs: playwrightConfig.timeoutMs,
        runOnly: ['recorded-' + recordedTestId],
        proxy: uiProxy,
        uiVariables
      }).catch((err) => {
        console.error(`[flowRunner] UI task ${task.id} failed:`, err);
        PlaywrightRun.update({ status: 'failed' }, { where: { id: run.id } }).catch(() => {});
      });
    } else if (task.task_type === 'fuzz') {
      const ref = task.task_ref || {};
      const apiSpecId = ref.apiSpecId;
      const serverUrl = ref.serverUrl || baseUrl;
      if (!apiSpecId) {
        console.warn(`[flowRunner] Skipping invalid Fuzz task ${task.id}: missing apiSpecId`);
        continue;
      }
      const fuzzRun = await FuzzRun.create({
        name: runName,
        status: 'running',
        project_id: projectId,
        api_spec_id: apiSpecId,
        flow_id: flowId,
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0
      });
      fuzzRunIds.push(fuzzRun.id);
      const fuzzServerUrl = serverUrl.replace(/\/$/, '');
      const fuzzProxy = await getProxyForUrlAsync(fuzzServerUrl);
      executeFuzz(projectId, apiSpecId, runName, {
        fuzzRunId: fuzzRun.id,
        serverUrl: fuzzServerUrl,
        flowId,
        proxy: fuzzProxy
      }).catch((err) => {
        console.error(`[flowRunner] Fuzz task ${task.id} failed:`, err);
        FuzzRun.update({ status: 'failed' }, { where: { id: fuzzRun.id } }).catch(() => {});
      });
    }
  }

  return { apiRunIds, uiRunIds, fuzzRunIds };
}

module.exports = { executeFlow };

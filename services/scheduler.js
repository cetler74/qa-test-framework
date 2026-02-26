/**
 * Scheduler: run flows or full project on cron or repeat interval.
 * On startup loads enabled schedules and registers cron/setInterval jobs.
 */
const cron = require('node-cron');
const cronParser = require('cron-parser');
const { Schedule, Project, Flow, Collection, TestRun, PlaywrightRun, ProjectRecordedTest } = require('../models');
const { executeFlow } = require('./flowRunner');
const { executeTests } = require('./testRunner');
const { runPlaywrightTests } = require('./playwrightRunner');
const playwrightConfig = require('../config/playwright');
const { getProxyForUrl } = require('../lib/proxyConfig');

const cronJobs = new Map();
const intervalIds = new Map();

function computeNextRunAt(schedule) {
  if (schedule.cron_expression) {
    try {
      const interval = cronParser.parseExpression(schedule.cron_expression);
      return interval.next().toDate();
    } catch (e) {
      return null;
    }
  }
  if (schedule.repeat_interval_minutes && schedule.repeat_interval_minutes > 0) {
    const from = schedule.last_run_at ? new Date(schedule.last_run_at) : new Date();
    return new Date(from.getTime() + schedule.repeat_interval_minutes * 60 * 1000);
  }
  return null;
}

async function runScheduledJob(schedule) {
  const projectId = schedule.project_id;
  const flowId = schedule.flow_id;

  try {
    if (flowId) {
      await executeFlow(flowId, { runNamePrefix: `Scheduled: ${schedule.id}` });
    } else {
      // Run whole project: all API collections + all UI recorded tests
      const project = await Project.findByPk(projectId, {
        include: [{ model: require('../models').ApiSpec, as: 'apiSpecs', through: { attributes: [] }, attributes: ['id'] }]
      });
      if (!project) return;

      const projectApiSpecIds = (project.apiSpecs || []).map(s => s.id);
      const collectionsForProject = projectApiSpecIds.length
        ? await Collection.findAll({ where: { api_spec_id: projectApiSpecIds } })
        : [];

      const apiProxy = getProxyForUrl('');

      if (collectionsForProject.length > 0) {
        const testRun = await TestRun.create({
          name: `Scheduled: ${project.name}`,
          status: 'running',
          project_id: projectId,
          total_tests: 0,
          passed_tests: 0,
          failed_tests: 0,
          duration_ms: 0
        });
        executeTests(projectId, testRun.name, {
          testRunId: testRun.id,
          collectionIds: collectionsForProject.map(c => c.id),
          proxy: apiProxy
        }).catch((err) => {
          console.error('[scheduler] Project API run failed:', err);
          TestRun.update({ status: 'failed' }, { where: { id: testRun.id } }).catch(() => {});
        });
      }

      const links = await ProjectRecordedTest.findAll({ where: { project_id: projectId }, attributes: ['recorded_test_id'] });
      const recordedIds = links.map(l => l.recorded_test_id);
      if (recordedIds.length > 0) {
        const baseUrl = playwrightConfig.baseUrl || '';
        const uiProxy = getProxyForUrl(baseUrl);
        const run = await PlaywrightRun.create({
          name: `Scheduled: ${project.name}`,
          status: 'running',
          base_url: baseUrl,
          project_id: projectId,
          total_tests: 0,
          passed_tests: 0,
          failed_tests: 0,
          duration_ms: 0
        });
        const runOnly = recordedIds.map(id => 'recorded-' + id);
        runPlaywrightTests({
          playwrightRunId: run.id,
          baseUrl,
          headless: playwrightConfig.headless,
          timeoutMs: playwrightConfig.timeoutMs,
          runOnly,
          proxy: uiProxy
        }).catch((err) => {
          console.error('[scheduler] Project UI run failed:', err);
          PlaywrightRun.update({ status: 'failed' }, { where: { id: run.id } }).catch(() => {});
        });
      }
    }

    const now = new Date();
    const next = computeNextRunAt({ ...schedule.toJSON(), last_run_at: now });
    await schedule.update({ last_run_at: now, next_run_at: next });
  } catch (err) {
    console.error('[scheduler] Job failed for schedule', schedule.id, err);
    const next = computeNextRunAt(schedule);
    await schedule.update({ last_run_at: new Date(), next_run_at: next }).catch(() => {});
  }
}

async function start() {
  const schedules = await Schedule.findAll({
    where: { enabled: true }
  });

  for (const schedule of schedules) {
    const id = schedule.id;
    if (schedule.cron_expression) {
      try {
        if (!cron.validate(schedule.cron_expression)) {
          console.warn('[scheduler] Invalid cron expression:', schedule.cron_expression, 'for schedule', id);
          continue;
        }
        const job = cron.schedule(schedule.cron_expression, async () => {
          const s = await Schedule.findByPk(id);
          if (s && s.enabled) await runScheduledJob(s);
        });
        cronJobs.set(id, job);
      } catch (e) {
        console.warn('[scheduler] Failed to schedule cron for', id, e.message);
      }
    } else if (schedule.repeat_interval_minutes && schedule.repeat_interval_minutes > 0) {
      const intervalMs = schedule.repeat_interval_minutes * 60 * 1000;
      const idInt = setInterval(async () => {
        const s = await Schedule.findByPk(id);
        if (s && s.enabled) await runScheduledJob(s);
      }, intervalMs);
      intervalIds.set(id, idInt);
    }
  }
  console.log('[scheduler] Started:', cronJobs.size, 'cron job(s),', intervalIds.size, 'interval(s)');
}

function stop() {
  cronJobs.forEach((job) => job.stop());
  cronJobs.clear();
  intervalIds.forEach((id) => clearInterval(id));
  intervalIds.clear();
}

module.exports = { start, stop, computeNextRunAt, runScheduledJob };

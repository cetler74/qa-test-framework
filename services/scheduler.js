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
const { getProxyForUrlAsync } = require('../lib/proxyConfig');
const { ProjectClosedError, ensureProjectIsRunnable } = require('./projectStatus');

const cronJobs = new Map();
const intervalIds = new Map();
const activeScheduleRuns = new Set();

function unregisterSchedule(scheduleId) {
  const cronJob = cronJobs.get(scheduleId);
  if (cronJob) {
    cronJob.stop();
    cronJobs.delete(scheduleId);
  }

  const intervalId = intervalIds.get(scheduleId);
  if (intervalId) {
    clearInterval(intervalId);
    intervalIds.delete(scheduleId);
  }
}

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
  if (activeScheduleRuns.has(schedule.id)) {
    console.log('[scheduler] Skipping overlapping run for schedule', schedule.id);
    return;
  }
  activeScheduleRuns.add(schedule.id);
  const projectId = schedule.project_id;
  const flowId = schedule.flow_id;

  try {
    try {
      await ensureProjectIsRunnable(projectId);
    } catch (err) {
      if (err instanceof ProjectClosedError) {
        console.log('[scheduler] Skipping schedule', schedule.id, 'because project is closed');
        const now = new Date();
        const next = computeNextRunAt({ ...schedule.toJSON(), last_run_at: now });
        await schedule.update({ last_run_at: now, next_run_at: next });
        return;
      }
      throw err;
    }

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

      const apiProxy = await getProxyForUrlAsync('');

      if (collectionsForProject.length > 0) {
        const testRun = await TestRun.create({
          name: `Scheduled: ${project.name}`,
          status: 'running',
          project_id: projectId,
          total_tests: 0,
          passed_tests: 0,
          failed_tests: 0,
          duration_ms: 0,
          run_by_user_id: null
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
        const uiProxy = await getProxyForUrlAsync(baseUrl);
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
  } finally {
    activeScheduleRuns.delete(schedule.id);
  }
}

function registerSchedule(schedule) {
  const id = schedule.id;
  unregisterSchedule(id);

  if (!schedule.enabled) return false;

  if (schedule.cron_expression) {
    if (!cron.validate(schedule.cron_expression)) {
      console.warn('[scheduler] Invalid cron expression:', schedule.cron_expression, 'for schedule', id);
      return false;
    }
    const job = cron.schedule(schedule.cron_expression, async () => {
      const currentSchedule = await Schedule.findByPk(id);
      if (currentSchedule && currentSchedule.enabled) await runScheduledJob(currentSchedule);
    });
    cronJobs.set(id, job);
    return true;
  }

  if (schedule.repeat_interval_minutes && schedule.repeat_interval_minutes > 0) {
    const intervalMs = schedule.repeat_interval_minutes * 60 * 1000;
    const intervalId = setInterval(async () => {
      const currentSchedule = await Schedule.findByPk(id);
      if (currentSchedule && currentSchedule.enabled) await runScheduledJob(currentSchedule);
    }, intervalMs);
    intervalIds.set(id, intervalId);
    return true;
  }

  return false;
}

async function start() {
  const schedules = await Schedule.findAll({
    where: { enabled: true }
  });

  for (const schedule of schedules) {
    try {
      registerSchedule(schedule);
      if (schedule.next_run_at && new Date(schedule.next_run_at) <= new Date()) {
        console.log('[scheduler] Recovering overdue schedule', schedule.id);
        setImmediate(() => runScheduledJob(schedule));
      }
    } catch (e) {
      console.warn('[scheduler] Failed to schedule cron for', schedule.id, e.message);
    }
  }
  console.log('[scheduler] Started:', cronJobs.size, 'cron job(s),', intervalIds.size, 'interval(s)');
}

function stop() {
  [...cronJobs.keys(), ...intervalIds.keys()].forEach(unregisterSchedule);
}

module.exports = { start, stop, computeNextRunAt, runScheduledJob, registerSchedule, unregisterSchedule };

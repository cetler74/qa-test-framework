const { Op } = require('sequelize');
require('dotenv').config();

const {
  Project,
  ProjectTest,
  ProjectTestStat,
  TestRun,
  TestResult,
  PlaywrightRun,
  PlaywrightResult,
  FuzzRun,
  FuzzResult
} = require('../models');

function getArgValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeMethod(value) {
  return normalizeText(value).toUpperCase();
}

function stripQueryAndHash(value) {
  return normalizeText(value).replace(/[?#].*$/, '');
}

function normalizeEndpoint(value) {
  const raw = stripQueryAndHash(value);
  if (!raw) return '';
  try {
    return stripQueryAndHash(new URL(raw).pathname);
  } catch (_) {
    return raw.replace(/^https?:\/\/[^/]+/i, '');
  }
}

function sameEndpoint(a, b) {
  const left = normalizeEndpoint(a);
  const right = normalizeEndpoint(b);
  return !!left && !!right && (left === right || left.endsWith(right) || right.endsWith(left));
}

async function findApiOrSoapProjectTest(projectId, result, runType) {
  const method = normalizeMethod(result.method || (runType === 'soap' ? 'SOAP' : ''));
  const name = normalizeText(result.test_name);
  const endpoint = normalizeText(result.endpoint);
  const testType = runType === 'soap' ? 'soap' : 'api';

  const candidates = await ProjectTest.findAll({
    where: {
      project_id: projectId,
      test_type: testType,
      [Op.or]: [
        { name },
        { endpoint },
        method ? { method } : { method: null }
      ]
    }
  });

  const exact = candidates.find((test) => {
    const testMethod = normalizeMethod(test.method);
    return (!method || testMethod === method) && (test.name === name || sameEndpoint(test.endpoint, endpoint));
  });
  if (exact) return exact;

  const endpointMatch = candidates.filter((test) => sameEndpoint(test.endpoint, endpoint));
  return endpointMatch.length === 1 ? endpointMatch[0] : null;
}

async function findUiProjectTest(projectId, result) {
  const assertions = result.assertions || {};
  if (assertions.source === 'recorded' && assertions.recorded_test_id) {
    const recordedId = parseInt(assertions.recorded_test_id, 10);
    const test = await ProjectTest.findOne({
      where: {
        project_id: projectId,
        test_type: 'ui_recorded',
        source_kind: 'ui_recorded',
        source_id: Number.isInteger(recordedId) ? recordedId : null
      }
    });
    if (test) return test;
  }

  const name = normalizeText(result.test_name);
  if (!name) return null;
  return ProjectTest.findOne({
    where: {
      project_id: projectId,
      test_type: 'ui_recorded',
      [Op.or]: [{ name }, { stable_key: `ui_recorded:${name.replace(/^Recorded:\s*/, '')}` }]
    }
  });
}

async function findFuzzProjectTest(projectId, result) {
  const method = normalizeMethod(result.method);
  const endpoint = normalizeText(result.endpoint);
  if (!method || !endpoint) return null;

  const candidates = await ProjectTest.findAll({
    where: {
      project_id: projectId,
      test_type: 'api',
      method
    }
  });
  const matches = candidates.filter((test) => sameEndpoint(test.endpoint, endpoint));
  return matches.length === 1 ? matches[0] : null;
}

async function backfillLastRunByUser(projectTestId, run) {
  if (!projectTestId || !run || !run.run_by_user_id) return false;
  const stats = await ProjectTestStat.findOne({ where: { project_test_id: projectTestId } });
  if (!stats || stats.last_run_by_user_id || Number(stats.last_run_id) !== Number(run.id)) return false;
  await stats.update({ last_run_by_user_id: run.run_by_user_id });
  return true;
}

async function backfillProject(projectId) {
  const summary = {
    projectId,
    apiSoapLinked: 0,
    uiLinked: 0,
    fuzzLinked: 0,
    lastRunByUsersBackfilled: 0,
    unmatched: 0
  };

  const testRuns = await TestRun.findAll({
    where: { project_id: projectId },
    include: [{ model: TestResult, as: 'testResults', required: false }]
  });
  for (const run of testRuns) {
    const runType = run.run_type === 'soap' ? 'soap' : 'api';
    for (const result of run.testResults || []) {
      const projectTest = result.project_test_id
        ? await ProjectTest.findByPk(result.project_test_id)
        : await findApiOrSoapProjectTest(projectId, result, runType);
      if (!projectTest) {
        summary.unmatched += 1;
        continue;
      }
      if (!result.project_test_id) {
        await result.update({ project_test_id: projectTest.id });
        summary.apiSoapLinked += 1;
      }
      if (await backfillLastRunByUser(projectTest.id, run)) {
        summary.lastRunByUsersBackfilled += 1;
      }
    }
  }

  const playwrightRuns = await PlaywrightRun.findAll({
    where: { project_id: projectId },
    include: [{ model: PlaywrightResult, as: 'results', required: false }]
  });
  for (const run of playwrightRuns) {
    for (const result of run.results || []) {
      const projectTest = result.project_test_id
        ? await ProjectTest.findByPk(result.project_test_id)
        : await findUiProjectTest(projectId, result);
      if (!projectTest) {
        summary.unmatched += 1;
        continue;
      }
      if (!result.project_test_id) {
        await result.update({ project_test_id: projectTest.id });
        summary.uiLinked += 1;
      }
      if (await backfillLastRunByUser(projectTest.id, run)) {
        summary.lastRunByUsersBackfilled += 1;
      }
    }
  }

  const fuzzRuns = await FuzzRun.findAll({
    where: { project_id: projectId },
    include: [{ model: FuzzResult, as: 'fuzzResults', required: false }]
  });
  for (const run of fuzzRuns) {
    for (const result of run.fuzzResults || []) {
      if (result.project_test_id) continue;
      const projectTest = await findFuzzProjectTest(projectId, result);
      if (!projectTest) {
        summary.unmatched += 1;
        continue;
      }
      await result.update({ project_test_id: projectTest.id });
      summary.fuzzLinked += 1;
    }
  }

  return summary;
}

async function main() {
  const projectIdArg = getArgValue('project-id');
  const projectWhere = projectIdArg ? { id: parseInt(projectIdArg, 10) } : {};
  const projects = await Project.findAll({ where: projectWhere, attributes: ['id', 'name'], order: [['id', 'ASC']] });
  if (projectIdArg && projects.length === 0) {
    throw new Error(`Project ${projectIdArg} not found`);
  }

  const summaries = [];
  for (const project of projects) {
    console.log(`Backfilling project ${project.id}: ${project.name}`);
    summaries.push(await backfillProject(project.id));
  }
  console.log(JSON.stringify(summaries, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
  });
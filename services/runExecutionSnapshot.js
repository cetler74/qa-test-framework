const crypto = require('crypto');

const EXECUTION_SNAPSHOT_VERSION = 1;
const MAX_RUN_NAME_LENGTH = 255;

function createInitialRunMetadata(name, snapshot) {
    return {
        execution_snapshot: snapshot,
        execution_snapshot_version: EXECUTION_SNAPSHOT_VERSION,
        rerun_lineage_id: crypto.randomUUID(),
        rerun_number: 0,
        rerun_base_name: String(name).slice(0, MAX_RUN_NAME_LENGTH),
        rerun_source_id: null
    };
}

function buildRerunName(baseName, rerunNumber) {
    const suffix = ` re-run: ${rerunNumber}`;
    const maximumBaseLength = Math.max(0, MAX_RUN_NAME_LENGTH - suffix.length);
    return `${String(baseName).slice(0, maximumBaseLength)}${suffix}`;
}

function getRerunAvailability(run) {
    if ((run.status || '').toLowerCase() === 'running') {
        return { canRerun: false, reason: 'Running tests cannot be rerun.' };
    }
    if (!run.execution_snapshot || run.execution_snapshot_version !== EXECUTION_SNAPSHOT_VERSION || !run.rerun_lineage_id) {
        return { canRerun: false, reason: 'Quick rerun is unavailable for runs created before replay settings were captured.' };
    }
    return { canRerun: true, reason: null };
}

async function allocateRerunMetadata(model, sourceRun, transaction) {
    await model.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:lineageId))', {
        replacements: { lineageId: sourceRun.rerun_lineage_id },
        transaction
    });
    const currentMaximum = await model.max('rerun_number', {
        where: { rerun_lineage_id: sourceRun.rerun_lineage_id },
        transaction
    });
    const rerunNumber = (Number(currentMaximum) || 0) + 1;
    const baseName = sourceRun.rerun_base_name || sourceRun.name;
    return {
        name: buildRerunName(baseName, rerunNumber),
        execution_snapshot: sourceRun.execution_snapshot,
        execution_snapshot_version: EXECUTION_SNAPSHOT_VERSION,
        rerun_lineage_id: sourceRun.rerun_lineage_id,
        rerun_number: rerunNumber,
        rerun_base_name: baseName,
        rerun_source_id: sourceRun.id
    };
}

async function captureRunCatalogueMemberships(runType, runId, projectId) {
    try {
        const { TestResult, PlaywrightResult, FuzzResult, RunCatalogueMembership } = require('../models');
        const mapping = runType === 'ui'
            ? { model: PlaywrightResult, foreignKey: 'playwright_run_id' }
            : runType === 'fuzz'
                ? { model: FuzzResult, foreignKey: 'fuzz_run_id' }
                : { model: TestResult, foreignKey: 'test_run_id' };
        const results = await mapping.model.findAll({
            where: { [mapping.foreignKey]: runId },
            attributes: ['project_test_id', 'execution_order'],
            order: [['execution_order', 'ASC'], ['id', 'ASC']]
        });
        const memberships = results.length > 0
            ? results.map((result, index) => ({
                project_id: projectId,
                run_type: runType,
                run_id: runId,
                project_test_id: result.project_test_id || null,
                association_status: result.project_test_id ? 'exact' : 'unresolved',
                execution_order: result.execution_order ?? index
            }))
            : [{
                project_id: projectId,
                run_type: runType,
                run_id: runId,
                project_test_id: null,
                association_status: 'unresolved',
                execution_order: null
            }];
        await RunCatalogueMembership.destroy({ where: { run_type: runType, run_id: runId } });
        await RunCatalogueMembership.bulkCreate(memberships);
        return true;
    } catch (error) {
        console.error(`[runExecutionSnapshot] Unable to capture ${runType} run ${runId} catalogue memberships:`, error);
        return false;
    }
}

module.exports = {
    EXECUTION_SNAPSHOT_VERSION,
    allocateRerunMetadata,
    buildRerunName,
    captureRunCatalogueMemberships,
    createInitialRunMetadata,
    getRerunAvailability
};
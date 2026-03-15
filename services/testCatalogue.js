const { Op } = require('sequelize');
const {
  Project,
  ApiSpec,
  Collection,
  SoapOperation,
  ProjectTest,
  ProjectTestStat,
  PlaywrightRun,
  ProjectRecordedTest
} = require('../models');
const { getPlaywrightTestList, getPlaywrightTestListWithRecorded } = require('./playwrightRunner');

/**
 * Discover API tests for a project from its collections.
 * Stable key format: api:<collectionId>:<pathString>
 * @param {number} projectId
 * @returns {Promise<Array<{ test_type, stable_key, name, endpoint, method, source_id, source_kind }>>}
 */
async function discoverApiTestsForProject(projectId) {
  const project = await Project.findByPk(projectId, {
    include: [{
      model: ApiSpec,
      as: 'apiSpecs',
      include: [{ model: Collection, as: 'collections' }]
    }]
  });
  if (!project) {
    return [];
  }

  const collections = [];
  // Collections from API specs linked to this project
  (project.apiSpecs || []).forEach((apiSpec) => {
    if (apiSpec.collections) {
      collections.push(...apiSpec.collections);
    }
  });

  // Standalone collections belonging directly to this project
  const standaloneCollections = await Collection.findAll({
    where: { project_id: projectId }
  });
  collections.push(...standaloneCollections);

  const results = [];

  const walkItems = (items, collectionId, parentPath = []) => {
    if (!items || !Array.isArray(items)) return;
    items.forEach((item, index) => {
      const path = [...parentPath, index];
      const pathString = path.join('.');
      if (item.request) {
        const method = item.request?.method || 'GET';
        const url = item.request?.url
          ? (typeof item.request.url === 'string'
            ? item.request.url
            : item.request.url.raw || '')
          : '';
        const baseName = item.name || url || pathString;
        results.push({
          test_type: 'api',
          // Stable key derived only from method + name so it can be recomputed from TestResult rows.
          stable_key: `api:${method}:${baseName}`,
          name: baseName,
          endpoint: url,
          method,
          source_id: collectionId,
          source_kind: 'postman_item'
        });
      } else if (item.item && Array.isArray(item.item)) {
        walkItems(item.item, collectionId, path);
      }
    });
  };

  collections.forEach((coll) => {
    const collectionId = coll.id;
    const collectionJson = coll.collection_json || {};
    const items = collectionJson.item || [];
    walkItems(items, collectionId, []);
  });

  return results;
}

/**
 * Discover SOAP tests for a project from its WSDL ApiSpecs and SoapOperation rows.
 * Stable key format: soap:<apiSpecId>:<operationId>
 * @param {number} projectId
 * @returns {Promise<Array<{ test_type, stable_key, name, endpoint, method, source_id, source_kind }>>}
 */
async function discoverSoapTestsForProject(projectId) {
  // Find all WSDL specs linked to this project
  const project = await Project.findByPk(projectId, {
    include: [{
      model: ApiSpec,
      as: 'apiSpecs',
      where: { format: 'wsdl' },
      required: false
    }]
  });
  if (!project) return [];

  const wsdlSpecs = (project.apiSpecs || []).filter((s) => s.format === 'wsdl');
  if (wsdlSpecs.length === 0) return [];

  const specIds = wsdlSpecs.map((s) => s.id);
  const operations = await SoapOperation.findAll({
    where: { api_spec_id: { [Op.in]: specIds } }
  });

  return operations.map((op) => ({
    test_type: 'soap',
    // Stable key derived from method (operation_name) + name so it can be recomputed from TestResult rows.
    stable_key: `soap:${op.operation_name || 'SOAP'}:${op.name || op.id}`,
    name: op.name || op.operation_name || `SOAP Operation ${op.id}`,
    endpoint: op.operation_name || null,
    method: 'SOAP',
    source_id: op.id,
    source_kind: 'soap_operation'
  }));
}

/**
 * Discover UI tests for a project (built-in + recorded).
 * Built-in stable key: ui_builtin:<id>
 * Recorded stable key: ui_recorded:<numericRecordedId>
 * @param {number} projectId
 * @returns {Promise<Array<{ test_type, stable_key, name, endpoint, method, source_id, source_kind }>>}
 */
async function discoverUiTestsForProject(projectId) {
  const results = [];

  // NOTE: We no longer include built-in UI tests in the catalogue at all.
  // Only recorded UI tests that are explicitly linked to the project are tracked.

  // Recorded tests linked to this project
  const recorded = await getPlaywrightTestListWithRecorded(projectId);
  recorded.forEach((t) => {
    const numericId = String(t.id || '').startsWith('recorded-')
      ? String(t.id).replace('recorded-', '')
      : String(t.id || '');
    results.push({
      test_type: 'ui_recorded',
      stable_key: `ui_recorded:${numericId}`,
      name: t.name || `Recorded ${numericId}`,
      endpoint: t.base_url || null,
      method: 'UI',
      source_id: numericId ? parseInt(numericId, 10) || null : null,
      source_kind: 'ui_recorded'
    });
  });

  return results;
}

/**
 * Sync the project_tests table for a given project from API, SOAP, and UI sources.
 * - Upserts entries by (project_id, stable_key).
 * - Marks entries as inactive if they are no longer discovered.
 * @param {number} projectId
 * @returns {Promise<Array<ProjectTest>>}
 */
async function syncProjectTests(projectId) {
  const id = parseInt(projectId, 10);
  if (!id) {
    throw new Error('Invalid projectId');
  }

  const [apiTests, soapTests, uiTests] = await Promise.all([
    discoverApiTestsForProject(id),
    discoverSoapTestsForProject(id),
    discoverUiTestsForProject(id)
  ]);

  const discovered = [...apiTests, ...soapTests, ...uiTests];
  const discoveredKeys = new Set(discovered.map((t) => t.stable_key));

  // Load existing tests for this project
  const existing = await ProjectTest.findAll({
    where: { project_id: id }
  });

  const existingByKey = new Map();
  existing.forEach((row) => {
    existingByKey.set(row.stable_key, row);
  });

  // Upsert discovered tests
  for (const t of discovered) {
    const existingRow = existingByKey.get(t.stable_key);
    if (existingRow) {
      const updates = {
        test_type: t.test_type,
        name: t.name,
        endpoint: t.endpoint,
        method: t.method,
        source_id: t.source_id,
        source_kind: t.source_kind,
        is_active: true
      };
      await existingRow.update(updates);
    } else {
      const newRow = await ProjectTest.create({
        project_id: id,
        test_type: t.test_type,
        stable_key: t.stable_key,
        name: t.name,
        endpoint: t.endpoint,
        method: t.method,
        source_id: t.source_id,
        source_kind: t.source_kind,
        is_active: true
      });
      // Make sure subsequent duplicates of this stable_key in the same sync
      // pass through the update branch instead of trying to INSERT again.
      existingByKey.set(t.stable_key, newRow);
      // Ensure stats row exists for new tests
      await ProjectTestStat.findOrCreate({
        where: { project_test_id: newRow.id },
        defaults: {
          total_runs: 0,
          last_status: 'not_run'
        }
      });
    }
  }

  // Mark tests that are no longer discovered as inactive (but keep history)
  const toDeactivate = existing.filter((row) => !discoveredKeys.has(row.stable_key) && row.is_active);
  for (const row of toDeactivate) {
    await row.update({ is_active: false });
  }

  // Return full catalogue with stats
  return getProjectTestCatalogue(id);
}

/**
 * Get full catalogue for a project, including stats.
 * @param {number} projectId
 * @returns {Promise<Array>}
 */
async function getProjectTestCatalogue(projectId) {
  const id = parseInt(projectId, 10);
  if (!id) throw new Error('Invalid projectId');

  const rows = await ProjectTest.findAll({
    where: { project_id: id },
    include: [{
      model: ProjectTestStat,
      as: 'stats'
    }],
    order: [
      ['test_type', 'ASC'],
      ['name', 'ASC']
    ]
  });

  return rows;
}

/**
 * Get global catalogue across projects with optional filtering.
 * Filters: projectIds (array), test_type, last_status.
 * @param {{ projectIds?: number[], test_type?: string, last_status?: string }} filters
 * @returns {Promise<Array>}
 */
async function getGlobalTestCatalogue(filters = {}) {
  const where = {};
  if (filters.test_type) {
    where.test_type = filters.test_type;
  }
  if (filters.projectIds && Array.isArray(filters.projectIds) && filters.projectIds.length > 0) {
    where.project_id = { [Op.in]: filters.projectIds };
  }

  const statWhere = {};
  if (filters.last_status) {
    statWhere.last_status = filters.last_status;
  }

  const rows = await ProjectTest.findAll({
    where,
    include: [
      {
        model: ProjectTestStat,
        as: 'stats',
        required: false,
        where: Object.keys(statWhere).length ? statWhere : undefined
      },
      {
        model: Project,
        as: 'project',
        attributes: ['id', 'name']
      }
    ],
    order: [
      ['project_id', 'ASC'],
      ['test_type', 'ASC'],
      ['name', 'ASC']
    ]
  });

  return rows;
}

module.exports = {
  syncProjectTests,
  getProjectTestCatalogue,
  getGlobalTestCatalogue,
  discoverApiTestsForProject,
  discoverSoapTestsForProject,
  discoverUiTestsForProject
};


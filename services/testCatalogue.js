const { Op, literal } = require('sequelize');
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

function normalizeApiOperationPath(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch (e) {
    path = raw
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\{\{[^}]+\}\}/, '')
      .replace(/^\$\{[^}]+\}/, '')
      .replace(/^[^/]*\.([A-Za-z]{2,})(?=\/)/, '');
  }

  path = String(path || '').split('?')[0].split('#')[0].trim();
  if (!path) return null;
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return path.toLowerCase();
}

function buildApiOperationKey(method, url, fallbackName = '', sourcePath = null) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase() || 'GET';
  const normalizedName = String(fallbackName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const normalizedSourcePath = sourcePath != null && sourcePath !== ''
    ? String(sourcePath).trim()
    : '';
  if (normalizedName && normalizedSourcePath) return `${normalizedMethod} path:${normalizedSourcePath} name:${normalizedName}`;
  if (normalizedName) return `${normalizedMethod} name:${normalizedName}`;

  const normalizedPath = normalizeApiOperationPath(url);
  if (normalizedPath) return `${normalizedMethod} ${normalizedPath}`;
  return null;
}

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

  const collectionSources = [];
  // Collections from API specs linked to this project
  (project.apiSpecs || []).forEach((apiSpec) => {
    if (apiSpec.collections) {
      apiSpec.collections.forEach((collection) => {
        collectionSources.push({
          collection,
          apiSpec: {
            id: apiSpec.id,
            name: apiSpec.name,
            original_filename: apiSpec.original_filename
          }
        });
      });
    }
  });

  // Standalone collections belonging directly to this project
  const standaloneCollections = await Collection.findAll({
    where: { project_id: projectId }
  });
  standaloneCollections.forEach((collection) => {
    collectionSources.push({ collection, apiSpec: null });
  });

  const results = [];
  let sourceOrder = 0;

  const normalizeFolderSegment = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\\/]+/g, '-')
    .slice(0, 120);

  const buildFolderPath = (segments) => {
    const cleaned = (segments || []).map(normalizeFolderSegment).filter(Boolean);
    return cleaned.length ? cleaned.join('/') : null;
  };

  const walkItems = (items, collectionId, apiSpec, parentPath = [], parentFolders = []) => {
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
          stable_key: `api:${collectionId}:${pathString}`,
          name: baseName,
          endpoint: url,
          method,
          source_id: collectionId,
          source_kind: 'postman_item',
          source_api_spec_id: apiSpec?.id || null,
          source_api_spec_name: apiSpec?.name || null,
          source_api_spec_original_filename: apiSpec?.original_filename || null,
          source_api_spec_status: 'current',
          source_api_operation_key: buildApiOperationKey(method, url, baseName, pathString),
          source_order: sourceOrder++,
          source_path: pathString,
          default_folder_path: buildFolderPath(parentFolders)
        });
      } else if (item.item && Array.isArray(item.item)) {
        const nextFolders = item.name ? [...parentFolders, item.name] : parentFolders;
        walkItems(item.item, collectionId, apiSpec, path, nextFolders);
      }
    });
  };

  collectionSources.forEach(({ collection: coll, apiSpec }) => {
    const collectionId = coll.id;
    const collectionJson = coll.collection_json || {};
    const items = collectionJson.item || [];
    walkItems(items, collectionId, apiSpec, [], []);
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
    source_kind: 'soap_operation',
    source_order: null,
    source_path: null,
    default_folder_path: null
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
      source_kind: 'ui_recorded',
      source_order: null,
      source_path: null,
      default_folder_path: null
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
  const existingApiByOperationKey = new Map();
  const duplicateOperationRowIds = new Set();
  const duplicateOperationKeys = new Set();
  const operationKeyBackfills = [];
  existing.forEach((row) => {
    existingByKey.set(row.stable_key, row);

    if (row.test_type === 'api' && row.source_kind === 'postman_item') {
      const operationKey = buildApiOperationKey(row.method, row.endpoint, row.name, row.source_path);
      if (operationKey) {
        if (row.source_api_operation_key !== operationKey) {
          row.source_api_operation_key = operationKey;
          operationKeyBackfills.push(row.save());
        }
        const current = existingApiByOperationKey.get(operationKey);
        if (current) {
          const canonical = Number(row.id) < Number(current.id) ? row : current;
          const duplicate = canonical.id === row.id ? current : row;
          existingApiByOperationKey.set(operationKey, canonical);
          duplicateOperationRowIds.add(duplicate.id);
          duplicateOperationKeys.add(operationKey);
        } else {
          existingApiByOperationKey.set(operationKey, row);
        }
      }
    }
  });
  await Promise.all(operationKeyBackfills);

  const matchedExistingIds = new Set();

  const buildUpdatesForDiscoveredTest = (t) => ({
    test_type: t.test_type,
    name: t.name,
    endpoint: t.endpoint,
    method: t.method,
    source_id: t.source_id,
    source_kind: t.source_kind,
    source_api_spec_id: t.source_api_spec_id ?? null,
    source_api_spec_name: t.source_api_spec_name ?? null,
    source_api_spec_original_filename: t.source_api_spec_original_filename ?? null,
    source_api_spec_status: t.source_api_spec_status || 'current',
    source_api_operation_key: t.source_api_operation_key ?? null,
    stale_reason: null,
    stale_at: null,
    source_order: t.source_order ?? null,
    source_path: t.source_path ?? null,
    default_folder_path: t.default_folder_path ?? null
  });

  // Upsert discovered tests (all in parallel)
  await Promise.all(discovered.map(async (t) => {
    const operationKeyRow = t.test_type === 'api' && t.source_api_operation_key
      ? existingApiByOperationKey.get(t.source_api_operation_key)
      : null;
    const existingRow = operationKeyRow || existingByKey.get(t.stable_key);
    if (existingRow) {
      const updates = buildUpdatesForDiscoveredTest(t);
      if (
        !existingRow.is_active
        && (
          existingRow.source_api_spec_status === 'removed_spec'
          || existingRow.source_api_spec_status === 'cleared'
          || (t.test_type === 'api' && t.source_api_operation_key && duplicateOperationKeys.has(t.source_api_operation_key))
        )
      ) {
        updates.is_active = true;
      }
      await existingRow.update(updates);
      matchedExistingIds.add(existingRow.id);
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
        source_api_spec_id: t.source_api_spec_id ?? null,
        source_api_spec_name: t.source_api_spec_name ?? null,
        source_api_spec_original_filename: t.source_api_spec_original_filename ?? null,
        source_api_spec_status: t.source_api_spec_status || 'current',
        source_api_operation_key: t.source_api_operation_key ?? null,
        source_order: t.source_order ?? null,
        source_path: t.source_path ?? null,
        default_folder_path: t.default_folder_path ?? null,
        folder_path_override: null,
        is_active: true
      });
      // Make sure subsequent duplicates of this stable_key in the same sync
      // pass through the update branch instead of trying to INSERT again.
      existingByKey.set(t.stable_key, newRow);
      if (t.source_api_operation_key) {
        existingApiByOperationKey.set(t.source_api_operation_key, newRow);
      }
      // Ensure stats row exists for new tests
      await ProjectTestStat.findOrCreate({
        where: { project_test_id: newRow.id },
        defaults: {
          total_runs: 0,
          last_status: 'not_run'
        }
      });
    }
  }));

  // Mark tests that are no longer discovered as inactive (but keep history)
  const toDeactivate = existing.filter((row) => (
    (!discoveredKeys.has(row.stable_key) || duplicateOperationRowIds.has(row.id))
    && !matchedExistingIds.has(row.id)
    && row.is_active
    && row.source_kind !== 'manual'
  ));
  if (toDeactivate.length > 0) {
    const apiToDeactivate = toDeactivate.filter((row) => row.test_type === 'api');
    const otherToDeactivate = toDeactivate.filter((row) => row.test_type !== 'api');
    if (apiToDeactivate.length > 0) {
      await ProjectTest.update(
        {
          is_active: false,
          source_api_spec_status: 'removed_spec',
          stale_reason: 'Spec no longer linked or operation not found in current specs',
          stale_at: new Date()
        },
        { where: { id: { [Op.in]: apiToDeactivate.map((r) => r.id) } } }
      );
    }
    if (otherToDeactivate.length > 0) {
      await ProjectTest.update(
        { is_active: false },
        { where: { id: { [Op.in]: otherToDeactivate.map((r) => r.id) } } }
      );
    }
  }

  const duplicateRowsToMarkRemoved = existing.filter((row) => (
    duplicateOperationRowIds.has(row.id)
    && !matchedExistingIds.has(row.id)
    && row.test_type === 'api'
    && row.source_kind !== 'manual'
    && row.source_api_spec_status !== 'removed_spec'
    && row.source_api_spec_status !== 'cleared'
  ));
  if (duplicateRowsToMarkRemoved.length > 0) {
    await ProjectTest.update(
      {
        is_active: false,
        source_api_spec_status: 'removed_spec',
        stale_reason: 'Superseded by matching test from current spec',
        stale_at: new Date()
      },
      { where: { id: { [Op.in]: duplicateRowsToMarkRemoved.map((r) => r.id) } } }
    );
  }

  const staleCurrentApiRows = existing.filter((row) => (
    row.test_type === 'api'
    && (row.source_api_spec_status === 'removed_spec' || row.source_api_spec_status === 'cleared')
    && !duplicateOperationRowIds.has(row.id)
    && (discoveredKeys.has(row.stable_key) || matchedExistingIds.has(row.id))
  ));
  if (staleCurrentApiRows.length > 0) {
    await ProjectTest.update(
      { source_api_spec_status: 'current', stale_reason: null, stale_at: null },
      { where: { id: { [Op.in]: staleCurrentApiRows.map((r) => r.id) } } }
    );
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
      [
        literal(`CASE WHEN "ProjectTest"."test_type" = 'api' AND "ProjectTest"."source_order" IS NOT NULL THEN 0 ELSE 1 END`),
        'ASC'
      ],
      [
        literal(`CASE WHEN "ProjectTest"."test_type" = 'api' AND "ProjectTest"."source_order" IS NOT NULL THEN "ProjectTest"."source_order" ELSE 2147483647 END`),
        'ASC'
      ],
      [
        literal(`CASE WHEN ("ProjectTest"."test_type" = 'api' AND "ProjectTest"."source_order" IS NOT NULL) THEN NULL ELSE "ProjectTest"."created_at" END`),
        'ASC'
      ],
      ['id', 'ASC']
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
        required: Object.keys(statWhere).length ? true : false,
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

/**
 * Parse stable_key like api:<collectionId>:<pathString>.
 * Legacy keys api:<method>:<request name> are still supported for old rows.
 * @param {string} stableKey
 * @returns {{ kind: 'path', collectionId: number, path: number[] }|{ kind: 'legacy', method: string, name: string }|null}
 */
function parseApiStableKey(stableKey) {
  if (!stableKey || typeof stableKey !== 'string') return null;
  const parts = stableKey.split(':');
  if (parts[0] !== 'api' || parts.length < 3) return null;
  if (/^\d+$/.test(parts[1] || '')) {
    const pathString = parts.slice(2).join(':');
    const path = pathString.split('.').map((part) => parseInt(part, 10)).filter((part) => !Number.isNaN(part));
    return { kind: 'path', collectionId: parseInt(parts[1], 10), path };
  }
  const method = (parts[1] || 'GET').toUpperCase();
  const name = parts.slice(2).join(':');
  return { kind: 'legacy', method, name };
}

/**
 * Find nested Postman item path for a catalogue stable_key.
 * @param {object} collectionJson
 * @param {string} stableKey
 * @returns {number[]|null}
 */
function findPostmanItemPathInCollection(collectionJson, stableKey) {
  const parsed = parseApiStableKey(stableKey);
  if (!parsed) return null;
  if (parsed.kind === 'path') {
    return parsed.path.length > 0 ? parsed.path : null;
  }
  const wantMethod = parsed.method;
  const wantName = parsed.name;
  let found = null;
  function walk(items, parentPath) {
    if (!items || !Array.isArray(items) || found) return;
    items.forEach((item, index) => {
      if (found) return;
      const path = [...parentPath, index];
      if (item.request) {
        const method = (item.request.method || 'GET').toUpperCase();
        const baseName = item.name || '';
        if (method === wantMethod && baseName === wantName) {
          found = path;
        }
      } else if (item.item) {
        walk(item.item, path);
      }
    });
  }
  walk((collectionJson && collectionJson.item) || [], []);
  return found;
}

/**
 * When source_path is missing (legacy rows), resolve from collection JSON + stable_key.
 * @param {import('../models/ProjectTest')} projectTest
 * @returns {Promise<string|null>}
 */
async function resolvePostmanSourcePathIfNeeded(projectTest) {
  if (!projectTest || projectTest.source_kind !== 'postman_item' || !projectTest.source_id) {
    return projectTest && projectTest.source_path ? projectTest.source_path : null;
  }
  if (projectTest.source_path) return projectTest.source_path;
  const coll = await Collection.findByPk(projectTest.source_id);
  if (!coll || !coll.collection_json) return null;
  const pathArr = findPostmanItemPathInCollection(coll.collection_json, projectTest.stable_key);
  return pathArr ? pathArr.join('.') : null;
}

/**
 * Per-row metadata for single-test Run UI: resolved path + kind (matches POST /tests/:id/run eligibility).
 * @param {Array} rows - Sequelize ProjectTest rows from getProjectTestCatalogue
 * @param {number} projectId
 * @returns {Promise<Array<{ effective_source_path: string|null, single_run_kind: 'api'|'ui_recorded'|null }>>}
 */
async function enrichCatalogueRowsWithSingleRun(rows, projectId) {
  const pid = parseInt(projectId, 10);
  const collIds = [...new Set(rows.map((r) => {
    const p = r.get ? r.get({ plain: true }) : r;
    return (p.source_kind === 'postman_item' && p.source_id && !p.source_path) ? p.source_id : null;
  }).filter(Boolean))];

  const collections = collIds.length === 0 ? [] : await Collection.findAll({ where: { id: collIds } });
  const collMap = new Map(collections.map((c) => [c.id, c]));
  const pathCache = new Map();

  const uiRecordedIds = rows.map((r) => {
    const p = r.get ? r.get({ plain: true }) : r;
    return (p.test_type === 'ui_recorded' && p.source_kind === 'ui_recorded' && p.source_id)
      ? p.source_id
      : null;
  }).filter(Boolean);
  const linkedUi = new Set();
  if (uiRecordedIds.length > 0 && pid) {
    const links = await ProjectRecordedTest.findAll({
      where: {
        project_id: pid,
        recorded_test_id: [...new Set(uiRecordedIds)]
      },
      attributes: ['recorded_test_id']
    });
    links.forEach((l) => linkedUi.add(l.recorded_test_id));
  }

  return rows.map((r) => {
    const plain = r.get ? r.get({ plain: true }) : r;
    let effective_source_path = plain.source_path;
    if (!effective_source_path && plain.source_kind === 'postman_item' && plain.source_id && plain.stable_key) {
      const coll = collMap.get(plain.source_id);
      if (coll && coll.collection_json) {
        const cacheKey = `${plain.source_id}::${plain.stable_key}`;
        if (!pathCache.has(cacheKey)) {
          const pathArr = findPostmanItemPathInCollection(coll.collection_json, plain.stable_key);
          pathCache.set(cacheKey, pathArr ? pathArr.join('.') : null);
        }
        effective_source_path = pathCache.get(cacheKey);
      }
    }

    let single_run_kind = null;
    if (plain.test_type === 'api' && plain.source_kind === 'postman_item' && plain.source_id && effective_source_path) {
      single_run_kind = 'api';
    } else if (
      plain.test_type === 'ui_recorded'
      && plain.source_kind === 'ui_recorded'
      && plain.source_id
      && linkedUi.has(plain.source_id)
    ) {
      single_run_kind = 'ui_recorded';
    }

    return { effective_source_path, single_run_kind };
  });
}

/**
 * Same single-run enrichment as enrichCatalogueRowsWithSingleRun, for rows from multiple projects.
 * @param {Array} rows - Sequelize ProjectTest rows from getGlobalTestCatalogue
 * @returns {Promise<Array<{ effective_source_path: string|null, single_run_kind: 'api'|'ui_recorded'|null }>>}
 */
async function enrichGlobalCatalogueRowsWithSingleRun(rows) {
  const byProject = new Map();
  rows.forEach((r, idx) => {
    const p = r.get ? r.get({ plain: true }) : r;
    const pid = p.project_id;
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid).push({ row: r, idx });
  });
  const metaByIdx = new Array(rows.length);
  await Promise.all(
    [...byProject.entries()].map(async ([pid, items]) => {
      const onlyRows = items.map((i) => i.row);
      const meta = await enrichCatalogueRowsWithSingleRun(onlyRows, pid);
      items.forEach((item, j) => {
        metaByIdx[item.idx] = meta[j];
      });
    })
  );
  return metaByIdx;
}

module.exports = {
  syncProjectTests,
  getProjectTestCatalogue,
  getGlobalTestCatalogue,
  discoverApiTestsForProject,
  discoverSoapTestsForProject,
  discoverUiTestsForProject,
  enrichCatalogueRowsWithSingleRun,
  enrichGlobalCatalogueRowsWithSingleRun,
  resolvePostmanSourcePathIfNeeded,
  findPostmanItemPathInCollection,
  buildApiOperationKey,
  normalizeApiOperationPath
};


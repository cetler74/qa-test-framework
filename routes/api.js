const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse: parseCsv } = require('csv-parse/sync');

const { Project, User, ProjectMember, ApiSpec, Collection, TestRun, TestResult, ProjectApiSpec, PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest, ProjectRecordedTest, Flow, FlowTask, Schedule, SoapOperation, FuzzRun, FuzzResult, ProjectTest, ProjectTestStat, ProjectTestNote } = require('../models');
const { getAccessibleProjectIds, loadProjectAndCheckAccess, userCanAccessProjectId, userCanManageProjectId } = require('../middleware/projectAccess');
const SequelizeLib = require('sequelize');
const { Op, literal } = require('sequelize');
const { convertToPostmanCollection, parsePostmanCollection } = require('../services/apiSpecConverter');
const { upload, uploadTestsImport, validateAndParseApiSpec, validatePostmanCollection, parseWSDLToOperations } = require('../services/fileUpload');
const { executeTests, requestCancelTestRun } = require('../services/testRunner');
const { generateReport, getStableReportPath: getTestRunStableReportPath } = require('../services/reportGenerator');
const { runPlaywrightTests, getPlaywrightTestListWithRecorded } = require('../services/playwrightRunner');
const { executeFlow } = require('../services/flowRunner');
const { computeNextRunAt, runScheduledJob } = require('../services/scheduler');
const { executeSoapTests } = require('../services/soapRunner');
const { executeFuzz, cancelFuzzRun } = require('../services/fuzzRunner');
const { generateFuzzReport, getStableReportPath } = require('../services/fuzzReportGenerator');
const { generatePlaywrightReport } = require('../services/playwrightReportGenerator');
const { syncProjectTests, getProjectTestCatalogue, getGlobalTestCatalogue } = require('../services/testCatalogue');
const playwrightConfig = require('../config/playwright');
const { validateSpecContent } = require('../services/recordedTestValidation');
const codegenSessionManager = require('../services/codegenSessionManager');
const { loadProxyConfig, getProxyByName, getProxyForUrl, getProxyForUrlAsync } = require('../lib/proxyConfig');
const { deriveUrlFromEnvVars } = require('../lib/urlUtils');
const { deleteTestRunArtifacts, deleteFuzzRunArtifacts, deletePlaywrightRunArtifacts } = require('../services/artifactCleanup');
const { postmanToOpenApiYaml } = require('../services/postmanToOpenApi');

/** Extract first soap:address location URL from a WSDL file for proxy inference. Returns '' if not found. */
function getSoapServiceUrlFromWsdl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = content.match(/soap:address\s+location\s*=\s*["']([^"']+)["']/i);
    return m ? m[1].trim() : '';
  } catch (_) {
    return '';
  }
}
function normalizeBaseUrl(value) {
  if (value == null || typeof value !== 'string') return value === undefined ? '' : String(value);
  const s = value.trim();
  if (/^(https?:\/\/)\s*(https?:\/\/)/i.test(s)) return s.replace(/^(https?:\/\/)\s*(https?:\/\/)/i, '$2');
  return s;
}

/** True if collection is standalone on project or linked via ProjectApiSpec (same rules as test catalogue). */
async function collectionBelongsToProject(collectionId, projectId) {
  const cid = parseInt(collectionId, 10);
  const pid = parseInt(projectId, 10);
  if (!cid || !pid) return false;
  const coll = await Collection.findByPk(cid);
  if (!coll) return false;
  if (coll.project_id === pid) return true;
  if (coll.api_spec_id) {
    const link = await ProjectApiSpec.findOne({
      where: { project_id: pid, api_spec_id: coll.api_spec_id }
    });
    return !!link;
  }
  return false;
}

function normalizeFolderPath(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s
    .split('/')
    .map((part) => part.trim().replace(/\s+/g, ' ').replace(/[\\/]+/g, '-'))
    .filter(Boolean)
    .join('/');
  return cleaned ? cleaned.slice(0, 500) : null;
}

function effectiveFolderPathForTest(test) {
  if (!test) return null;
  return test.folder_path_override || test.default_folder_path || null;
}

function normalizeRecordedSpecTitle(specContent, recordedName) {
  if (typeof specContent !== 'string') return specContent;
  const name = typeof recordedName === 'string' ? recordedName.trim() : '';
  if (!name) return specContent;

  // Replace first test('...') title with the recorded name for nicer result labels.
  // Supports: test('x', ...), test("x", ...), test(`x`, ...)
  const quoted = JSON.stringify(name); // produces a valid JS string literal with quotes + escaping
  const re = /\btest\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,/;
  if (!re.test(specContent)) return specContent;
  return specContent.replace(re, `test(${quoted},`);
}

// ==================== USERS ====================

router.get('/users', async (req, res) => {
  try {
    const attrs = ['id', 'username', 'display_name'];
    if (req.user.is_admin) attrs.push('is_admin', 'auth_source', 'suspended');
    const users = await User.findAll({
      attributes: attrs,
      order: [['username', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create user (admin only; local auth must be enabled)
router.post('/users', async (req, res) => {
  try {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
    if (process.env.ENABLE_LOCAL_AUTH === 'false') return res.status(400).json({ error: 'Local auth is disabled' });
    const { username, password, display_name, is_admin } = req.body || {};
    const name = (username || '').trim();
    if (!name) return res.status(400).json({ error: 'Username is required' });
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password is required and must be at least 6 characters' });
    const existing = await User.findOne({ where: { username: name } });
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const hash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      username: name,
      password_hash: hash,
      display_name: (display_name || '').trim() || name,
      auth_source: 'local',
      is_admin: !!is_admin
    });
    res.status(201).json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      is_admin: user.is_admin,
      auth_source: user.auth_source
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// Update user (admin only): display_name, is_admin, suspended; password for local auth only
router.patch('/users/:id', async (req, res) => {
  try {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { display_name, is_admin, suspended, password } = req.body || {};

    const updates = {};
    if (typeof display_name !== 'undefined') updates.display_name = (display_name || '').trim() || user.username;
    if (typeof is_admin !== 'undefined') {
      if (user.id === req.user.id && !is_admin) return res.status(400).json({ error: 'You cannot remove your own admin role' });
      updates.is_admin = !!is_admin;
    }
    if (typeof suspended !== 'undefined') {
      if (user.id === req.user.id && suspended) return res.status(400).json({ error: 'You cannot suspend yourself' });
      updates.suspended = !!suspended;
    }
    if (user.auth_source === 'local' && password !== undefined && password !== '') {
      const pwd = String(password);
      if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updates.password_hash = await bcrypt.hash(pwd, 10);
    }
    await user.update(updates);
    res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      is_admin: user.is_admin,
      auth_source: user.auth_source,
      suspended: user.suspended
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// Delete user (admin only). Cannot delete self.
router.delete('/users/:id', async (req, res) => {
  try {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });
    if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await user.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

// ==================== PROXIES ====================

// Get proxy list from config (for dropdowns and settings)
router.get('/proxies', async (req, res) => {
  try {
    const config = loadProxyConfig();
    const list = Object.entries(config.proxies || {}).map(([name, entry]) => ({
      name,
      http: typeof entry.http === 'string' ? entry.http : '',
      https: typeof entry.https === 'string' ? entry.https : '',
      bypass: typeof entry.bypass === 'string' ? entry.bypass : ''
    }));
    res.json({ activeProxy: config.activeProxy || 'no-proxy', proxies: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PROJECTS ====================

// Get all projects (filtered by access; admin sees all)
router.get('/projects', async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const accessibleIds = await getAccessibleProjectIds(userId, isAdmin);
    const where = accessibleIds === null ? {} : { id: { [Op.in]: accessibleIds } };
    const projects = await Project.findAll({
      where,
      include: [
        { model: ApiSpec, as: 'apiSpecs', through: { attributes: [] } },
        { model: User, as: 'owner', attributes: ['id', 'username', 'display_name'] },
        { model: User, as: 'members', attributes: ['id', 'username', 'display_name'], through: { attributes: [] } }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project (access checked)
router.get('/projects/:id', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, () => {
    const project = req.project;
    Project.findByPk(project.id, {
      include: [
        { model: ApiSpec, as: 'apiSpecs', through: { attributes: [] }, include: [{ model: Collection, as: 'collections' }] },
        { model: User, as: 'owner', attributes: ['id', 'username', 'display_name'] },
        { model: User, as: 'members', attributes: ['id', 'username', 'display_name'], through: { attributes: [] } }
      ]
    }).then(p => {
      if (!p) return res.status(404).json({ error: 'Project not found' });
      const out = p.toJSON();
      out.visibility = p.visibility;
      out.shared_users = (p.members || []).map(m => ({ id: m.id, username: m.username, display_name: m.display_name }));
      out.proxy_name = p.proxy_name || null;
      const resolved = getProxyByName(p.proxy_name);
      out.proxy = resolved ? { name: p.proxy_name, ...resolved } : null;
      res.json(out);
    }).catch(err => res.status(500).json({ error: err.message }));
  }, req.params.id, false);
});

// Create project (owner = current user)
router.post('/projects', async (req, res) => {
  try {
    const { name, description, visibility, shared_user_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const project = await Project.create({
      name,
      description: description || null,
      owner_id: req.user.id,
      visibility: visibility || 'private'
    });
    if (Array.isArray(shared_user_ids) && shared_user_ids.length > 0 && project.visibility === 'shared') {
      await ProjectMember.bulkCreate(shared_user_ids.map(uid => ({ project_id: project.id, user_id: uid })));
    }
    const withAssocs = await Project.findByPk(project.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'username', 'display_name'] },
        { model: User, as: 'members', attributes: ['id', 'username', 'display_name'], through: { attributes: [] } }
      ]
    });
    res.status(201).json(withAssocs);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Project name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update project (manage required; supports visibility + shared_user_ids)
router.put('/projects/:id', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const project = req.project;
      const { name, description, visibility, shared_user_ids, proxy_name } = req.body;
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (visibility !== undefined) updates.visibility = visibility;
      // proxy_name is ignored; proxy is inferred from URL per run (getProxyForUrl)
      await project.update(updates);
      if (Array.isArray(shared_user_ids)) {
        await ProjectMember.destroy({ where: { project_id: project.id } });
        if (shared_user_ids.length > 0) {
          await ProjectMember.bulkCreate(shared_user_ids.map(uid => ({ project_id: project.id, user_id: uid })));
        }
      }
      const updated = await Project.findByPk(project.id, {
        include: [
          { model: User, as: 'owner', attributes: ['id', 'username', 'display_name'] },
          { model: User, as: 'members', attributes: ['id', 'username', 'display_name'], through: { attributes: [] } }
        ]
      });
      res.json(updated);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({ error: 'Project name already exists' });
      }
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// Delete project (manage required)
router.delete('/projects/:id', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const [testRuns, fuzzRuns, playwrightRuns] = await Promise.all([
        TestRun.findAll({ where: { project_id: projectId }, attributes: ['id'] }),
        FuzzRun.findAll({ where: { project_id: projectId }, attributes: ['id', 'report_path'] }),
        PlaywrightRun.findAll({
          where: { project_id: projectId },
          attributes: ['id', 'video_path', 'trace_path'],
          include: [{ model: PlaywrightResult, as: 'results', attributes: ['video_path', 'trace_path'] }]
        })
      ]);
      testRuns.forEach((r) => deleteTestRunArtifacts(r.id));
      fuzzRuns.forEach((r) => {
        deleteFuzzRunArtifacts(r.id, r.report_path);
      });
      playwrightRuns.forEach((run) => {
        const results = (run.results || []).map((r) => ({ video_path: r.video_path, trace_path: r.trace_path }));
        deletePlaywrightRunArtifacts(run, results);
      });
      await FuzzRun.destroy({ where: { project_id: projectId } });
      await req.project.destroy();
      res.json({ message: 'Project deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// ==================== PROJECT TEST CATALOGUE ====================

// Sync project test catalogue from API specs, SOAP operations, and UI tests (manage required)
router.post('/projects/:id/tests/catalogue/sync', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });
      const rows = await syncProjectTests(projectId);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// Get project test catalogue (access required); enriches stats with last_run_by_username and last_run_by_user_id
router.get('/projects/:id/tests/catalogue', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const rows = await getProjectTestCatalogue(req.project.id);
      const lastRunIds = [...new Set(rows.map(r => r.stats?.last_run_id).filter(Boolean))];
      const lastRunByUserIds = [...new Set(rows.map(r => r.stats?.last_run_by_user_id).filter(Boolean))];
      let runByMap = {};
      if (lastRunIds.length > 0) {
        const runs = await TestRun.findAll({
          where: { id: lastRunIds },
          include: [{ model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name'], required: false }]
        });
        runs.forEach(r => {
          const u = r.runByUser;
          runByMap[r.id] = u ? (u.display_name || u.username || '') : null;
        });
      }
      let userByMap = {};
      if (lastRunByUserIds.length > 0) {
        const users = await User.findAll({
          where: { id: lastRunByUserIds },
          attributes: ['id', 'username', 'display_name']
        });
        users.forEach(u => {
          userByMap[u.id] = u.display_name || u.username || '';
        });
      }
      const out = rows.map(r => {
        const plain = r.get ? r.get({ plain: true }) : r;
        const stats = plain.stats || {};
        const fromRun = stats.last_run_id ? runByMap[stats.last_run_id] : null;
        const fromUser = stats.last_run_by_user_id ? userByMap[stats.last_run_by_user_id] : null;
        stats.last_run_by_username = fromRun ?? fromUser ?? null;
        return {
          ...plain,
          stats,
          effective_folder_path: effectiveFolderPathForTest(plain)
        };
      });
      res.json(out);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

// Export project test catalogue (CSV, access required)
router.get('/projects/:id/tests/catalogue/export', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const tests = await getProjectTestCatalogue(projectId);

      const header = [
        'Name',
        'Type',
        'Last status',
        'Last run',
        'Total runs',
        'Active',
        'Description',
        'Ticket URL',
        'Folder',
        'Default folder path',
        'Folder override'
      ];

      const escapeCsv = (value) => {
        if (value == null) return '';
        const str = String(value);
        // Quote when value may break ';'-delimited CSV (commas/quotes/semicolons/newlines)
        if (/[",;\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const lines = [];
      lines.push(header.map(escapeCsv).join(';'));

      for (const t of tests) {
        const stats = t.stats || {};
        const lastStatus = stats.last_status || 'not_run';
        const lastRunAt = stats.last_run_at ? new Date(stats.last_run_at).toISOString() : '';
        const totalRuns = stats.total_runs != null ? stats.total_runs : 0;
        const typeLabel =
          t.test_type === 'soap' ? 'SOAP' :
          t.test_type === 'ui_builtin' ? 'UI (built-in)' :
          t.test_type === 'ui_recorded' ? 'UI (recorded)' :
          'API';
        const row = [
          t.name || '',
          typeLabel,
          lastStatus,
          lastRunAt,
          totalRuns,
          t.is_active ? 'Yes' : 'No',
          t.description || '',
          t.ticket_url || '',
          effectiveFolderPathForTest(t) || '',
          t.default_folder_path || '',
          t.folder_path_override || ''
        ];
        lines.push(row.map(escapeCsv).join(';'));
      }

      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="project_${projectId}_tests_coverage.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

// Download import template (CSV with header + example row)
router.get('/projects/:id/tests/catalogue/template', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const escapeCsv = (value) => {
        if (value == null) return '';
        const str = String(value);
        // Quote when value may break ';'-delimited CSV
        if (/[",;\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      const header = ['Name', 'Type', 'Method', 'Endpoint', 'Description', 'Ticket URL', 'Folder path', 'Active'];
      const exampleRow = ['Get health', 'API', 'GET', '/health', 'Optional description', 'https://jira.example.com/KEY-1', 'Release/Smoke', 'Yes'];
      const lines = [
        header.map(escapeCsv).join(';'),
        exampleRow.map(escapeCsv).join(';')
      ];
      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tests_import_template.csv"');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

// Per-project tests & coverage summary + time series (access required)
router.get('/projects/:id/tests/coverage-summary', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;

      // Load catalogue with stats
      const allTests = await ProjectTest.findAll({
        where: { project_id: projectId },
        include: [{ model: ProjectTestStat, as: 'stats' }]
      });

      // Only active tests are counted towards current coverage totals (includes manual tests)
      const tests = allTests.filter(t => t.is_active);

      const summary = {
        total_tests: tests.length,
        active_tests: tests.length,
        tests_ever_run: 0,
        last_status_counts: {
          passed: 0,
          failed: 0,
          partial_failed: 0,
          not_run: 0,
          other: 0
        }
      };
      const byFolder = {};

      // Bucket every active test by last_status so manual status changes (Passed/Failed) are reflected
      for (const t of tests) {
        const stats = t.stats;
        const lastStatus = (stats && stats.last_status) ? String(stats.last_status).toLowerCase() : 'not_run';
        const folderKey = effectiveFolderPathForTest(t) || '(No folder)';
        if (!byFolder[folderKey]) {
          byFolder[folderKey] = {
            folder_path: folderKey === '(No folder)' ? null : folderKey,
            total_tests: 0,
            tests_ever_run: 0,
            last_status_counts: {
              passed: 0,
              failed: 0,
              partial_failed: 0,
              not_run: 0,
              other: 0
            }
          };
        }
        byFolder[folderKey].total_tests += 1;
        if (lastStatus === 'passed') summary.last_status_counts.passed += 1;
        else if (lastStatus === 'failed') summary.last_status_counts.failed += 1;
        else if (lastStatus === 'partial_failed') summary.last_status_counts.partial_failed += 1;
        else if (lastStatus === 'not_run') summary.last_status_counts.not_run += 1;
        else summary.last_status_counts.other += 1;
        if (lastStatus === 'passed') byFolder[folderKey].last_status_counts.passed += 1;
        else if (lastStatus === 'failed') byFolder[folderKey].last_status_counts.failed += 1;
        else if (lastStatus === 'partial_failed') byFolder[folderKey].last_status_counts.partial_failed += 1;
        else if (lastStatus === 'not_run') byFolder[folderKey].last_status_counts.not_run += 1;
        else byFolder[folderKey].last_status_counts.other += 1;
        if (stats && stats.total_runs > 0) {
          summary.tests_ever_run += 1;
          byFolder[folderKey].tests_ever_run += 1;
        }
      }

      const folders = Object.values(byFolder).map((bucket) => {
        const last = bucket.last_status_counts || {};
        const covered = (last.passed || 0) + (last.failed || 0) + (last.partial_failed || 0);
        const total = bucket.total_tests || 0;
        return {
          ...bucket,
          covered_tests: covered,
          coverage_pct: total > 0 ? Math.round((covered / total) * 100) : 0
        };
      }).sort((a, b) => (a.folder_path || '').localeCompare(b.folder_path || ''));

      // Time series: total / passed / failed tests run per day from API/SOAP and UI runs
      const sequelize = TestRun.sequelize;
      const rows = await sequelize.query(
        `
          SELECT
            day::date AS day,
            SUM(total_tests) AS total_tests,
            SUM(passed_tests) AS passed_tests,
            SUM(failed_tests) AS failed_tests
          FROM (
            SELECT
              date_trunc('day', created_at) AS day,
              COALESCE(total_tests, 0) AS total_tests,
              COALESCE(passed_tests, 0) AS passed_tests,
              COALESCE(failed_tests, 0) AS failed_tests
            FROM test_runs
            WHERE project_id = :projectId
            UNION ALL
            SELECT
              date_trunc('day', created_at) AS day,
              COALESCE(total_tests, 0) AS total_tests,
              COALESCE(passed_tests, 0) AS passed_tests,
              COALESCE(failed_tests, 0) AS failed_tests
            FROM playwright_runs
            WHERE project_id = :projectId
          ) AS combined
          GROUP BY day
          ORDER BY day ASC
        `,
        {
          replacements: { projectId },
          type: sequelize.QueryTypes.SELECT
        }
      );

      const timeseries = Array.isArray(rows)
        ? rows.map(r => ({
            day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
            total_tests: Number(r.total_tests) || 0,
            passed_tests: Number(r.passed_tests) || 0,
            failed_tests: Number(r.failed_tests) || 0
          }))
        : [];

      res.json({ summary, folders, timeseries });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

// Delete all catalogue entries for a project (manage required)
router.delete('/projects/:id/tests/catalogue', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });
      await ProjectTest.destroy({ where: { project_id: projectId } });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// Create a manual project test (manage required)
router.post('/projects/:id/tests', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });

      const {
        name,
        test_type,
        method,
        endpoint,
        description,
        is_active,
        ticket_url,
        folder_path_override
      } = req.body || {};

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Name is required' });
      }

      const type = (test_type || 'api').toString();
      const stableKey = `manual:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

      const test = await ProjectTest.create({
        project_id: projectId,
        test_type: type,
        stable_key: stableKey,
        name,
        endpoint: endpoint || null,
        method: method || null,
        description: description || null,
        ticket_url: ticket_url || null,
        default_folder_path: null,
        folder_path_override: normalizeFolderPath(folder_path_override),
        source_id: null,
        source_kind: 'manual',
        is_active: is_active !== false
      });

      const [stats] = await ProjectTestStat.findOrCreate({
        where: { project_test_id: test.id },
        defaults: {
          total_runs: 0,
          last_status: 'not_run'
        }
      });

      // Register a note that this test was created manually
      await ProjectTestNote.create({
        project_test_id: test.id,
        author_id: req.user.id,
        note: `Manual test created (type=${type}, method=${method || ''}, endpoint=${endpoint || ''}).`
      }).catch(() => {});

      const reloaded = await ProjectTest.findByPk(test.id, {
        include: [{ model: ProjectTestStat, as: 'stats' }]
      });
      const plain = reloaded.get ? reloaded.get({ plain: true }) : reloaded;
      res.status(201).json({ ...plain, effective_folder_path: effectiveFolderPathForTest(plain) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// Bulk import project tests from CSV (manage required)
router.post('/projects/:id/tests/import', uploadTestsImport.single('file'), (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      if (!req.file || !req.file.path || !fs.existsSync(req.file.path)) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });

      const raw = fs.readFileSync(req.file.path, 'utf8');
      let rows;
      try {
        rows = parseCsv(raw, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          delimiter: ';'
        });
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid CSV: ' + (parseErr.message || 'parse error') });
      }

      const created = [];
      const errors = [];

      const normalizeType = (v) => {
        if (v == null || v === '') return 'api';
        const s = String(v).trim().toLowerCase();
        if (s === 'soap') return 'soap';
        if (s === 'other') return 'other';
        if (s === 'ui (recorded)' || s === 'ui_recorded' || s === 'ui recorded') return 'ui_recorded';
        if (s === 'manual' || s === 'manual test') return 'manual';
        return 'api';
      };

      const normalizeActive = (v) => {
        if (v == null || v === '') return true;
        const s = String(v).trim().toLowerCase();
        if (s === 'no' || s === 'false' || s === '0') return false;
        return true;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // 1-based, +1 for header
        const get = (key) => {
          const k = Object.keys(row).find((x) => x.trim().toLowerCase() === key.toLowerCase());
          return k != null ? (row[k] != null ? String(row[k]).trim() : '') : '';
        };
        const name = get('name');
        if (!name) {
          errors.push({ row: rowNum, message: 'Name is required' });
          continue;
        }
        const type = normalizeType(get('type'));
        const method = get('method') || null;
        const endpoint = get('endpoint') || null;
        const description = get('description') || null;
        const ticket_url = get('ticket url') || get('ticket_url') || null;
        const folder_path_override = normalizeFolderPath(get('folder path') || get('folder_path') || get('folder'));
        const is_active = normalizeActive(get('active'));

        try {
          const stableKey = `manual:${type}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
          const test = await ProjectTest.create({
            project_id: projectId,
            test_type: type,
            stable_key: stableKey,
            name,
            endpoint: endpoint || null,
            method: method || null,
            description: description || null,
            ticket_url: ticket_url || null,
            default_folder_path: null,
            folder_path_override,
            source_id: null,
            source_kind: 'manual',
            is_active
          });
          await ProjectTestStat.findOrCreate({
            where: { project_test_id: test.id },
            defaults: { total_runs: 0, last_status: 'not_run' }
          });
          await ProjectTestNote.create({
            project_test_id: test.id,
            author_id: req.user.id,
            note: `Imported from file (type=${type}, method=${method || ''}, endpoint=${endpoint || ''}).`
          }).catch(() => {});
          created.push(test.id);
        } catch (err) {
          errors.push({ row: rowNum, message: err.message || 'Failed to create test' });
        }
      }

      try { fs.unlinkSync(req.file.path); } catch (_) {}

      res.json({ created: created.length, errors });
    } catch (error) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

// Update a single project test (name, description, method, endpoint, type, is_active) (manage required)
router.patch('/projects/:projectId/tests/:testId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });
      const testId = parseInt(req.params.testId, 10);
      if (!testId) return res.status(400).json({ error: 'Invalid test id' });
      const test = await ProjectTest.findOne({
        where: { id: testId, project_id: projectId }
      });
      if (!test) return res.status(404).json({ error: 'Project test not found' });
      const {
        name,
        description,
        is_active,
        method,
        endpoint,
        test_type,
        ticket_url,
        folder_path_override,
        last_status,
        last_run_by_user_id: bodyLastRunByUserId
      } = req.body || {};

      const before = test.get ? test.get({ plain: true }) : { ...test };
      const beforeStat = await ProjectTestStat.findOne({ where: { project_test_id: testId } });
      const beforeLastStatus = beforeStat ? beforeStat.last_status : null;

      const updates = {};
      if (typeof name !== 'undefined') updates.name = name;
      if (typeof description !== 'undefined') updates.description = description;
      if (typeof is_active !== 'undefined') updates.is_active = !!is_active;
      if (typeof method !== 'undefined') updates.method = method || null;
      if (typeof endpoint !== 'undefined') updates.endpoint = endpoint || null;
      if (typeof test_type !== 'undefined') updates.test_type = test_type;
      if (typeof ticket_url !== 'undefined') updates.ticket_url = ticket_url || null;
      if (typeof folder_path_override !== 'undefined') updates.folder_path_override = normalizeFolderPath(folder_path_override);
      await test.update(updates);

      const statUpdates = {};
      if (last_status !== undefined && last_status !== null) {
        const allowed = ['not_run', 'passed', 'failed', 'partial_failed', 'running', 'cancelled'];
        const status = String(last_status).trim().toLowerCase();
        if (allowed.includes(status)) {
          statUpdates.last_status = status;
          statUpdates.last_run_at = new Date();
        }
      }
      if (bodyLastRunByUserId !== undefined) {
        const uid = bodyLastRunByUserId === null || bodyLastRunByUserId === '' ? null : parseInt(bodyLastRunByUserId, 10);
        statUpdates.last_run_by_user_id = Number.isInteger(uid) ? uid : (req.user?.id ?? null);
      }
      if (Object.keys(statUpdates).length > 0) {
        await ProjectTestStat.findOrCreate({
          where: { project_test_id: testId },
          defaults: { total_runs: 0, last_status: 'not_run' }
        });
        await ProjectTestStat.update(statUpdates, { where: { project_test_id: testId } });
      }

      const reloaded = await ProjectTest.findByPk(test.id, {
        include: [{ model: ProjectTestStat, as: 'stats' }]
      });

      // If any field changed, record a manual-edit note
      try {
        const after = reloaded.get ? reloaded.get({ plain: true }) : { ...reloaded };
        const afterStat = after.stats || {};
        const diffs = [];
        const fieldsToTrack = ['name', 'description', 'method', 'endpoint', 'test_type', 'is_active', 'folder_path_override'];
        fieldsToTrack.forEach((field) => {
          if (before[field] !== after[field]) {
            const beforeVal = typeof before[field] === 'boolean' ? (before[field] ? 'true' : 'false') : (before[field] ?? '');
            const afterVal = typeof after[field] === 'boolean' ? (after[field] ? 'true' : 'false') : (after[field] ?? '');
            diffs.push(`${field}: "${beforeVal}" -> "${afterVal}"`);
          }
        });
        if (beforeLastStatus !== (afterStat.last_status || null)) {
          diffs.push(`last_status: "${beforeLastStatus || ''}" -> "${afterStat.last_status || ''}"`);
        }
        if (diffs.length > 0) {
          await ProjectTestNote.create({
            project_test_id: test.id,
            author_id: req.user.id,
            note: `Manual edit: ${diffs.join('; ')}`
          });
        }
      } catch (e) {
        // Ignore note errors to avoid blocking main update
      }

      const plain = reloaded.get ? reloaded.get({ plain: true }) : reloaded;
      res.json({ ...plain, effective_folder_path: effectiveFolderPathForTest(plain) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// Delete a single project test (manage required)
router.delete('/projects/:projectId/tests/:testId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden' });
      const testId = parseInt(req.params.testId, 10);
      if (!testId) return res.status(400).json({ error: 'Invalid test id' });
      const test = await ProjectTest.findOne({
        where: { id: testId, project_id: projectId }
      });
      if (!test) return res.status(404).json({ error: 'Project test not found' });
      await test.destroy();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// Run a single catalogue test (API Postman item or UI recorded) — project access required
router.post('/projects/:projectId/tests/:testId/run', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const testId = parseInt(req.params.testId, 10);
      if (!testId) return res.status(400).json({ error: 'Invalid test id' });

      const test = await ProjectTest.findOne({
        where: { id: testId, project_id: projectId }
      });
      if (!test) return res.status(404).json({ error: 'Project test not found' });

      const { name: bodyName, envVars: bodyEnvVars, baseUrl: bodyBaseUrl } = req.body || {};
      const runName = (bodyName && String(bodyName).trim()) || `[Single] ${test.name || 'test'}`;

      const testOptions = {};
      if (bodyEnvVars && typeof bodyEnvVars === 'object') {
        testOptions.envVars = {};
        for (const [k, v] of Object.entries(bodyEnvVars)) {
          testOptions.envVars[k] = normalizeBaseUrl(String(v));
        }
      }

      if (test.test_type === 'api' && test.source_kind === 'postman_item' && test.source_id && test.source_path) {
        const ok = await collectionBelongsToProject(test.source_id, projectId);
        if (!ok) return res.status(400).json({ error: 'Collection is not available for this project' });

        const pathParts = String(test.source_path).split('.').map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n));
        if (pathParts.length === 0) return res.status(400).json({ error: 'Invalid test source path' });

        const selectedTests = { [test.source_id]: [pathParts] };
        const derivedUrl = deriveUrlFromEnvVars(testOptions.envVars);
        const proxy = await getProxyForUrlAsync(derivedUrl);

        const testRun = await TestRun.create({
          name: runName,
          status: 'running',
          project_id: projectId,
          total_tests: 0,
          passed_tests: 0,
          failed_tests: 0,
          duration_ms: 0,
          run_by_user_id: req.user?.id ?? null
        });

        executeTests(projectId, runName, { ...testOptions, testRunId: testRun.id, selectedTests, proxy })
          .then(() => {
            setImmediate(() => {
              generateReport(testRun.id, { skipCache: true, writeToStablePath: true })
                .catch((err) => console.error('[api] Pre-generate test report failed:', err));
            });
          })
          .catch((error) => {
            console.error(`[api] Single test run ${testRun.id} failed:`, error);
            TestRun.update({ status: 'failed' }, { where: { id: testRun.id } }).catch(() => {});
          });

        return res.status(201).json({
          testRun: { id: testRun.id },
          status: 'running',
          message: 'Test execution started'
        });
      }

      if (test.test_type === 'ui_recorded' && test.source_kind === 'ui_recorded' && test.source_id) {
        const link = await ProjectRecordedTest.findOne({
          where: { project_id: projectId, recorded_test_id: test.source_id }
        });
        if (!link) return res.status(400).json({ error: 'Recorded UI test is not linked to this project' });

        const url = (bodyBaseUrl && typeof bodyBaseUrl === 'string' && bodyBaseUrl.trim())
          ? bodyBaseUrl.trim().replace(/\/$/, '')
          : (test.endpoint && String(test.endpoint).trim())
            ? String(test.endpoint).trim().replace(/\/$/, '')
            : undefined;

        const validBrowsers = ['chromium', 'firefox', 'webkit'];
        const browserName = validBrowsers.includes(req.body.browser) ? req.body.browser : 'chromium';
        const videoOpt = ['off', 'on', 'retain-on-failure'].includes(req.body.video) ? req.body.video : 'off';
        const traceOpt = ['off', 'on', 'retain-on-failure'].includes(req.body.trace) ? req.body.trace : 'off';
        const slowMo = typeof req.body.slowMo === 'number' && req.body.slowMo >= 0 ? req.body.slowMo : 0;

        const proxy = await getProxyForUrlAsync(url || playwrightConfig.baseUrl || '');
        let headless = typeof req.body.headless === 'boolean' ? req.body.headless : playwrightConfig.headless;
        const hasDisplay = process.platform === 'win32' || !!process.env.DISPLAY;
        if (!hasDisplay && !headless) headless = true;
        let timeoutMs = playwrightConfig.timeoutMs;
        if (typeof req.body.timeoutMs === 'number' && req.body.timeoutMs > 0) timeoutMs = req.body.timeoutMs;
        else if (typeof req.body.timeoutSeconds === 'number' && req.body.timeoutSeconds > 0) timeoutMs = req.body.timeoutSeconds * 1000;

        const run = await PlaywrightRun.create({
          name: runName,
          status: 'running',
          base_url: url || '',
          project_id: projectId,
          total_tests: 0,
          passed_tests: 0,
          failed_tests: 0,
          duration_ms: 0,
          browser_name: browserName
        });

        runPlaywrightTests({
          playwrightRunId: run.id,
          baseUrl: url,
          headless,
          timeoutMs,
          runOnly: [`recorded-${test.source_id}`],
          video: videoOpt,
          trace: traceOpt,
          browserName,
          slowMo,
          proxy
        })
          .then(() => console.log(`[api] Single UI test run ${run.id} completed`))
          .catch(async (err) => {
            console.error(`[api] Single UI test run ${run.id} failed:`, err);
            const current = await PlaywrightRun.findByPk(run.id, { attributes: ['status'] });
            if (current && current.status === 'cancelled') return;
            await PlaywrightRun.update({ status: 'failed' }, { where: { id: run.id } }).catch(() => {});
          });

        return res.status(201).json({
          playwrightRun: { id: run.id },
          status: 'running',
          message: 'UI test execution started'
        });
      }

      return res.status(400).json({ error: 'This test type cannot be run from the catalogue (manual tests or unsupported source)' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, false);
});

// Global test catalogue across projects (access-filtered)
router.get('/tests/catalogue', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    if (accessibleIds !== null && accessibleIds.length === 0) {
      return res.json([]);
    }
    const { projectId, test_type, last_status } = req.query;
    let projectIds = null;
    if (projectId) {
      const pid = parseInt(projectId, 10);
      if (pid) projectIds = [pid];
    } else if (accessibleIds !== null) {
      projectIds = accessibleIds;
    }
    const rows = await getGlobalTestCatalogue({
      projectIds,
      test_type: test_type || undefined,
      last_status: last_status || undefined
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard summary: global coverage + daily activity (all accessible projects)
router.get('/dashboard/summary', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    const coverage = {
      total_active: 0,
      covered: 0,
      coverage_pct: 0,
      passed: 0,
      failed: 0
    };
    const activity = {
      timeseries: [],
      tests_today: 0,
      tests_last_7_days: 0
    };

    if (accessibleIds !== null && accessibleIds.length === 0) {
      return res.json({ coverage, activity });
    }

    const projectIds = accessibleIds !== null ? accessibleIds : (await Project.findAll({ attributes: ['id'] })).map(p => p.id);
    if (projectIds.length === 0) {
      return res.json({ coverage, activity });
    }

    // Coverage: aggregate active tests and last_status across all accessible projects
    const allTests = await ProjectTest.findAll({
      where: { project_id: { [Op.in]: projectIds }, is_active: true },
      include: [{ model: ProjectTestStat, as: 'stats' }]
    });
    for (const t of allTests) {
      coverage.total_active += 1;
      const stats = t.stats;
      const lastStatus = (stats && stats.last_status) ? String(stats.last_status).toLowerCase() : 'not_run';
      if (lastStatus === 'passed') {
        coverage.passed += 1;
        coverage.covered += 1;
      } else if (lastStatus === 'failed' || lastStatus === 'partial_failed') {
        coverage.failed += 1;
        coverage.covered += 1;
      }
    }
    coverage.coverage_pct = coverage.total_active > 0 ? Math.round((coverage.covered / coverage.total_active) * 100) : 0;

    // Activity: time series from test_runs, playwright_runs, fuzz_runs (last 14 days)
    const sequelize = TestRun.sequelize;
    const daysBack = 14;
    const placeholders = projectIds.map((_, i) => `:pid${i}`).join(', ');
    const replacements = { daysBack };
    projectIds.forEach((id, i) => { replacements[`pid${i}`] = id; });

    const rows = await sequelize.query(
      `
      SELECT
        day::date AS day,
        SUM(total_tests) AS total_tests,
        SUM(passed_tests) AS passed_tests,
        SUM(failed_tests) AS failed_tests
      FROM (
        SELECT
          date_trunc('day', created_at) AS day,
          COALESCE(total_tests, 0) AS total_tests,
          COALESCE(passed_tests, 0) AS passed_tests,
          COALESCE(failed_tests, 0) AS failed_tests
        FROM test_runs
        WHERE project_id IN (${placeholders})
          AND created_at >= (CURRENT_DATE - INTERVAL '1 day' * :daysBack)
        UNION ALL
        SELECT
          date_trunc('day', created_at) AS day,
          COALESCE(total_tests, 0) AS total_tests,
          COALESCE(passed_tests, 0) AS passed_tests,
          COALESCE(failed_tests, 0) AS failed_tests
        FROM playwright_runs
        WHERE project_id IN (${placeholders})
          AND created_at >= (CURRENT_DATE - INTERVAL '1 day' * :daysBack)
        UNION ALL
        SELECT
          date_trunc('day', created_at) AS day,
          COALESCE(total_tests, 0) AS total_tests,
          COALESCE(passed_tests, 0) AS passed_tests,
          COALESCE(failed_tests, 0) AS failed_tests
        FROM fuzz_runs
        WHERE project_id IN (${placeholders})
          AND created_at >= (CURRENT_DATE - INTERVAL '1 day' * :daysBack)
      ) AS combined
      GROUP BY day
      ORDER BY day ASC
      `,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT
      }
    );

    const timeseries = Array.isArray(rows)
      ? rows.map(r => ({
          day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
          total_tests: Number(r.total_tests) || 0,
          passed_tests: Number(r.passed_tests) || 0,
          failed_tests: Number(r.failed_tests) || 0
        }))
      : [];
    activity.timeseries = timeseries;

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const row of timeseries) {
      if (row.day === today) activity.tests_today += row.total_tests;
    }
    activity.tests_last_7_days = timeseries
      .filter(r => r.day >= sevenDaysAgo && r.day <= today)
      .reduce((sum, r) => sum + r.total_tests, 0);

    res.json({ coverage, activity });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Notes for a single project test (access required)
router.get('/projects/:projectId/tests/:testId/notes', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const testId = parseInt(req.params.testId, 10);
      if (!testId) return res.status(400).json({ error: 'Invalid test id' });
      const test = await ProjectTest.findOne({
        where: { id: testId, project_id: projectId }
      });
      if (!test) return res.status(404).json({ error: 'Project test not found' });
      const notes = await ProjectTestNote.findAll({
        where: { project_test_id: test.id },
        order: [['created_at', 'DESC']]
      });
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, false);
});

// Add a note to a project test (access required)
router.post('/projects/:projectId/tests/:testId/notes', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const testId = parseInt(req.params.testId, 10);
      if (!testId) return res.status(400).json({ error: 'Invalid test id' });
      const test = await ProjectTest.findOne({
        where: { id: testId, project_id: projectId }
      });
      if (!test) return res.status(404).json({ error: 'Project test not found' });
      const { note } = req.body || {};
      if (!note || !String(note).trim()) {
        return res.status(400).json({ error: 'note is required' });
      }
      const created = await ProjectTestNote.create({
        project_test_id: test.id,
        author_id: req.user && req.user.id ? req.user.id : null,
        note: String(note).trim()
      });
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, false);
});

// Add API spec to project (manage required)
router.post('/projects/:projectId/api-specs/:apiSpecId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const { projectId, apiSpecId } = req.params;
      const apiSpec = await ApiSpec.findByPk(apiSpecId);
      if (!apiSpec) return res.status(404).json({ error: 'API spec not found' });
      await ProjectApiSpec.findOrCreate({ where: { project_id: projectId, api_spec_id: apiSpecId } });
      res.json({ message: 'API spec added to project' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// Remove API spec from project (manage required)
router.delete('/projects/:projectId/api-specs/:apiSpecId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      await ProjectApiSpec.destroy({
        where: { project_id: req.params.projectId, api_spec_id: req.params.apiSpecId }
      });
      res.json({ message: 'API spec removed from project' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// Get recorded tests linked to a project (access required)
router.get('/projects/:id/recorded-tests', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const project = await Project.findByPk(req.project.id, {
        include: [{ model: PlaywrightRecordedTest, as: 'recordedTests', through: { attributes: [] }, attributes: ['id', 'name', 'base_url', 'created_at'] }]
      });
      res.json(project.recordedTests || []);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

// Add recorded test to project (manage required)
router.post('/projects/:projectId/recorded-tests/:recordedTestId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const recordedTestId = parseInt(req.params.recordedTestId, 10);
      const recorded = await PlaywrightRecordedTest.findByPk(recordedTestId);
      if (!recorded) return res.status(404).json({ error: 'Recorded test not found' });
      await ProjectRecordedTest.findOrCreate({
        where: { project_id: req.params.projectId, recorded_test_id: recordedTestId }
      });
      res.json({ message: 'Recorded test added to project' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// Remove recorded test from project (manage required)
router.delete('/projects/:projectId/recorded-tests/:recordedTestId', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      await ProjectRecordedTest.destroy({
        where: { project_id: req.params.projectId, recorded_test_id: req.params.recordedTestId }
      });
      res.json({ message: 'Recorded test removed from project' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, true);
});

// ==================== FLOWS ====================

router.get('/projects/:id/flows', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const flows = await Flow.findAll({
        where: { project_id: req.project.id },
        order: [['name', 'ASC']]
      });
      res.json(flows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

router.post('/projects/:id/flows', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: 'Flow name is required' });
      const flow = await Flow.create({ project_id: req.project.id, name, description: description || null });
      res.status(201).json(flow);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({ error: 'A flow with this name already exists in the project' });
      }
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

router.get('/flows/:id', (req, res) => {
  Flow.findByPk(req.params.id, { attributes: ['id', 'project_id'] }).then(flow => {
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    loadProjectAndCheckAccess(req, res, () => {
      Flow.findByPk(req.params.id, { include: [{ model: FlowTask, as: 'flowTasks' }] }).then(flow2 => {
        const plain = flow2.get ? flow2.get({ plain: true }) : flow2;
        const tasks = (plain.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
        res.json({ ...plain, flowTasks: tasks });
      }).catch(err => res.status(500).json({ error: err.message }));
    }, flow.project_id, false);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.put('/flows/:id', (req, res) => {
  Flow.findByPk(req.params.id, { attributes: ['id', 'project_id'] }).then(flow => {
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    loadProjectAndCheckAccess(req, res, async () => {
      try {
        const flowInst = await Flow.findByPk(req.params.id);
        const { name, description, flowTasks } = req.body;
        if (name !== undefined) flowInst.name = name;
        if (description !== undefined) flowInst.description = description;
        await flowInst.save();
        if (Array.isArray(flowTasks)) {
          await FlowTask.destroy({ where: { flow_id: flowInst.id } });
          for (let i = 0; i < flowTasks.length; i++) {
            const t = flowTasks[i];
            await FlowTask.create({
              flow_id: flowInst.id,
              task_type: t.task_type,
              task_ref: t.task_ref,
              position: i
            });
          }
        }
        const updated = await Flow.findByPk(flowInst.id, {
          include: [{ model: FlowTask, as: 'flowTasks' }]
        });
        const plain = updated.get ? updated.get({ plain: true }) : updated;
        const tasks = (plain.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
        res.json({ ...plain, flowTasks: tasks });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }, flow.project_id, true);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.delete('/flows/:id', (req, res) => {
  Flow.findByPk(req.params.id, { attributes: ['id', 'project_id'] }).then(flow => {
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    loadProjectAndCheckAccess(req, res, async () => {
      try {
        await flow.destroy();
        res.json({ message: 'Flow deleted' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }, flow.project_id, true);
  }).catch(err => res.status(500).json({ error: err.message }));
});

router.post('/flows/:id/execute', (req, res) => {
  Flow.findByPk(req.params.id, { attributes: ['id', 'project_id', 'name'] }).then(flow => {
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    loadProjectAndCheckAccess(req, res, async () => {
      try {
        const flowId = parseInt(req.params.id, 10);
        const { runNamePrefix, baseUrl, envVars } = req.body;
        const result = await executeFlow(flowId, {
          runNamePrefix: runNamePrefix || flow.name,
          baseUrl,
          envVars,
          runByUserId: req.user?.id ?? null
        });
        res.status(201).json({
          message: 'Flow execution started',
          flow_id: flowId,
          apiRunIds: result.apiRunIds,
          uiRunIds: result.uiRunIds
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }, flow.project_id, false);
  }).catch(err => res.status(500).json({ error: err.message }));
});

// ==================== SCHEDULES ====================

router.get('/projects/:id/schedules', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const schedules = await Schedule.findAll({
        where: { project_id: req.project.id },
        order: [['created_at', 'DESC']]
      });
      const flowIds = [...new Set(schedules.map(s => s.flow_id).filter(Boolean))];
      const flows = flowIds.length ? await Flow.findAll({ where: { id: flowIds }, attributes: ['id', 'name'] }) : [];
      const flowMap = Object.fromEntries(flows.map(f => [f.id, f]));
      const result = schedules.map(s => {
        const plain = s.toJSON();
        if (s.flow_id && flowMap[s.flow_id]) plain.flow = flowMap[s.flow_id].toJSON();
        return plain;
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, false);
});

router.post('/projects/:id/schedules', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = req.project.id;
      const { flow_id, cron_expression, repeat_interval_minutes, enabled } = req.body;
      if (!cron_expression && (!repeat_interval_minutes || repeat_interval_minutes < 1)) {
        return res.status(400).json({ error: 'Either cron_expression or repeat_interval_minutes (>= 1) is required' });
      }
      if (flow_id) {
        const flow = await Flow.findByPk(flow_id);
        if (!flow || flow.project_id !== projectId) return res.status(400).json({ error: 'Flow not found or not in this project' });
      }
      const schedule = await Schedule.create({
        project_id: projectId,
        flow_id: flow_id || null,
        cron_expression: cron_expression || null,
        repeat_interval_minutes: repeat_interval_minutes || null,
        enabled: enabled !== false
      });
      const nextRun = computeNextRunAt(schedule);
      if (nextRun) await schedule.update({ next_run_at: nextRun });
      const updated = await Schedule.findByPk(schedule.id);
      const plain = updated.toJSON();
      if (updated.flow_id) {
        const flow = await Flow.findByPk(updated.flow_id, { attributes: ['id', 'name'] });
        if (flow) plain.flow = flow.toJSON();
      }
      res.status(201).json(plain);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.id, true);
});

router.get('/schedules/:id', async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, schedule.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const plain = schedule.toJSON();
    if (schedule.project_id) {
      const project = await Project.findByPk(schedule.project_id, { attributes: ['id', 'name'] });
      if (project) plain.project = project.toJSON();
    }
    if (schedule.flow_id) {
      const flow = await Flow.findByPk(schedule.flow_id, { attributes: ['id', 'name'] });
      if (flow) plain.flow = flow.toJSON();
    }
    res.json(plain);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/schedules/:id', async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, schedule.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    const { flow_id, cron_expression, repeat_interval_minutes, enabled } = req.body;
    if (flow_id !== undefined) schedule.flow_id = flow_id;
    if (cron_expression !== undefined) schedule.cron_expression = cron_expression;
    if (repeat_interval_minutes !== undefined) schedule.repeat_interval_minutes = repeat_interval_minutes;
    if (enabled !== undefined) schedule.enabled = !!enabled;
    await schedule.save();
    const next = computeNextRunAt(schedule);
    if (next) await schedule.update({ next_run_at: next });
    const updated = await Schedule.findByPk(schedule.id);
    const plain = updated.toJSON();
    if (updated.flow_id) {
      const flow = await Flow.findByPk(updated.flow_id, { attributes: ['id', 'name'] });
      if (flow) plain.flow = flow.toJSON();
    }
    res.json(plain);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/schedules/:id', async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, schedule.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    await schedule.destroy();
    res.json({ message: 'Schedule deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/schedules/:id/trigger', async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, schedule.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    await runScheduledJob(schedule);
    const updated = await Schedule.findByPk(schedule.id);
    const plain = updated.toJSON();
    if (updated.flow_id) {
      const flow = await Flow.findByPk(updated.flow_id, { attributes: ['id', 'name'] });
      if (flow) plain.flow = flow.toJSON();
    }
    res.json(plain);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List schedules (filtered by project access; optional: nextWithin hours for dashboard)
router.get('/schedules', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    if (accessibleIds !== null && accessibleIds.length === 0) return res.json([]);
    const nextWithin = req.query.nextWithin ? parseInt(req.query.nextWithin, 10) : null;
    const replacements = { enabled: true };
    let whereClause = 'WHERE enabled = :enabled';
    if (accessibleIds !== null) {
      whereClause += ` AND project_id IN (${accessibleIds.join(',')})`;
    }
    if (nextWithin && nextWithin > 0) {
      const now = new Date();
      const end = new Date(now.getTime() + nextWithin * 60 * 60 * 1000);
      whereClause += ' AND next_run_at >= :now AND next_run_at <= :end';
      replacements.now = now;
      replacements.end = end;
    }
    const schedules = await Schedule.sequelize.query(
      `SELECT * FROM schedules ${whereClause} ORDER BY next_run_at ASC LIMIT 20`,
      { replacements, type: Schedule.sequelize.QueryTypes.SELECT }
    );
    const rows = Array.isArray(schedules) ? schedules : [];
    const projectIds = [...new Set(rows.map(s => s.project_id).filter(Boolean))];
    const flowIds = [...new Set(rows.map(s => s.flow_id).filter(Boolean))];
    const [projects, flows] = await Promise.all([
      projectIds.length ? Project.findAll({ where: { id: projectIds }, attributes: ['id', 'name'] }) : [],
      flowIds.length ? Flow.findAll({ where: { id: flowIds }, attributes: ['id', 'name'] }) : []
    ]);
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
    const flowMap = Object.fromEntries(flows.map(f => [f.id, f]));
    const result = rows.map(s => {
      const plain = { ...s };
      if (s.project_id && projectMap[s.project_id]) plain.project = projectMap[s.project_id].toJSON ? projectMap[s.project_id].toJSON() : { id: projectMap[s.project_id].id, name: projectMap[s.project_id].name };
      if (s.flow_id && flowMap[s.flow_id]) plain.flow = flowMap[s.flow_id].toJSON ? flowMap[s.flow_id].toJSON() : { id: flowMap[s.flow_id].id, name: flowMap[s.flow_id].name };
      return plain;
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== API SPECS ====================

// Get all API specs (only those in projects the user can access)
router.get('/api-specs', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    let specIds = null;
    if (accessibleIds !== null) {
      const links = await ProjectApiSpec.findAll({
        where: { project_id: { [Op.in]: accessibleIds } },
        attributes: ['api_spec_id']
      });
      specIds = [...new Set(links.map(l => l.api_spec_id))];
      if (specIds.length === 0) return res.json([]);
    }
    const where = specIds === null ? {} : { id: { [Op.in]: specIds } };
    const apiSpecs = await ApiSpec.findAll({
      where,
      include: [{ model: Collection, as: 'collections' }],
      order: [['created_at', 'DESC']]
    });
    res.json(apiSpecs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get SOAP operations for a WSDL API spec (project access required)
router.get('/api-specs/:id/soap-operations', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id);
    if (!apiSpec) return res.status(404).json({ error: 'API spec not found' });
    const links = await ProjectApiSpec.findAll({ where: { api_spec_id: apiSpec.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let allowed = req.user.is_admin;
    if (!allowed) for (const pid of projectIds) {
      if (await userCanAccessProjectId(req.user.id, false, pid)) { allowed = true; break; }
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    if (apiSpec.format !== 'wsdl') return res.status(400).json({ error: 'API spec is not WSDL' });
    const operations = await SoapOperation.findAll({
      where: { api_spec_id: req.params.id },
      order: [['name', 'ASC']]
    });
    res.json(operations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single API spec (project access required)
router.get('/api-specs/:id', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id, {
      include: [
        { model: Collection, as: 'collections' },
        { model: SoapOperation, as: 'soapOperations', required: false }
      ]
    });
    if (!apiSpec) return res.status(404).json({ error: 'API spec not found' });
    const links = await ProjectApiSpec.findAll({ where: { api_spec_id: apiSpec.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let allowed = req.user.is_admin;
    if (!allowed) for (const pid of projectIds) {
      if (await userCanAccessProjectId(req.user.id, false, pid)) { allowed = true; break; }
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    res.json(apiSpec);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload API spec file (OpenAPI YAML/JSON or WSDL)
router.post('/api-specs/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.wsdl' || ext === '.xml') {
      const operations = await parseWSDLToOperations(filePath);
      const apiSpec = await ApiSpec.create({
        name: req.file.originalname.replace(/\.(wsdl|xml)$/i, ''),
        description: 'WSDL',
        format: 'wsdl',
        file_path: filePath,
        file_size: req.file.size,
        original_filename: req.file.originalname,
        spec_content: null
      });
      for (const op of operations) {
        await SoapOperation.create({
          api_spec_id: apiSpec.id,
          name: op.name,
          operation_name: op.operation_name
        });
      }
      return res.status(201).json(apiSpec);
    }

    const format = ext === '.json' ? 'json' : 'yaml';

    // Check if this is actually a Postman collection (has info.name and item array, but no openapi/swagger)
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      // If it looks like a Postman collection, redirect to collection upload
      if (parsed.info && parsed.item && Array.isArray(parsed.item) && !parsed.openapi && !parsed.swagger) {
        // This is a Postman collection, not an OpenAPI spec
        return res.status(400).json({ 
          error: 'This appears to be a Postman collection, not an OpenAPI specification. Please use "Upload Postman Collection" button instead.' 
        });
      }
    } catch (e) {
      // If we can't parse it, continue with normal validation
    }

    // Validate and parse
    const { spec, content } = validateAndParseApiSpec(filePath, format);

    // Create API spec record
    const apiSpec = await ApiSpec.create({
      name: spec.info?.title || req.file.originalname,
      description: spec.info?.description || '',
      format: format,
      file_path: filePath,
      file_size: req.file.size,
      original_filename: req.file.originalname,
      spec_content: spec
    });

    // Convert to Postman collection
    const collection = await convertToPostmanCollection(spec, format, apiSpec.name);

    // Create collection record
    await Collection.create({
      name: collection.info.name,
      version: collection.info.version || '1.0.0',
      collection_json: collection,
      api_spec_id: apiSpec.id,
      original_file_content: null,
      original_file_name: null,
      original_is_exact: false
    });

    res.status(201).json(apiSpec);
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: error.message });
  }
});

// Delete API spec (must manage at least one project containing this spec)
router.delete('/api-specs/:id', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id);
    if (!apiSpec) return res.status(404).json({ error: 'API spec not found' });
    const links = await ProjectApiSpec.findAll({ where: { api_spec_id: apiSpec.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let canManage = req.user.is_admin;
    if (!canManage) for (const pid of projectIds) {
      if (await userCanManageProjectId(req.user.id, false, pid)) { canManage = true; break; }
    }
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    if (fs.existsSync(apiSpec.file_path)) fs.unlinkSync(apiSpec.file_path);
    await apiSpec.destroy();
    res.json({ message: 'API spec deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== COLLECTIONS ====================

// Get all collections
router.get('/collections', async (req, res) => {
  try {
    const collections = await Collection.findAll({
      include: [{
        model: ApiSpec,
        as: 'apiSpec',
        attributes: ['id', 'name']
      }],
      order: [['created_at', 'DESC']]
    });
    res.json(collections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get collections for a project (access required) — only collections belonging to this project
router.get('/projects/:projectId/collections', (req, res, next) => {
  loadProjectAndCheckAccess(req, res, async () => {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      const project = await Project.findByPk(projectId, {
        include: [{
          model: ApiSpec,
          as: 'apiSpecs',
          include: [{ model: Collection, as: 'collections' }]
        }]
      });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const collections = [];
      // Collections from API specs that are in this project
      (project.apiSpecs || []).forEach(apiSpec => {
        if (apiSpec.collections) {
          collections.push(...apiSpec.collections);
        }
      });
      // Standalone collections that belong to this project only (project_id = projectId)
      const standaloneCollections = await Collection.findAll({
        where: { project_id: projectId }
      });
      collections.push(...standaloneCollections);
      res.json(collections);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }, req.params.projectId, false);
});

// Convert Postman collection to OpenAPI YAML (in-memory; no storage)
router.get('/convert/postman-to-openapi', (req, res) => {
  res.status(405).json({ error: 'Use POST with a file (multipart/form-data, field "file") to convert a Postman collection to OpenAPI YAML' });
});
const convertPostmanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (ext === '.json' || name.endsWith('.postman_collection.json')) return cb(null, true);
    cb(null, false);
    req.fileRejected = true;
    req.fileRejectReason = 'Only JSON files (Postman collection) are allowed';
  },
});
router.post('/convert/postman-to-openapi', (req, res, next) => {
  convertPostmanUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (req.fileRejected) return res.status(400).json({ error: req.fileRejectReason || 'Invalid file type' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Choose a Postman collection (JSON) file.' });
    }
    const raw = req.file.buffer.toString('utf8');
    let collection;
    try {
      collection = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON: not a valid Postman collection file' });
    }
    if (!collection || typeof collection !== 'object') {
      return res.status(400).json({ error: 'File does not look like a Postman collection (expected a JSON object)' });
    }
    const yamlStr = postmanToOpenApiYaml(collection);
    const baseName = (req.file.originalname || 'collection').replace(/\.json$/i, '').replace(/\.postman_collection$/i, '');
    const filename = `${baseName || 'converted'}.openapi.yaml`;
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(yamlStr);
  } catch (err) {
    console.error('Postman to OpenAPI conversion error:', err);
    res.status(400).json({ error: err.message || 'Conversion failed' });
  }
});

// Upload Postman collection directly (optional projectId in body for project-specific collection)
router.post('/collections/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      // Check if error is due to file size
      if (req.fileValidationError) {
        return res.status(400).json({ error: req.fileValidationError });
      }
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    console.log(`Uploading Postman collection: ${req.file.originalname}, size: ${req.file.size} bytes`);
    
    const { collection, content } = validatePostmanCollection(filePath);
    
    console.log(`Collection validated: ${collection.info?.name || 'Unknown'}, items: ${collection.item?.length || 0}`);

    const projectId = req.body.projectId ? parseInt(req.body.projectId, 10) : null;

    if (projectId && req.user) {
      const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canAccess) return res.status(403).json({ error: 'Forbidden: no access to this project' });
    }

    // Create collection record (project_id makes it specific to one project when provided)
    const collectionRecord = await Collection.create({
      name: collection.info?.name || 'Imported Collection',
      version: collection.info?.version || '1.0.0',
      collection_json: collection,
      project_id: projectId || null,
      original_file_content: content,
      original_file_name: req.file.originalname || null,
      original_is_exact: true
    });

    console.log(`Collection created with ID: ${collectionRecord.id}`);
    res.status(201).json(collectionRecord);
  } catch (error) {
    console.error('Error uploading Postman collection:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: error.message });
  }
});

// Get single collection
router.get('/collections/:id', async (req, res) => {
  try {
    const collection = await Collection.findByPk(req.params.id, {
      include: [{
        model: ApiSpec,
        as: 'apiSpec'
      }]
    });
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json(collection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete collection
router.delete('/collections/:id', async (req, res) => {
  try {
    const collection = await Collection.findByPk(req.params.id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    await collection.destroy();
    res.json({ message: 'Collection deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TEST RUNS ====================

// Normalize a TestRun or PlaywrightRun to unified shape { id, name, status, project_id, project, runType, flow_id, flow, created_at, ... }
function toUnifiedRun(row, runType) {
  const project = row.project || (row.get && row.get('project'));
  const flow = row.flow || (row.get && row.get('flow'));
  const runByUser = row.runByUser || (row.get && row.get('runByUser'));
  const runBy = runByUser
    ? { id: runByUser.id, username: runByUser.username, display_name: runByUser.display_name }
    : null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    project_id: row.project_id ?? project?.id ?? null,
    project: project ? { id: project.id, name: project.name } : null,
    runType,
    flow_id: row.flow_id ?? flow?.id ?? null,
    flow: flow ? { id: flow.id, name: flow.name } : null,
    created_at: row.created_at,
    total_tests: row.total_tests ?? null,
    passed_tests: row.passed_tests ?? null,
    failed_tests: row.failed_tests ?? null,
    duration_ms: row.duration_ms ?? null,
    base_url: row.base_url ?? null,
    progress_message: row.progress_message ?? null,
    run_by_user_id: row.run_by_user_id ?? null,
    runByUser: runBy
  };
}

// Get total count of test runs (for dashboard stat) - same filters as GET /test-runs, no pagination
router.get('/test-runs/count', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    const { projectId, type = 'all' } = req.query;
    const runType = type === 'all' || type === 'ui' || type === 'soap' || type === 'fuzz' ? type : 'api';
    const projectFilter = accessibleIds === null ? {} : { project_id: { [Op.in]: accessibleIds } };

    const baseWhere = projectId ? { ...projectFilter, project_id: parseInt(projectId, 10) } : projectFilter;

    if (runType === 'api' || runType === 'soap') {
      const where = { ...baseWhere };
      if (runType === 'api') where[Op.or] = [{ run_type: null }, { run_type: 'api' }];
      if (runType === 'soap') where.run_type = 'soap';
      const total = await TestRun.count({ where });
      return res.json({ total });
    }
    if (runType === 'ui') {
      const total = await PlaywrightRun.count({ where: baseWhere });
      return res.json({ total });
    }
    if (runType === 'fuzz') {
      const total = await FuzzRun.count({ where: baseWhere });
      return res.json({ total });
    }
    // type === 'all'
    const [apiCount, uiCount, fuzzCount] = await Promise.all([
      TestRun.count({ where: { ...baseWhere, [Op.or]: [{ run_type: null }, { run_type: 'api' }, { run_type: 'soap' }] } }),
      PlaywrightRun.count({ where: baseWhere }),
      FuzzRun.count({ where: baseWhere })
    ]);
    return res.json({ total: apiCount + uiCount + fuzzCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all test runs (optionally unified: type=api|ui|soap|fuzz|all) - filtered by project access
router.get('/test-runs', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    const { projectId, name, startDate, endDate, type = 'api' } = req.query;
    const runType = type === 'all' || type === 'ui' || type === 'soap' || type === 'fuzz' ? type : 'api';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const projectFilter = accessibleIds === null ? {} : { project_id: { [Op.in]: accessibleIds } };

    // Build shared date filter (for merging when type=all)
    const dateFilter = (colPrefix) => {
      const out = {};
      if (startDate && endDate) {
        const s = new Date(startDate);
        const e = new Date(endDate);
        out[Op.and] = [SequelizeLib.where(SequelizeLib.col(colPrefix + 'created_at'), { [Op.between]: [s, e] })];
      } else if (startDate) {
        const s = new Date(startDate);
        out[Op.and] = [SequelizeLib.where(SequelizeLib.col(colPrefix + 'created_at'), { [Op.gte]: s })];
      } else if (endDate) {
        const e = new Date(endDate);
        out[Op.and] = [SequelizeLib.where(SequelizeLib.col(colPrefix + 'created_at'), { [Op.lte]: e })];
      }
      return out;
    };

    if (runType === 'soap') {
      const where = { run_type: 'soap', ...projectFilter };
      if (projectId) where.project_id = projectId;
      if (name) {
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('TestRun.name')), { [Op.like]: `%${(name || '').toLowerCase()}%` }));
      }
      const df = dateFilter('TestRun.');
      if (df[Op.and]) { where[Op.and] = where[Op.and] || []; where[Op.and].push(...df[Op.and]); }
      const testRuns = await TestRun.findAll({
        where,
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false },
          { model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name'], required: false }
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset
      });
      return res.json(testRuns.map(r => {
        const plain = r.get ? r.get({ plain: true }) : r;
        return toUnifiedRun(plain, 'soap');
      }));
    }

    if (runType === 'fuzz') {
      const where = { ...projectFilter };
      if (projectId) where.project_id = projectId;
      if (name) {
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('FuzzRun.name')), { [Op.like]: `%${(name || '').toLowerCase()}%` }));
      }
      const df = dateFilter('FuzzRun.');
      if (df[Op.and]) { where[Op.and] = where[Op.and] || []; where[Op.and].push(...df[Op.and]); }
      const fuzzRuns = await FuzzRun.findAll({
        where,
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset
      });
      return res.json(fuzzRuns.map(r => {
        const plain = r.get ? r.get({ plain: true }) : r;
        return toUnifiedRun(plain, 'fuzz');
      }));
    }

    if (runType === 'api' || runType === 'all') {
      const where = { ...projectFilter };
      if (projectId) where.project_id = projectId;
      if (runType === 'api') {
        where[Op.or] = [{ run_type: null }, { run_type: 'api' }];
      }
      if (name) {
        const lower = name.toLowerCase();
        where[Op.and] = where[Op.and] || [];
        where[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('TestRun.name')), { [Op.like]: `%${lower}%` }));
      }
      const df = dateFilter('TestRun.');
      if (df[Op.and]) { where[Op.and] = where[Op.and] || []; where[Op.and].push(...df[Op.and]); }

      const testRuns = await TestRun.findAll({
        where,
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false },
          { model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name'], required: false }
        ],
        order: [['created_at', 'DESC']],
        limit: runType === 'all' ? 100 : limit,
        offset: runType === 'all' ? 0 : offset
      });

      if (runType === 'api') {
        return res.json(testRuns.map(r => {
          const plain = r.get ? r.get({ plain: true }) : r;
          return toUnifiedRun(plain, plain.run_type || 'api');
        }));
      }
      // runType === 'all': collect API runs (including SOAP), then fetch UI runs and merge
      const apiRows = testRuns.map(r => {
        const plain = r.get ? r.get({ plain: true }) : r;
        return toUnifiedRun(plain, plain.run_type || 'api');
      });
      const uiWhere = { ...projectFilter };
      if (projectId) uiWhere.project_id = projectId;
      if (name) {
        uiWhere[Op.and] = uiWhere[Op.and] || [];
        uiWhere[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('PlaywrightRun.name')), { [Op.like]: `%${(name || '').toLowerCase()}%` }));
      }
      const dfUi = dateFilter('PlaywrightRun.');
      if (dfUi[Op.and]) { uiWhere[Op.and] = uiWhere[Op.and] || []; uiWhere[Op.and].push(...dfUi[Op.and]); }

      const playwrightRuns = await PlaywrightRun.findAll({
        where: uiWhere,
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
        ],
        order: [['created_at', 'DESC']],
        limit: 100,
        offset: 0
      });
      const uiRows = playwrightRuns.map(r => toUnifiedRun(r.get ? r.get({ plain: true }) : r, 'ui'));
      const fuzzWhere = { ...projectFilter };
      if (projectId) fuzzWhere.project_id = projectId;
      if (name) {
        fuzzWhere[Op.and] = fuzzWhere[Op.and] || [];
        fuzzWhere[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('FuzzRun.name')), { [Op.like]: `%${(name || '').toLowerCase()}%` }));
      }
      const dfFuzz = dateFilter('FuzzRun.');
      if (dfFuzz[Op.and]) { fuzzWhere[Op.and] = fuzzWhere[Op.and] || []; fuzzWhere[Op.and].push(...dfFuzz[Op.and]); }
      const fuzzRuns = await FuzzRun.findAll({
        where: fuzzWhere,
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
        ],
        order: [['created_at', 'DESC']],
        limit: 100,
        offset: 0
      });
      const fuzzRows = fuzzRuns.map(r => toUnifiedRun(r.get ? r.get({ plain: true }) : r, 'fuzz'));
      const merged = [...apiRows, ...uiRows, ...fuzzRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
      return res.json(merged);
    }

    // runType === 'ui'
    const where = { ...projectFilter };
    if (projectId) where.project_id = projectId;
    if (name) {
      const lower = name.toLowerCase();
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('PlaywrightRun.name')), { [Op.like]: `%${lower}%` }));
    }
    const dfUi2 = dateFilter('PlaywrightRun.');
    if (dfUi2[Op.and]) { where[Op.and] = where[Op.and] || []; where[Op.and].push(...dfUi2[Op.and]); }

    const playwrightRuns = await PlaywrightRun.findAll({
      where,
      include: [
        { model: Project, as: 'project', attributes: ['id', 'name'] },
        { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    res.json(playwrightRuns.map(r => toUnifiedRun(r.get ? r.get({ plain: true }) : r, 'ui')));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single test run (project access required)
router.get('/test-runs/:id', async (req, res) => {
  try {
    const testRunMeta = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!testRunMeta) return res.status(404).json({ error: 'Test run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, testRunMeta.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    // Check if execution_order column exists before using it
    let hasExecutionOrder = false;
    try {
      await TestResult.sequelize.query(
        'SELECT execution_order FROM test_results LIMIT 1',
        { type: TestResult.sequelize.QueryTypes.SELECT }
      );
      hasExecutionOrder = true;
    } catch (colError) {
      // Column doesn't exist - will use fallback ordering
      hasExecutionOrder = false;
    }

    // Build order clause based on whether column exists
    const orderClause = hasExecutionOrder ? [
      [literal('CASE WHEN "execution_order" IS NULL THEN 1 ELSE 0 END'), 'ASC'],
      ['execution_order', 'ASC'],
      ['api_spec_id', 'ASC'],
      ['test_name', 'ASC']
    ] : [
      ['api_spec_id', 'ASC'],
      ['test_name', 'ASC']
    ];

    const testRun = await TestRun.findByPk(req.params.id, {
      include: [
        {
          model: Project,
          as: 'project'
        },
        {
          model: User,
          as: 'runByUser',
          attributes: ['id', 'username', 'display_name'],
          required: false
        },
        {
          model: TestResult,
          as: 'testResults',
          include: [{
            model: ApiSpec,
            as: 'apiSpec',
            attributes: ['id', 'name']
          }],
          order: orderClause
        }
      ]
    });

    if (!testRun) {
      return res.status(404).json({ error: 'Test run not found' });
    }
    res.json(testRun);
  } catch (error) {
    console.error('Error loading test run:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute tests
router.post('/test-runs/execute', async (req, res) => {
  try {
    // Log the entire request body for debugging
    console.log('[api] POST /test-runs/execute - Request body keys:', Object.keys(req.body));
    console.log('[api] delayBetweenTests in request:', req.body.delayBetweenTests, 'type:', typeof req.body.delayBetweenTests);
    
    const { projectId, collectionIds, selectedTests, name, environment, envVars } = req.body;

    // Support both old format (collectionIds) and new format (selectedTests)
    if (!projectId || (!collectionIds && !selectedTests)) {
      return res.status(400).json({ error: 'projectId and either collectionIds or selectedTests are required' });
    }
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, projectId);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    if (!name) {
      return res.status(400).json({ error: 'Test run name is required' });
    }

    // Pass environment options to test execution
    const testOptions = {};
    if (environment) {
      testOptions.environment = environment; // Path to environment file
    }
    if (envVars && typeof envVars === 'object') {
      const normalized = {};
      for (const [k, v] of Object.entries(envVars)) {
        normalized[k] = normalizeBaseUrl(String(v));
      }
      testOptions.envVars = normalized;
    }

    // Optional: global delay between tests (seconds)
    if (typeof req.body.delayBetweenTests !== 'undefined') {
      const d = Number(req.body.delayBetweenTests);
      if (!isNaN(d) && d >= 0) {
        testOptions.delayBetweenTests = d;
        console.log(`[api] delayBetweenTests extracted: ${d} seconds`);
      } else {
        console.log(`[api] delayBetweenTests invalid: ${req.body.delayBetweenTests} (parsed as ${d})`);
      }
    } else {
      console.log('[api] delayBetweenTests not provided in request body');
    }

    // Optional: per-test delays mapping: { collectionId: { "0.1": seconds, ... } }
    if (req.body.testDelays && typeof req.body.testDelays === 'object') {
      testOptions.testDelays = req.body.testDelays;
    }

    // Use new format if available, otherwise fall back to old format
    if (selectedTests) {
      testOptions.selectedTests = selectedTests; // Format: { collectionId: [itemIndex1, itemIndex2, ...] }
    } else if (collectionIds && Array.isArray(collectionIds) && collectionIds.length > 0) {
      // Legacy format: run all items in the collections
      testOptions.collectionIds = collectionIds;
    } else {
      return res.status(400).json({ error: 'Either collectionIds or selectedTests must be provided' });
    }

    // Extract selectedTestsOrdered if provided (for maintaining execution order)
    if (req.body.selectedTestsOrdered && Array.isArray(req.body.selectedTestsOrdered)) {
      testOptions.selectedTestsOrdered = req.body.selectedTestsOrdered;
    }

    // Log testOptions before calling executeTests
    console.log('[api] testOptions before executeTests:', JSON.stringify({
      hasDelayBetweenTests: typeof testOptions.delayBetweenTests !== 'undefined',
      delayBetweenTests: testOptions.delayBetweenTests,
      hasSelectedTests: !!testOptions.selectedTests,
      hasSelectedTestsOrdered: !!testOptions.selectedTestsOrdered,
      hasTestDelays: !!testOptions.testDelays,
      hasEnvVars: !!testOptions.envVars
    }, null, 2));
    
    // CRITICAL: Ensure delayBetweenTests is preserved in testOptions
    // This is a safety check to ensure the delay value isn't lost
    if (typeof req.body.delayBetweenTests !== 'undefined' && typeof testOptions.delayBetweenTests === 'undefined') {
      console.warn('[api] WARNING: delayBetweenTests was in request but not in testOptions! Re-adding it.');
      const d = Number(req.body.delayBetweenTests);
      if (!isNaN(d) && d >= 0) {
        testOptions.delayBetweenTests = d;
      }
    }

    // Infer proxy from run URL (env vars: endpoint, base_url, or first URL-like value)
    const derivedUrl = deriveUrlFromEnvVars(testOptions.envVars);
    const proxy = await getProxyForUrlAsync(derivedUrl);

    // Create test run immediately with 'running' status so frontend can track progress
    const testRun = await TestRun.create({
      name: name,
      status: 'running',
      project_id: projectId,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0,
      run_by_user_id: req.user?.id ?? null
    });

    // Execute tests asynchronously (don't await - let it run in background)
    executeTests(projectId, name, { ...testOptions, testRunId: testRun.id, proxy })
      .then(results => {
        console.log(`[api] Test run ${testRun.id} completed: ${results.summary.passed} passed, ${results.summary.failed} failed`);
        // Pre-generate report in background so View Report serves from file and does not block the app
        setImmediate(() => {
          generateReport(testRun.id, { skipCache: true, writeToStablePath: true })
            .catch((err) => console.error('[api] Pre-generate test report failed:', err));
        });
      })
      .catch(error => {
        console.error(`[api] Test run ${testRun.id} failed:`, error);
        // Update test run status to failed if execution fails
        TestRun.update({ status: 'failed' }, { where: { id: testRun.id } }).catch(updateError => {
          console.error('Error updating test run status:', updateError);
        });
      });

    // Return test run ID immediately so frontend can poll for progress
    res.status(201).json({
      testRun: { id: testRun.id },
      status: 'running',
      message: 'Test execution started'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute SOAP tests (WSDL operations)
router.post('/soap-runs/execute', async (req, res) => {
  try {
    const { projectId, apiSpecId, operationIds, name } = req.body;
    if (!projectId || !apiSpecId || !operationIds || !Array.isArray(operationIds) || operationIds.length === 0 || !name) {
      return res.status(400).json({ error: 'projectId, apiSpecId, operationIds (array), and name are required' });
    }
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, projectId);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const apiSpec = await ApiSpec.findByPk(apiSpecId, { attributes: ['id', 'file_path', 'format'] });
    if (!apiSpec || apiSpec.format !== 'wsdl') {
      return res.status(400).json({ error: 'API spec not found or not WSDL' });
    }
    const soapServiceUrl = getSoapServiceUrlFromWsdl(path.resolve(apiSpec.file_path));
    const proxy = await getProxyForUrlAsync(soapServiceUrl);
    const testRun = await TestRun.create({
      name,
      status: 'running',
      project_id: projectId,
      run_type: 'soap',
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0,
      run_by_user_id: req.user?.id ?? null
    });
    executeSoapTests(projectId, apiSpecId, operationIds, name, testRun.id, { proxy })
      .then(() => {
        console.log(`[api] SOAP run ${testRun.id} completed`);
        setImmediate(() => {
          generateReport(testRun.id, { skipCache: true, writeToStablePath: true })
            .catch((err) => console.error('[api] Pre-generate test report failed:', err));
        });
      })
      .catch((err) => {
        console.error(`[api] SOAP run ${testRun.id} failed:`, err);
        TestRun.update({ status: 'failed' }, { where: { id: testRun.id } }).catch(() => {});
      });
    res.status(201).json({
      testRun: { id: testRun.id },
      status: 'running',
      message: 'SOAP test execution started'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FUZZ RUNS ====================

// Execute fuzz run (CATS) - project access required
router.post('/fuzz-runs/execute', async (req, res) => {
  try {
    const { projectId, apiSpecId, name, serverUrl, flowId, paths, skipPaths } = req.body;
    if (!projectId || !apiSpecId || !name || !serverUrl) {
      return res.status(400).json({ error: 'projectId, apiSpecId, name, and serverUrl are required' });
    }
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, projectId);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const baseUrl = serverUrl.trim().replace(/\/$/, '');
    const fuzzRun = await FuzzRun.create({
      name,
      status: 'running',
      project_id: projectId,
      api_spec_id: apiSpecId,
      flow_id: flowId || null,
      server_url: baseUrl,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
    const proxy = await getProxyForUrlAsync(baseUrl);
    executeFuzz(projectId, apiSpecId, name, {
      fuzzRunId: fuzzRun.id,
      serverUrl: baseUrl,
      flowId: flowId || null,
      paths: paths || null,
      skipPaths: skipPaths || null,
      proxy
    }).catch((err) => {
      console.error(`[api] Fuzz run ${fuzzRun.id} failed:`, err);
      const msg = (err && err.message) ? String(err.message).slice(0, 2000) : 'Fuzz run failed';
      FuzzRun.update({ status: 'failed', progress_message: msg }, { where: { id: fuzzRun.id } }).catch(() => {});
    });
    res.status(201).json({
      fuzzRun: { id: fuzzRun.id },
      status: 'running',
      message: 'Fuzz execution started'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a running fuzz run
router.post('/fuzz-runs/:id/cancel', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'status'] });
    if (!run) return res.status(404).json({ error: 'Fuzz run not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    if ((run.status || '').toLowerCase() !== 'running') {
      return res.status(400).json({ error: 'Run is not running' });
    }
    const cancelled = await cancelFuzzRun(run.id);
    res.json({ message: cancelled ? 'Fuzz run cancelled' : 'Run was not running', status: 'cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List fuzz runs (filtered by project access)
router.get('/fuzz-runs', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    const projectFilter = accessibleIds === null ? {} : { project_id: { [Op.in]: accessibleIds } };
    const { projectId, limit = 50, offset = 0 } = req.query;
    const where = { ...projectFilter };
    if (projectId) where.project_id = parseInt(projectId, 10);
    const runs = await FuzzRun.findAll({
      where,
      include: [{ model: ApiSpec, as: 'apiSpec', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
      limit: Math.min(parseInt(limit, 10) || 50, 100),
      offset: Math.max(0, parseInt(offset, 10))
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single fuzz run (project access required)
router.get('/fuzz-runs/:id', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Fuzz run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const includeBodies = req.query.includeBodies === '1' || req.query.includeBodies === 'true';
    const runFull = await FuzzRun.findByPk(req.params.id, {
      include: [
        {
          model: FuzzResult,
          as: 'fuzzResults',
          order: [['execution_order', 'ASC']],
          attributes: includeBodies ? undefined : { exclude: ['request_body', 'response_body'] }
        },
        { model: ApiSpec, as: 'apiSpec', attributes: ['id', 'name'] },
        { model: Project, as: 'project', attributes: ['id', 'name'] }
      ]
    });
    res.json(runFull);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single fuzz result with request/response bodies (for copy-to-issue when viewing run detail)
router.get('/fuzz-runs/:runId/results/:resultId', async (req, res) => {
  try {
    const result = await FuzzResult.findOne({
      where: {
        id: req.params.resultId,
        fuzz_run_id: req.params.runId
      },
      attributes: ['id', 'test_name', 'fuzzer_name', 'endpoint', 'method', 'status', 'response_code', 'error_message', 'request_body', 'response_body']
    });
    if (!result) {
      return res.status(404).json({ error: 'Fuzz result not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fuzz run report (project access required)
router.get('/fuzz-runs/:id/report', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Fuzz run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const stablePath = getStableReportPath(req.params.id);
    if (fs.existsSync(stablePath)) {
      res.setHeader('Content-Type', 'text/html');
      fs.createReadStream(stablePath).pipe(res);
      return;
    }
    const { html } = await generateFuzzReport(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Fuzz run report download (project access required)
router.get('/fuzz-runs/:id/report/download', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Fuzz run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const { filePath, fileName } = await generateFuzzReport(req.params.id, { skipCache: true });
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading fuzz report:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete fuzz run (manage project required)
router.delete('/fuzz-runs/:id', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'report_path'] });
    if (!run) return res.status(404).json({ error: 'Fuzz run not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    deleteFuzzRunArtifacts(run.id, run.report_path);
    await run.destroy();
    res.json({ message: 'Fuzz run deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a running API test run (runner will stop after current work and set status to cancelled)
router.post('/test-runs/:id/cancel', async (req, res) => {
  try {
    const testRun = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'status'] });
    if (!testRun) return res.status(404).json({ error: 'Test run not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, testRun.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    const status = (testRun.status || '').toLowerCase();
    if (status !== 'running') {
      return res.status(400).json({ error: 'Only running test runs can be cancelled' });
    }
    requestCancelTestRun(testRun.id);
    await testRun.update({ status: 'cancelled' });
    res.json({ message: 'Test run cancellation requested. It will stop after the current request.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete test run (manage project required)
router.delete('/test-runs/:id', async (req, res) => {
  try {
    const testRun = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!testRun) return res.status(404).json({ error: 'Test run not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, testRun.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    deleteTestRunArtifacts(testRun.id);
    await testRun.destroy();
    res.json({ message: 'Test run deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTS ====================

// Generate report (POST) - project access required
router.post('/test-runs/:id/report', async (req, res) => {
  try {
    const run = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Test run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const { html, filePath, fileName } = await generateReport(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View report (GET) – project access required
router.get('/test-runs/:id/report', async (req, res) => {
  try {
    const run = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Test run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const stablePath = getTestRunStableReportPath(req.params.id);
    if (fs.existsSync(stablePath)) {
      res.setHeader('Content-Type', 'text/html');
      fs.createReadStream(stablePath).pipe(res);
      return;
    }
    const { html } = await generateReport(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Download report (project access required)
router.get('/test-runs/:id/report/download', async (req, res) => {
  try {
    const run = await TestRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Test run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const { filePath, fileName } = await generateReport(req.params.id, { skipCache: true });
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading report:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYWRIGHT / UI TESTS ====================

// Get Playwright config (for UI default base URL and "Show browser" default)
router.get('/playwright-config', (req, res) => {
  const hasDisplay = process.platform === 'win32' || !!process.env.DISPLAY;
  res.json({
    baseUrl: playwrightConfig.baseUrl,
    headless: playwrightConfig.headless,
    hasDisplay
  });
});

// Get list of Playwright tests (built-in + recorded) for Run UI Tests page. Optional projectId: only recorded tests linked to that project.
router.get('/playwright-tests/list', async (req, res) => {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const list = await getPlaywrightTestListWithRecorded(projectId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute Playwright UI tests (project access required)
router.post('/playwright-runs/execute', async (req, res) => {
  try {
    const { projectId, name, baseUrl, suite, selectedTestIds, headless: bodyHeadless, timeoutMs: bodyTimeoutMs, timeoutSeconds: bodyTimeoutSeconds, video: bodyVideo, trace: bodyTrace, browser: bodyBrowser, slowMo: bodySlowMo } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (projectId) {
      const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    }
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required for UI test runs' });
    }
    const url = (baseUrl && typeof baseUrl === 'string' && baseUrl.trim()) ? baseUrl.trim() : undefined;
    let runOnly = null;
    if (suite === 'selected' && Array.isArray(selectedTestIds) && selectedTestIds.length > 0) {
      runOnly = selectedTestIds;
    } else if (suite === 'full') {
      const fullList = await getPlaywrightTestListWithRecorded(projectId);
      runOnly = fullList.length > 0 ? fullList.map(t => t.id) : null;
    }
    const validBrowsers = ['chromium', 'firefox', 'webkit'];
    const browserName = validBrowsers.includes(bodyBrowser) ? bodyBrowser : 'chromium';
    const videoOpt = ['off', 'on', 'retain-on-failure'].includes(bodyVideo) ? bodyVideo : 'off';
    const traceOpt = ['off', 'on', 'retain-on-failure'].includes(bodyTrace) ? bodyTrace : 'off';
    const slowMo = typeof bodySlowMo === 'number' && bodySlowMo >= 0 ? bodySlowMo : 0;

    const run = await PlaywrightRun.create({
      name,
      status: 'running',
      base_url: url || '',
      project_id: projectId,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0,
      browser_name: browserName
    });
    const proxy = await getProxyForUrlAsync(url || playwrightConfig.baseUrl || '');
    let headless = typeof bodyHeadless === 'boolean' ? bodyHeadless : playwrightConfig.headless;
    const hasDisplay = process.platform === 'win32' || !!process.env.DISPLAY;
    if (!hasDisplay && !headless) headless = true;
    let timeoutMs = playwrightConfig.timeoutMs;
    if (typeof bodyTimeoutMs === 'number' && bodyTimeoutMs > 0) timeoutMs = bodyTimeoutMs;
    else if (typeof bodyTimeoutSeconds === 'number' && bodyTimeoutSeconds > 0) timeoutMs = bodyTimeoutSeconds * 1000;
    runPlaywrightTests({
      playwrightRunId: run.id,
      baseUrl: url,
      headless,
      timeoutMs,
      runOnly,
      video: videoOpt,
      trace: traceOpt,
      browserName,
      slowMo,
      proxy
    })
      .then(() => console.log(`[api] Playwright run ${run.id} completed`))
      .catch(async (err) => {
        console.error(`[api] Playwright run ${run.id} failed:`, err);
        const current = await PlaywrightRun.findByPk(run.id, { attributes: ['status'] });
        if (current && current.status === 'cancelled') return;
        await PlaywrightRun.update({ status: 'failed' }, { where: { id: run.id } }).catch(() => {});
      });
    res.status(201).json({ playwrightRun: { id: run.id }, status: 'running', message: 'UI test execution started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a running Playwright (UI) test run
router.post('/playwright-runs/:id/cancel', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'status'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    if ((run.status || '').toLowerCase() !== 'running') {
      return res.status(400).json({ error: 'Run is not running' });
    }
    const cancelled = await cancelPlaywrightRun(run.id);
    res.json({ message: cancelled ? 'UI test run cancelled' : 'Run was not running', status: 'cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List Playwright runs (filtered by project access)
router.get('/playwright-runs', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    const where = accessibleIds === null ? {} : { project_id: { [Op.in]: accessibleIds } };
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const runs = await PlaywrightRun.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single Playwright run (project access required)
router.get('/playwright-runs/:id', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const runFull = await PlaywrightRun.findByPk(req.params.id, {
      include: [{ model: PlaywrightResult, as: 'results', order: [['execution_order', 'ASC']] }]
    });
    res.json(runFull);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Playwright report (project access required)
router.get('/playwright-runs/:id/report', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const { html } = await generatePlaywrightReport(req.params.id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Playwright report download (project access required)
router.get('/playwright-runs/:id/report/download', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const { filePath, fileName } = await generatePlaywrightReport(req.params.id);
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading report:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const playwrightReportsDir = process.env.REPORTS_DIR || path.join(__dirname, '..', 'reports');
const playwrightVideosDir = path.join(playwrightReportsDir, 'playwright-videos');
const playwrightTracesDir = path.join(playwrightReportsDir, 'playwright-traces');

// Playwright run video (project access required)
router.get('/playwright-runs/:id/video', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'video_path'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const videoPath = run.get ? run.get('video_path') : run.video_path;
    if (!videoPath) return res.status(404).json({ error: 'No video for this run' });
    const filePath = path.join(playwrightVideosDir, videoPath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Video file not found' });
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.toLowerCase().includes('not found'))) {
      return res.status(404).json({ error: error.message || 'Not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Playwright run trace (project access required)
router.get('/playwright-runs/:id/trace', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, { attributes: ['id', 'project_id', 'trace_path'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const tracePath = run.trace_path;
    if (!tracePath) return res.status(404).json({ error: 'No trace for this run' });
    const filePath = path.join(playwrightTracesDir, tracePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Trace file not found' });
    const fileName = `trace-run-${req.params.id}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // Allow trace.playwright.dev to load this URL when using View Trace with ?trace=...
    res.setHeader('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.toLowerCase().includes('not found'))) {
      return res.status(404).json({ error: error.message || 'Not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Playwright result-level video (project access required)
router.get('/playwright-runs/:runId/results/:resultId/video', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.runId, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const result = await PlaywrightResult.findOne({
      where: { id: req.params.resultId, playwright_run_id: req.params.runId }
    });
    if (!result) return res.status(404).json({ error: 'Result not found' });
    const videoPath = result.video_path;
    if (!videoPath) return res.status(404).json({ error: 'No video for this result' });
    const filePath = path.join(playwrightVideosDir, videoPath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Video file not found' });
    res.setHeader('Content-Type', 'video/webm');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.toLowerCase().includes('not found'))) {
      return res.status(404).json({ error: error.message || 'Not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Playwright result-level trace (project access required)
router.get('/playwright-runs/:runId/results/:resultId/trace', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.runId, { attributes: ['id', 'project_id'] });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canAccess = run.project_id ? await userCanAccessProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const result = await PlaywrightResult.findOne({
      where: { id: req.params.resultId, playwright_run_id: req.params.runId }
    });
    if (!result) return res.status(404).json({ error: 'Result not found' });
    const tracePath = result.trace_path;
    if (!tracePath) return res.status(404).json({ error: 'No trace for this result' });
    const filePath = path.join(playwrightTracesDir, tracePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Trace file not found' });
    const fileName = `trace-run-${req.params.runId}-result-${req.params.resultId}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT' || (error.message && error.message.toLowerCase().includes('not found'))) {
      return res.status(404).json({ error: error.message || 'Not found' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Delete Playwright run
router.delete('/playwright-runs/:id', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, {
      attributes: ['id', 'project_id', 'video_path', 'trace_path'],
      include: [{ model: PlaywrightResult, as: 'results', attributes: ['video_path', 'trace_path'] }]
    });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    const canManage = run.project_id ? await userCanManageProjectId(req.user.id, req.user.is_admin, run.project_id) : req.user.is_admin;
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    const results = (run.results || []).map((r) => ({ video_path: r.video_path, trace_path: r.trace_path }));
    deletePlaywrightRunArtifacts(run, results);
    await run.destroy();
    res.json({ message: 'Playwright run deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYWRIGHT RECORDED TESTS (Codegen paste-and-save) ====================

// List recorded tests (only those in projects the user can access)
router.get('/playwright-recorded-tests', async (req, res) => {
  try {
    const accessibleIds = await getAccessibleProjectIds(req.user.id, req.user.is_admin);
    let testIds = null;
    if (accessibleIds !== null) {
      const links = await ProjectRecordedTest.findAll({
        where: { project_id: { [Op.in]: accessibleIds } },
        attributes: ['recorded_test_id']
      });
      testIds = [...new Set(links.map(l => l.recorded_test_id))];
      if (testIds.length === 0) return res.json([]);
    }
    const where = testIds === null ? {} : { id: { [Op.in]: testIds } };
    const tests = await PlaywrightRecordedTest.findAll({
      where,
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'base_url', 'created_at']
    });
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create recorded test (addToProjectIds: user must manage those projects)
router.post('/playwright-recorded-tests', async (req, res) => {
  try {
    const { name, spec_content, base_url, addToProjectIds } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const validation = validateSpecContent(spec_content);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const projectIds = Array.isArray(addToProjectIds) ? addToProjectIds.filter(id => Number.isInteger(Number(id))) : [];
    for (const projectId of projectIds) {
      const canManage = await userCanManageProjectId(req.user.id, req.user.is_admin, projectId);
      if (!canManage) return res.status(403).json({ error: 'Forbidden: cannot add to one or more projects' });
    }
    const normalizedSpec = normalizeRecordedSpecTitle(
      typeof spec_content === 'string' ? spec_content.trim() : '',
      name
    );
    const test = await PlaywrightRecordedTest.create({
      name: name.trim(),
      spec_content: normalizedSpec,
      base_url: base_url && typeof base_url === 'string' ? base_url.trim() || null : null
    });
    for (const projectId of projectIds) {
      await ProjectRecordedTest.findOrCreate({
        where: { project_id: projectId, recorded_test_id: test.id }
      }).catch(() => {});
    }
    res.status(201).json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Launch Playwright Codegen
// On headless Linux with Xvfb/noVNC: starts a remote session viewable in the browser.
// On Windows/desktop (with DISPLAY): spawns codegen locally as before.
router.post('/playwright-recorded-tests/launch-codegen', async (req, res) => {
  try {
    const { baseUrl, projectId } = req.body;
    const url = (baseUrl && typeof baseUrl === 'string' ? baseUrl.trim() : playwrightConfig.baseUrl) || 'https://example.com';
    const slug = `recorded-${Date.now()}`;

    const proxy = await getProxyForUrlAsync(url);

    // --- Remote Codegen path (headless Linux with Xvfb + noVNC) ---
    if (codegenSessionManager.isRemoteCodegenAvailable()) {
      const session = await codegenSessionManager.createSession(slug, url, { proxy });
      return res.status(202).json({
        mode: 'remote',
        message: 'Remote Codegen session started. Use the embedded browser panel to record your interactions, then click "Stop Recording" to save.',
        slug: session.slug,
        vncPort: session.vncPort,
        noVncUrl: session.noVncUrl,
        timeoutMs: codegenSessionManager.SESSION_TIMEOUT_MS,
      });
    }

    // --- Local Codegen path (Windows / desktop with DISPLAY) ---
    const hasDisplay = process.platform === 'win32' || process.env.DISPLAY;
    if (!hasDisplay) {
      return res.status(503).json({
        error: 'Cannot launch Codegen: no display available and remote Codegen (Xvfb/noVNC) is not installed. Use paste-and-save: run "npx playwright codegen <url>" locally, then paste the generated code here.'
      });
    }
    const { spawn } = require('child_process');
    const outputPath = path.join(__dirname, '..', 'e2e', 'recorded', `${slug}.spec.js`);
    const e2eRecorded = path.join(__dirname, '..', 'e2e', 'recorded');
    if (!fs.existsSync(e2eRecorded)) {
      fs.mkdirSync(e2eRecorded, { recursive: true });
    }
    const isWin = process.platform === 'win32';
    const command = isWin ? 'npx.cmd' : 'npx';
    const args = ['playwright', 'codegen', '--output', outputPath];
    if (proxy && (proxy.http || proxy.https)) {
      const u = proxy.http || proxy.https || '';
      args.push('--proxy-server', u);
      if (proxy.bypass && proxy.bypass.trim()) {
        args.push('--proxy-bypass', proxy.bypass.trim());
      }
    }
    args.push(url);
    const localEnv = { ...process.env };
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      shell: isWin,
      cwd: path.join(__dirname, '..'),
      env: localEnv
    });
    child.unref();
    const relativePath = path.relative(path.join(__dirname, '..'), outputPath);
    res.status(202).json({
      mode: 'local',
      message: 'Browser and Inspector opened. Record your interactions, then click "Load generated code" to load the test code.',
      outputPath: relativePath,
      slug: slug
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop a remote Codegen session and return the generated spec
router.post('/playwright-recorded-tests/stop-codegen/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string' || slug.includes('..') || slug.includes('/')) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const result = await codegenSessionManager.stopSession(slug);
    res.json({
      slug: result.slug,
      status: result.status,
      specContent: result.specContent || null,
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Get remote Codegen session status
router.get('/playwright-recorded-tests/codegen-session/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const session = codegenSessionManager.getSession(slug);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read generated codegen file
router.get('/playwright-recorded-tests/codegen-output/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string' || slug.includes('..') || slug.includes('/')) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    const outputPath = path.join(__dirname, '..', 'e2e', 'recorded', `${slug}.spec.js`);
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({ error: 'Generated file not found. Codegen may still be running or the file was not created.' });
    }
    const content = fs.readFileSync(outputPath, 'utf8');
    res.json({ content, outputPath: path.relative(path.join(__dirname, '..'), outputPath) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single recorded test (must have access to a project containing it)
router.get('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
    const links = await ProjectRecordedTest.findAll({ where: { recorded_test_id: test.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let allowed = req.user.is_admin;
    if (!allowed) for (const pid of projectIds) {
      if (await userCanAccessProjectId(req.user.id, false, pid)) { allowed = true; break; }
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update recorded test (access to a project containing it required)
router.put('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
    const links = await ProjectRecordedTest.findAll({ where: { recorded_test_id: test.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let allowed = req.user.is_admin;
    if (!allowed) for (const pid of projectIds) {
      if (await userCanAccessProjectId(req.user.id, false, pid)) { allowed = true; break; }
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const { name, spec_content, base_url } = req.body;
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      test.name = name.trim();
    }
    if (spec_content !== undefined) {
      const validation = validateSpecContent(spec_content);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      const normalizedSpec = normalizeRecordedSpecTitle(
        typeof spec_content === 'string' ? spec_content.trim() : test.spec_content,
        test.name
      );
      test.spec_content = normalizedSpec;
    }
    if (base_url !== undefined) {
      test.base_url = base_url && typeof base_url === 'string' ? base_url.trim() || null : null;
    }
    await test.save();
    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete recorded test (must manage at least one project containing it)
router.delete('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
    const links = await ProjectRecordedTest.findAll({ where: { recorded_test_id: test.id }, attributes: ['project_id'] });
    const projectIds = links.map(l => l.project_id);
    if (projectIds.length === 0) return res.status(403).json({ error: 'Forbidden' });
    let canManage = req.user.is_admin;
    if (!canManage) for (const pid of projectIds) {
      if (await userCanManageProjectId(req.user.id, false, pid)) { canManage = true; break; }
    }
    if (!canManage) return res.status(403).json({ error: 'Forbidden' });
    await test.destroy();
    res.json({ message: 'Recorded test deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


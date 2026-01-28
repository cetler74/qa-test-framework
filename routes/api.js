const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { Project, ApiSpec, Collection, TestRun, TestResult, ProjectApiSpec, PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest } = require('../models');
const SequelizeLib = require('sequelize');
const { Op, literal } = require('sequelize');
const { convertToPostmanCollection, parsePostmanCollection } = require('../services/apiSpecConverter');
const { upload, validateAndParseApiSpec, validatePostmanCollection } = require('../services/fileUpload');
const { executeTests } = require('../services/testRunner');
const { generateReport } = require('../services/reportGenerator');
const { runPlaywrightTests, getPlaywrightTestListWithRecorded } = require('../services/playwrightRunner');
const { generatePlaywrightReport } = require('../services/playwrightReportGenerator');
const playwrightConfig = require('../config/playwright');
const { validateSpecContent } = require('../services/recordedTestValidation');

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

// ==================== PROJECTS ====================

// Get all projects
router.get('/projects', async (req, res) => {
  try {
    const projects = await Project.findAll({
      include: [{
        model: ApiSpec,
        as: 'apiSpecs',
        through: { attributes: [] }
      }],
      order: [['created_at', 'DESC']]
    });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project
router.get('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id, {
      include: [{
        model: ApiSpec,
        as: 'apiSpecs',
        through: { attributes: [] },
        include: [{
          model: Collection,
          as: 'collections'
        }]
      }]
    });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create project
router.post('/projects', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const project = await Project.create({ name, description });
    res.status(201).json(project);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Project name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update project
router.put('/projects/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await project.update({ name, description });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project
router.delete('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await project.destroy();
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add API spec to project
router.post('/projects/:projectId/api-specs/:apiSpecId', async (req, res) => {
  try {
    const { projectId, apiSpecId } = req.params;
    const project = await Project.findByPk(projectId);
    const apiSpec = await ApiSpec.findByPk(apiSpecId);
    
    if (!project || !apiSpec) {
      return res.status(404).json({ error: 'Project or API spec not found' });
    }

    await ProjectApiSpec.findOrCreate({
      where: { project_id: projectId, api_spec_id: apiSpecId }
    });

    res.json({ message: 'API spec added to project' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove API spec from project
router.delete('/projects/:projectId/api-specs/:apiSpecId', async (req, res) => {
  try {
    const { projectId, apiSpecId } = req.params;
    await ProjectApiSpec.destroy({
      where: { project_id: projectId, api_spec_id: apiSpecId }
    });
    res.json({ message: 'API spec removed from project' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== API SPECS ====================

// Get all API specs
router.get('/api-specs', async (req, res) => {
  try {
    const apiSpecs = await ApiSpec.findAll({
      include: [{
        model: Collection,
        as: 'collections'
      }],
      order: [['created_at', 'DESC']]
    });
    res.json(apiSpecs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single API spec
router.get('/api-specs/:id', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id, {
      include: [{
        model: Collection,
        as: 'collections'
      }]
    });
    if (!apiSpec) {
      return res.status(404).json({ error: 'API spec not found' });
    }
    res.json(apiSpec);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload API spec file
router.post('/api-specs/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
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
      api_spec_id: apiSpec.id
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

// Delete API spec
router.delete('/api-specs/:id', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id);
    if (!apiSpec) {
      return res.status(404).json({ error: 'API spec not found' });
    }

    // Delete file
    if (fs.existsSync(apiSpec.file_path)) {
      fs.unlinkSync(apiSpec.file_path);
    }

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

// Get collections for a project
router.get('/projects/:projectId/collections', async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.projectId, {
      include: [{
        model: ApiSpec,
        as: 'apiSpecs',
        include: [{
          model: Collection,
          as: 'collections'
        }]
      }]
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const collections = [];
    // Get collections from API specs in the project
    project.apiSpecs.forEach(apiSpec => {
      if (apiSpec.collections) {
        collections.push(...apiSpec.collections);
      }
    });

    // Also get standalone collections (collections without api_spec_id)
    // These are Postman collections uploaded directly
    const standaloneCollections = await Collection.findAll({
      where: {
        api_spec_id: null
      }
    });
    collections.push(...standaloneCollections);

    res.json(collections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload Postman collection directly
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

    // Create collection record
    const collectionRecord = await Collection.create({
      name: collection.info?.name || 'Imported Collection',
      version: collection.info?.version || '1.0.0',
      collection_json: collection
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

// Get all test runs
router.get('/test-runs', async (req, res) => {
  try {
    const { projectId, name, startDate, endDate } = req.query;
    const where = {};

    if (projectId) {
      where.project_id = projectId;
    }

    if (name) {
      // Case-insensitive substring match on TestRun.name (qualify to avoid ambiguity with joined tables)
      const lower = name.toLowerCase();
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(SequelizeLib.where(SequelizeLib.fn('LOWER', SequelizeLib.col('TestRun.name')), { [Op.like]: `%${lower}%` }));
    }

    // Date filters (qualified to TestRun.created_at to avoid ambiguity)
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(SequelizeLib.where(SequelizeLib.col('TestRun.created_at'), { [Op.between]: [s, e] }));
    } else if (startDate) {
      const s = new Date(startDate);
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(SequelizeLib.where(SequelizeLib.col('TestRun.created_at'), { [Op.gte]: s }));
    } else if (endDate) {
      const e = new Date(endDate);
      where[Op.and] = where[Op.and] || [];
      where[Op.and].push(SequelizeLib.where(SequelizeLib.col('TestRun.created_at'), { [Op.lte]: e }));
    }

    console.info('[GET /test-runs] query=', req.query, 'where=', where);

    const testRuns = await TestRun.findAll({
      where,
      include: [{
        model: Project,
        as: 'project',
        attributes: ['id', 'name']
      }],
      order: [['created_at', 'DESC']],
      limit: req.query.limit ? parseInt(req.query.limit) : 50,
      offset: req.query.offset ? parseInt(req.query.offset) : 0
    });
    res.json(testRuns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single test run
router.get('/test-runs/:id', async (req, res) => {
  try {
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

    if (!name) {
      return res.status(400).json({ error: 'Test run name is required' });
    }

    // Pass environment options to test execution
    const testOptions = {};
    if (environment) {
      testOptions.environment = environment; // Path to environment file
    }
    if (envVars) {
      testOptions.envVars = envVars; // Object with key-value pairs
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

    // Create test run immediately with 'running' status so frontend can track progress
    const testRun = await TestRun.create({
      name: name,
      status: 'running',
      project_id: projectId,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });

    // Execute tests asynchronously (don't await - let it run in background)
    executeTests(projectId, name, { ...testOptions, testRunId: testRun.id })
      .then(results => {
        console.log(`[api] Test run ${testRun.id} completed: ${results.summary.passed} passed, ${results.summary.failed} failed`);
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

// Delete test run
router.delete('/test-runs/:id', async (req, res) => {
  try {
    const testRun = await TestRun.findByPk(req.params.id);
    if (!testRun) {
      return res.status(404).json({ error: 'Test run not found' });
    }
    await testRun.destroy();
    res.json({ message: 'Test run deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTS ====================

// Generate report (POST) - maintains existing behavior
router.post('/test-runs/:id/report', async (req, res) => {
  try {
    const { html, filePath, fileName } = await generateReport(req.params.id);
    
    // Return HTML content
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View report (GET) - supported for the frontend 'View Report' action
router.get('/test-runs/:id/report', async (req, res) => {
  try {
    const { html, filePath, fileName } = await generateReport(req.params.id);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    // If not found, return 404 to the client for clarity
    if (error.message && error.message.toLowerCase().includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Download report
router.get('/test-runs/:id/report/download', async (req, res) => {
  try {
    const { filePath, fileName } = await generateReport(req.params.id);
    
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error downloading report:', err);
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYWRIGHT / UI TESTS ====================

// Get Playwright config (for UI default base URL)
router.get('/playwright-config', (req, res) => {
  res.json({ baseUrl: playwrightConfig.baseUrl });
});

// Get list of Playwright tests (built-in + recorded) for Run UI Tests page
router.get('/playwright-tests/list', async (req, res) => {
  try {
    const list = await getPlaywrightTestListWithRecorded();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute Playwright UI tests
router.post('/playwright-runs/execute', async (req, res) => {
  try {
    const { name, baseUrl, suite, selectedTestIds } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const url = baseUrl || playwrightConfig.baseUrl;
    let runOnly = null;
    if (suite === 'selected' && Array.isArray(selectedTestIds) && selectedTestIds.length > 0) {
      runOnly = selectedTestIds;
    } else if (suite === 'full') {
      const fullList = await getPlaywrightTestListWithRecorded();
      runOnly = fullList.length > 0 ? fullList.map(t => t.id) : null;
    }
    const run = await PlaywrightRun.create({
      name,
      status: 'running',
      base_url: url,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
    runPlaywrightTests({
      playwrightRunId: run.id,
      baseUrl: url,
      headless: playwrightConfig.headless,
      timeoutMs: playwrightConfig.timeoutMs,
      runOnly
    })
      .then(() => console.log(`[api] Playwright run ${run.id} completed`))
      .catch((err) => {
        console.error(`[api] Playwright run ${run.id} failed:`, err);
        PlaywrightRun.update({ status: 'failed' }, { where: { id: run.id } }).catch(() => {});
      });
    res.status(201).json({ playwrightRun: { id: run.id }, status: 'running', message: 'UI test execution started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List Playwright runs
router.get('/playwright-runs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const runs = await PlaywrightRun.findAll({
      order: [['created_at', 'DESC']],
      limit: Math.min(limit, 100),
      offset
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single Playwright run with results
router.get('/playwright-runs/:id', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id, {
      include: [{ model: PlaywrightResult, as: 'results', order: [['execution_order', 'ASC']] }]
    });
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Playwright report (HTML)
router.get('/playwright-runs/:id/report', async (req, res) => {
  try {
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

// Playwright report download
router.get('/playwright-runs/:id/report/download', async (req, res) => {
  try {
    const { filePath, fileName } = await generatePlaywrightReport(req.params.id);
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading report:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Playwright run
router.delete('/playwright-runs/:id', async (req, res) => {
  try {
    const run = await PlaywrightRun.findByPk(req.params.id);
    if (!run) return res.status(404).json({ error: 'Playwright run not found' });
    await run.destroy();
    res.json({ message: 'Playwright run deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PLAYWRIGHT RECORDED TESTS (Codegen paste-and-save) ====================

// List recorded tests
router.get('/playwright-recorded-tests', async (req, res) => {
  try {
    const tests = await PlaywrightRecordedTest.findAll({
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'base_url', 'created_at']
    });
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create recorded test
router.post('/playwright-recorded-tests', async (req, res) => {
  try {
    const { name, spec_content, base_url } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const validation = validateSpecContent(spec_content);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
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
    res.status(201).json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optional: launch Playwright codegen (requires display)
router.post('/playwright-recorded-tests/launch-codegen', async (req, res) => {
  try {
    const { baseUrl } = req.body;
    const url = (baseUrl && typeof baseUrl === 'string' ? baseUrl.trim() : playwrightConfig.baseUrl) || 'https://example.com';
    const { spawn } = require('child_process');
    const slug = `recorded-${Date.now()}`;
    const outputPath = path.join(__dirname, '..', 'e2e', 'recorded', `${slug}.spec.js`);
    const e2eRecorded = path.join(__dirname, '..', 'e2e', 'recorded');
    if (!fs.existsSync(e2eRecorded)) {
      fs.mkdirSync(e2eRecorded, { recursive: true });
    }
    const hasDisplay = process.platform === 'win32' || process.env.DISPLAY;
    if (!hasDisplay) {
      return res.status(503).json({
        error: 'Cannot launch Codegen: no display available. Use paste-and-save: run "npx playwright codegen <url>" locally, then paste the generated code here.'
      });
    }
    const isWin = process.platform === 'win32';
    const command = isWin ? 'npx.cmd' : 'npx';
    const args = ['playwright', 'codegen', '--output', outputPath, url];
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      shell: isWin,
      cwd: path.join(__dirname, '..')
    });
    child.unref();
    // Return relative path for security (client can request it via API)
    const relativePath = path.relative(path.join(__dirname, '..'), outputPath);
    res.status(202).json({
      message: 'Browser and Inspector opened. Record your interactions, then click "Load generated code" to load the test code.',
      outputPath: relativePath,
      slug: slug
    });
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

// Get single recorded test
router.get('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update recorded test
router.put('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
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

// Delete recorded test
router.delete('/playwright-recorded-tests/:id', async (req, res) => {
  try {
    const test = await PlaywrightRecordedTest.findByPk(req.params.id);
    if (!test) return res.status(404).json({ error: 'Recorded test not found' });
    await test.destroy();
    res.json({ message: 'Recorded test deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


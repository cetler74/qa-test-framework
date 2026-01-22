const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { Project, ApiSpec, Collection, TestRun, TestResult, ProjectApiSpec } = require('../models');
const SequelizeLib = require('sequelize');
const { Op, literal } = require('sequelize');
const { convertToPostmanCollection, parsePostmanCollection } = require('../services/apiSpecConverter');
const { upload, validateAndParseApiSpec, validatePostmanCollection } = require('../services/fileUpload');
const { executeTests } = require('../services/testRunner');
const { generateReport } = require('../services/reportGenerator');

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

module.exports = router;


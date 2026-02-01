const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { Project, ApiSpec, Collection, TestRun, TestResult, ProjectApiSpec, PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest, ProjectRecordedTest, Flow, FlowTask, Schedule, SoapOperation, FuzzRun, FuzzResult } = require('../models');
const SequelizeLib = require('sequelize');
const { Op, literal } = require('sequelize');
const { convertToPostmanCollection, parsePostmanCollection } = require('../services/apiSpecConverter');
const { upload, validateAndParseApiSpec, validatePostmanCollection, parseWSDLToOperations } = require('../services/fileUpload');
const { executeTests } = require('../services/testRunner');
const { generateReport, getStableReportPath: getTestRunStableReportPath } = require('../services/reportGenerator');
const { runPlaywrightTests, getPlaywrightTestListWithRecorded } = require('../services/playwrightRunner');
const { executeFlow } = require('../services/flowRunner');
const { computeNextRunAt, runScheduledJob } = require('../services/scheduler');
const { executeSoapTests } = require('../services/soapRunner');
const { executeFuzz } = require('../services/fuzzRunner');
const { generateFuzzReport, getStableReportPath } = require('../services/fuzzReportGenerator');
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

// Get recorded tests linked to a project (Option B: from junction table)
router.get('/projects/:id/recorded-tests', async (req, res) => {
  try {
    const project = await Project.findByPk(req.params.id, {
      include: [{ model: PlaywrightRecordedTest, as: 'recordedTests', through: { attributes: [] }, attributes: ['id', 'name', 'base_url', 'created_at'] }]
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project.recordedTests || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add recorded test to project (link in project_recorded_tests)
router.post('/projects/:projectId/recorded-tests/:recordedTestId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    const recordedTestId = parseInt(req.params.recordedTestId, 10);
    const project = await Project.findByPk(projectId);
    const recorded = await PlaywrightRecordedTest.findByPk(recordedTestId);
    if (!project || !recorded) return res.status(404).json({ error: 'Project or recorded test not found' });
    await ProjectRecordedTest.findOrCreate({
      where: { project_id: projectId, recorded_test_id: recordedTestId }
    });
    res.json({ message: 'Recorded test added to project' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove recorded test from project (unlink only; does not delete the global recorded test)
router.delete('/projects/:projectId/recorded-tests/:recordedTestId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    const recordedTestId = parseInt(req.params.recordedTestId, 10);
    await ProjectRecordedTest.destroy({
      where: { project_id: projectId, recorded_test_id: recordedTestId }
    });
    res.json({ message: 'Recorded test removed from project' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FLOWS ====================

router.get('/projects/:id/flows', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const flows = await Flow.findAll({
      where: { project_id: projectId },
      order: [['name', 'ASC']]
    });
    res.json(flows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:id/flows', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Flow name is required' });
    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const flow = await Flow.create({ project_id: projectId, name, description: description || null });
    res.status(201).json(flow);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'A flow with this name already exists in the project' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/flows/:id', async (req, res) => {
  try {
    const flow = await Flow.findByPk(req.params.id, {
      include: [{ model: FlowTask, as: 'flowTasks', order: [['position', 'ASC']] }]
    });
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    const plain = flow.get ? flow.get({ plain: true }) : flow;
    const tasks = (plain.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    res.json({ ...plain, flowTasks: tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/flows/:id', async (req, res) => {
  try {
    const flow = await Flow.findByPk(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    const { name, description, flowTasks } = req.body;
    if (name !== undefined) flow.name = name;
    if (description !== undefined) flow.description = description;
    await flow.save();
    if (Array.isArray(flowTasks)) {
      await FlowTask.destroy({ where: { flow_id: flow.id } });
      for (let i = 0; i < flowTasks.length; i++) {
        const t = flowTasks[i];
        await FlowTask.create({
          flow_id: flow.id,
          task_type: t.task_type,
          task_ref: t.task_ref,
          position: i
        });
      }
    }
    const updated = await Flow.findByPk(flow.id, {
      include: [{ model: FlowTask, as: 'flowTasks' }]
    });
    const plain = updated.get ? updated.get({ plain: true }) : updated;
    const tasks = (plain.flowTasks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    res.json({ ...plain, flowTasks: tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/flows/:id', async (req, res) => {
  try {
    const flow = await Flow.findByPk(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    await flow.destroy();
    res.json({ message: 'Flow deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/flows/:id/execute', async (req, res) => {
  try {
    const flowId = parseInt(req.params.id, 10);
    const { runNamePrefix, baseUrl, envVars } = req.body;
    const flow = await Flow.findByPk(flowId);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    const result = await executeFlow(flowId, {
      runNamePrefix: runNamePrefix || flow.name,
      baseUrl,
      envVars
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
});

// ==================== SCHEDULES ====================

router.get('/projects/:id/schedules', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const schedules = await Schedule.findAll({
      where: { project_id: projectId },
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
});

router.post('/projects/:id/schedules', async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { flow_id, cron_expression, repeat_interval_minutes, enabled } = req.body;
    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
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
    const next = computeNextRunAt(schedule);
    if (next) await schedule.update({ next_run_at: next });
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
});

router.get('/schedules/:id', async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
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

// List schedules (optional: nextWithin hours for dashboard)
// Uses raw query to avoid Sequelize "Project/Flow is not associated to Schedule" when associations are not loaded
router.get('/schedules', async (req, res) => {
  try {
    const nextWithin = req.query.nextWithin ? parseInt(req.query.nextWithin, 10) : null;
    const replacements = { enabled: true };
    let whereClause = 'WHERE enabled = :enabled';
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

// Get SOAP operations for a WSDL API spec
router.get('/api-specs/:id/soap-operations', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id);
    if (!apiSpec) return res.status(404).json({ error: 'API spec not found' });
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

// Get single API spec
router.get('/api-specs/:id', async (req, res) => {
  try {
    const apiSpec = await ApiSpec.findByPk(req.params.id, {
      include: [{
        model: Collection,
        as: 'collections'
      }, {
        model: SoapOperation,
        as: 'soapOperations',
        required: false
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

// Normalize a TestRun or PlaywrightRun to unified shape { id, name, status, project_id, project, runType, flow_id, flow, created_at, ... }
function toUnifiedRun(row, runType) {
  const project = row.project || (row.get && row.get('project'));
  const flow = row.flow || (row.get && row.get('flow'));
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
    progress_message: row.progress_message ?? null
  };
}

// Get all test runs (optionally unified: type=api|ui|soap|fuzz|all)
router.get('/test-runs', async (req, res) => {
  try {
    const { projectId, name, startDate, endDate, type = 'api' } = req.query;
    const runType = type === 'all' || type === 'ui' || type === 'soap' || type === 'fuzz' ? type : 'api';
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

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
      const where = { run_type: 'soap' };
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
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
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
      const where = {};
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
      const where = {};
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
          { model: Flow, as: 'flow', attributes: ['id', 'name'], required: false }
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
      const uiWhere = {};
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
      const fuzzWhere = {};
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
    const where = {};
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
    const testRun = await TestRun.create({
      name,
      status: 'running',
      project_id: projectId,
      run_type: 'soap',
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
    executeSoapTests(projectId, apiSpecId, operationIds, name, testRun.id)
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

// Execute fuzz run (CATS)
router.post('/fuzz-runs/execute', async (req, res) => {
  try {
    const { projectId, apiSpecId, name, serverUrl, flowId, paths, skipPaths } = req.body;
    if (!projectId || !apiSpecId || !name || !serverUrl) {
      return res.status(400).json({ error: 'projectId, apiSpecId, name, and serverUrl are required' });
    }
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
    executeFuzz(projectId, apiSpecId, name, {
      fuzzRunId: fuzzRun.id,
      serverUrl: baseUrl,
      flowId: flowId || null,
      paths: paths || null,
      skipPaths: skipPaths || null
    }).catch((err) => {
      console.error(`[api] Fuzz run ${fuzzRun.id} failed:`, err);
      FuzzRun.update({ status: 'failed' }, { where: { id: fuzzRun.id } }).catch(() => {});
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

// List fuzz runs (optional projectId filter)
router.get('/fuzz-runs', async (req, res) => {
  try {
    const { projectId, limit = 50, offset = 0 } = req.query;
    const where = {};
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

// Get single fuzz run with results
router.get('/fuzz-runs/:id', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id, {
      include: [
        { model: FuzzResult, as: 'fuzzResults', order: [['execution_order', 'ASC']] },
        { model: ApiSpec, as: 'apiSpec', attributes: ['id', 'name'] },
        { model: Project, as: 'project', attributes: ['id', 'name'] }
      ]
    });
    if (!run) {
      return res.status(404).json({ error: 'Fuzz run not found' });
    }
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fuzz run report (HTML) – serve pre-generated file when present so View Report does not block the app
router.get('/fuzz-runs/:id/report', async (req, res) => {
  try {
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

// Fuzz run report download (always regenerate so file exists on disk)
router.get('/fuzz-runs/:id/report/download', async (req, res) => {
  try {
    const { filePath, fileName } = await generateFuzzReport(req.params.id, { skipCache: true });
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Error downloading fuzz report:', err);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete fuzz run
router.delete('/fuzz-runs/:id', async (req, res) => {
  try {
    const run = await FuzzRun.findByPk(req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'Fuzz run not found' });
    }
    await run.destroy();
    res.json({ message: 'Fuzz run deleted successfully' });
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

// View report (GET) – serve pre-generated file when present so View Report does not block the app
router.get('/test-runs/:id/report', async (req, res) => {
  try {
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

// Download report (always regenerate for freshness)
router.get('/test-runs/:id/report/download', async (req, res) => {
  try {
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
  res.json({
    baseUrl: playwrightConfig.baseUrl,
    headless: playwrightConfig.headless
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

// Execute Playwright UI tests (projectId required so run is project-scoped)
router.post('/playwright-runs/execute', async (req, res) => {
  try {
    const { projectId, name, baseUrl, suite, selectedTestIds, headless: bodyHeadless } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required for UI test runs' });
    }
    const url = baseUrl || playwrightConfig.baseUrl;
    let runOnly = null;
    if (suite === 'selected' && Array.isArray(selectedTestIds) && selectedTestIds.length > 0) {
      runOnly = selectedTestIds;
    } else if (suite === 'full') {
      const fullList = await getPlaywrightTestListWithRecorded(projectId);
      runOnly = fullList.length > 0 ? fullList.map(t => t.id) : null;
    }
    const run = await PlaywrightRun.create({
      name,
      status: 'running',
      base_url: url,
      project_id: projectId,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
    const headless = typeof bodyHeadless === 'boolean' ? bodyHeadless : playwrightConfig.headless;
    runPlaywrightTests({
      playwrightRunId: run.id,
      baseUrl: url,
      headless,
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

// Create recorded test (optional addToProjectIds: array of project ids to link to)
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
    const normalizedSpec = normalizeRecordedSpecTitle(
      typeof spec_content === 'string' ? spec_content.trim() : '',
      name
    );
    const test = await PlaywrightRecordedTest.create({
      name: name.trim(),
      spec_content: normalizedSpec,
      base_url: base_url && typeof base_url === 'string' ? base_url.trim() || null : null
    });
    const projectIds = Array.isArray(addToProjectIds) ? addToProjectIds.filter(id => Number.isInteger(Number(id))) : [];
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


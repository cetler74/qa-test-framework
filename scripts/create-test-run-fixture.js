const { TestRun, TestResult, Project, ApiSpec } = require('../models');
const { generateReport } = require('../services/reportGenerator');

async function createFixture() {
  try {
    // Ensure there is at least one project
    let project = await Project.findOne();
    if (!project) {
      project = await Project.create({ name: 'Synthetic Project' });
    }

    // Optionally find an ApiSpec to attach to results
    const apiSpec = await ApiSpec.findOne();

    // Create a test run
    const testRun = await TestRun.create({
      name: 'Synthetic Delay Test',
      status: 'completed',
      project_id: project.id,
      total_tests: 2,
      passed_tests: 1,
      failed_tests: 1,
      duration_ms: 5000
    });

    // Create a passing test result
    await TestResult.create({
      test_run_id: testRun.id,
      test_name: 'Get Root',
      endpoint: '/',
      method: 'GET',
      status: 'passed',
      duration_ms: 100,
      request_body: '',
      response_body: '{"message":"ok"}',
      response_code: 200,
      assertions: [],
      error_message: null,
      api_spec_id: apiSpec ? apiSpec.id : null
    });

    // Create a failing test result
    await TestResult.create({
      test_run_id: testRun.id,
      test_name: 'Get Missing',
      endpoint: '/missing',
      method: 'GET',
      status: 'failed',
      duration_ms: 120,
      request_body: '',
      response_body: '{"error":"not found"}',
      response_code: 404,
      assertions: [],
      error_message: 'HTTP 404: Not Found',
      api_spec_id: apiSpec ? apiSpec.id : null
    });

    console.log('Synthetic test run created with id:', testRun.id);

    const { html, filePath } = await generateReport(testRun.id);
    console.log('Generated report at:', filePath);
    console.log('You can view it via GET /api/test-runs/' + testRun.id + '/report or open the file directly.');

    process.exit(0);
  } catch (err) {
    console.error('Error creating fixture:', err);
    process.exit(1);
  }
}

createFixture();

/**
 * Execute SOAP operations from a WSDL API spec and save results to TestRun/TestResult.
 */
const path = require('path');
const soap = require('soap');
const { ApiSpec, SoapOperation, TestRun, TestResult } = require('../models');

/**
 * Run SOAP operations and save results.
 * @param {number} projectId - Project ID
 * @param {number} apiSpecId - API spec (WSDL) ID
 * @param {number[]} operationIds - SoapOperation IDs to run
 * @param {string} runName - Test run name
 * @param {number} [testRunId] - Existing test run ID (if already created)
 * @returns {Promise<{ summary: { total, passed, failed }, testRunId }>}
 */
async function executeSoapTests(projectId, apiSpecId, operationIds, runName, testRunId) {
  const apiSpec = await ApiSpec.findByPk(apiSpecId);
  if (!apiSpec || apiSpec.format !== 'wsdl') {
    throw new Error('API spec not found or not WSDL');
  }

  const operations = await SoapOperation.findAll({
    where: { id: operationIds, api_spec_id: apiSpecId }
  });
  if (operations.length === 0) {
    throw new Error('No SOAP operations found');
  }

  let testRun;
  if (testRunId) {
    testRun = await TestRun.findByPk(testRunId);
    if (!testRun) throw new Error('Test run not found');
  } else {
    testRun = await TestRun.create({
      name: runName,
      status: 'running',
      project_id: projectId,
      run_type: 'soap',
      total_tests: operations.length,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
  }

  const startTime = Date.now();
  const wsdlPath = path.resolve(apiSpec.file_path);

  return new Promise((resolve, reject) => {
    soap.createClient(wsdlPath, (err, client) => {
      if (err) {
        TestRun.update(
          { status: 'failed', failed_tests: operations.length, duration_ms: Date.now() - startTime },
          { where: { id: testRun.id } }
        ).catch(() => {});
        return reject(new Error(`SOAP client failed: ${err.message}`));
      }

      let completed = 0;
      let passed = 0;
      let failed = 0;

      const checkDone = async () => {
        completed++;
        if (completed < operations.length) return;
        const duration = Date.now() - startTime;
        await testRun.update({
          status: failed > 0 ? 'failed' : 'passed',
          passed_tests: passed,
          failed_tests: failed,
          total_tests: operations.length,
          duration_ms: duration
        });
        resolve({ summary: { total: operations.length, passed, failed }, testRunId: testRun.id });
      };

      operations.forEach(async (op) => {
        const opStart = Date.now();
        const methodName = op.operation_name;
        if (typeof client[methodName] !== 'function') {
          await TestResult.create({
            test_run_id: testRun.id,
            test_name: op.name,
            endpoint: methodName,
            method: 'SOAP',
            status: 'failed',
            duration_ms: Date.now() - opStart,
            error_message: `Method ${methodName} not found on client`
          });
          failed++;
          return checkDone();
        }
        client[methodName](op.request_template || {}, async (err, result) => {
          const duration = Date.now() - opStart;
          const status = err ? 'failed' : 'passed';
          if (err) failed++; else passed++;
          await TestResult.create({
            test_run_id: testRun.id,
            test_name: op.name,
            endpoint: methodName,
            method: 'SOAP',
            status,
            duration_ms: duration,
            response_code: err ? null : 200,
            error_message: err ? (err.message || String(err)) : null,
            response_body: result ? JSON.stringify(result) : null
          });
          checkDone();
        });
      });
    });
  });
}

module.exports = { executeSoapTests };

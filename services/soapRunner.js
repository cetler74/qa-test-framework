/**
 * Execute SOAP operations from a WSDL API spec and save results to TestRun/TestResult.
 */
const path = require('path');
const soap = require('soap');
const { ApiSpec, SoapOperation, TestRun, TestResult, ProjectTest, ProjectTestStat } = require('../models');
const { isTestRunCancelled, clearCancelTestRun } = require('./testRunner');

/**
 * Safely serialize a value to JSON; avoids circular reference errors (e.g. from soap client result).
 * @param {*} value
 * @returns {string|null}
 */
function safeJsonStringify(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('circular')) {
      try {
        return JSON.stringify(extractPlainData(value));
      } catch (e2) {
        return JSON.stringify({ _note: 'Response omitted (circular or non-serializable)' });
      }
    }
    throw e;
  }
}

/**
 * Extract plain, serializable data from an object (skip functions and circular refs).
 * @param {*} obj
 * @param {Set} seen
 * @returns {*}
 */
function extractPlainData(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return undefined;
  if (Array.isArray(obj)) {
    seen.add(obj);
    return obj.map(item => extractPlainData(item, seen));
  }
  seen.add(obj);
  const out = {};
  for (const key of Object.keys(obj)) {
    if (key === 'req' || key === 'res' || key === 'request' || key === 'response') continue;
    try {
      const v = extractPlainData(obj[key], seen);
      if (v !== undefined) out[key] = v;
    } catch (e) {
      // skip
    }
  }
  return out;
}

/**
 * Run SOAP operations and save results.
 * @param {number} projectId - Project ID
 * @param {number} apiSpecId - API spec (WSDL) ID
 * @param {number[]} operationIds - SoapOperation IDs to run
 * @param {string} runName - Test run name
 * @param {number} [testRunId] - Existing test run ID (if already created)
 * @param {{ proxy?: { http?: string, https?: string, bypass?: string } }} [options] - Optional proxy for external SOAP endpoints
 * @returns {Promise<{ summary: { total, passed, failed }, testRunId }>}
 */
async function executeSoapTests(projectId, apiSpecId, operationIds, runName, testRunId, options = {}) {
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
      duration_ms: 0,
      run_by_user_id: options?.runByUserId ?? null
    });
  }

  const startTime = Date.now();
  const wsdlPath = path.resolve(apiSpec.file_path);
  const proxy = options && options.proxy;
  const soapOptions = {};
  if (proxy && (proxy.http || proxy.https)) {
    const proxyUrl = proxy.https || proxy.http;
    soapOptions.request = { proxy: proxyUrl };
  }

  return new Promise((resolve, reject) => {
    soap.createClient(wsdlPath, Object.keys(soapOptions).length ? soapOptions : undefined, (err, client) => {
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
        if (isTestRunCancelled(testRun.id)) {
          clearCancelTestRun(testRun.id);
          await testRun.update({
            status: 'cancelled',
            passed_tests: passed,
            failed_tests: failed,
            total_tests: operations.length,
            duration_ms: duration
          });
        } else {
          await testRun.update({
            status: failed > 0 ? 'failed' : 'passed',
            passed_tests: passed,
            failed_tests: failed,
            total_tests: operations.length,
            duration_ms: duration
          });
        }
        resolve({ summary: { total: operations.length, passed, failed }, testRunId: testRun.id });
      };

      operations.forEach(async (op) => {
        if (isTestRunCancelled(testRun.id)) {
          checkDone();
          return;
        }
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
          let testResult;
          try {
            testResult = await TestResult.create({
              test_run_id: testRun.id,
              test_name: op.name,
              endpoint: methodName,
              method: 'SOAP',
              status,
              duration_ms: duration,
              response_code: err ? null : 200,
              error_message: err ? (err.message || String(err)) : null,
              response_body: result ? safeJsonStringify(result) : null
            });
          } catch (createError) {
            // If something unexpected happens while saving the result, log and continue.
            console.error('[soapRunner] Failed to save SOAP TestResult:', createError.message || createError);
          }

          // Update project test catalogue / stats for this SOAP operation
          try {
            if (testResult && testRun && testRun.project_id) {
              const name = op.name || op.operation_name || methodName || `SOAP Operation ${op.id}`;
              const methodLabel = 'SOAP';
              const stableKey = `soap:${op.operation_name || methodLabel}:${name}`;

              const [projectTest] = await ProjectTest.findOrCreate({
                where: {
                  project_id: testRun.project_id,
                  stable_key: stableKey
                },
                defaults: {
                  test_type: 'soap',
                  name,
                  endpoint: methodName,
                  method: methodLabel,
                  source_id: op.id,
                  source_kind: 'soap_operation',
                  is_active: true
                }
              });

              await projectTest.update({
                name,
                endpoint: methodName,
                method: methodLabel,
                is_active: true
              });

              const [stats] = await ProjectTestStat.findOrCreate({
                where: { project_test_id: projectTest.id },
                defaults: {
                  total_runs: 0,
                  last_status: 'not_run'
                }
              });

              const newTotalRuns = (stats.total_runs || 0) + 1;
              await stats.update({
                total_runs: newTotalRuns,
                last_status: status,
                last_run_at: new Date(),
                last_run_source: 'soap',
                last_run_type: 'soap',
                last_run_id: testRun.id
              });
            }
          } catch (statsError) {
            console.error('[soapRunner] Failed to update project test stats for SOAP result:', statsError.message || statsError);
          }
          checkDone();
        });
      });
    });
  });
}

module.exports = { executeSoapTests };

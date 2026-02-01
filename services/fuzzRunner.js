const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { XMLParser } = require('fast-xml-parser');
const yaml = require('js-yaml');
const { ApiSpec, FuzzRun, FuzzResult } = require('../models');

const tempDir = path.join(__dirname, '..', 'temp');
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

/**
 * Resolve path to OpenAPI contract file for CATS.
 * Uses file_path if file exists; otherwise writes spec_content to a temp file.
 * @param {number} apiSpecId - API spec ID
 * @returns {Promise<string>} Absolute path to contract file
 */
async function resolveContractPath(apiSpecId) {
  const apiSpec = await ApiSpec.findByPk(apiSpecId);
  if (!apiSpec) {
    throw new Error(`API spec ${apiSpecId} not found`);
  }
  if (apiSpec.format === 'wsdl') {
    throw new Error('CATS requires OpenAPI (YAML/JSON); WSDL specs are not supported for fuzzing');
  }

  let contractPath = apiSpec.file_path;
  if (!path.isAbsolute(contractPath)) {
    contractPath = path.join(process.cwd(), contractPath);
  }
  if (fs.existsSync(contractPath)) {
    return contractPath;
  }

  // Fallback: write spec_content to temp file
  const specContent = apiSpec.spec_content;
  if (!specContent || (typeof specContent !== 'object' && typeof specContent !== 'string')) {
    throw new Error(`No contract file or spec_content for API spec ${apiSpecId}`);
  }

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const ext = apiSpec.format === 'json' ? '.json' : '.yaml';
  const tempFile = path.join(tempDir, `fuzz-contract-${apiSpecId}-${Date.now()}${ext}`);
  if (typeof specContent === 'object') {
    const str = apiSpec.format === 'json' ? JSON.stringify(specContent, null, 2) : yaml.dump(specContent);
    fs.writeFileSync(tempFile, str, 'utf8');
  } else {
    fs.writeFileSync(tempFile, specContent, 'utf8');
  }
  return tempFile;
}

/**
 * Run CATS CLI with given options.
 * @param {object} options - { contractPath, serverUrl, outputDir, ... }
 * @returns {Promise<{ exitCode: number, junitPath: string | null }>}
 */
function runCats(options) {
  const { contractPath, serverUrl, outputDir } = options;
  const catsCmd = process.env.CATS_CMD || 'cats';
  const args = [
    '--contract=' + contractPath,
    '--server=' + serverUrl,
    '--reportFormat=JUNIT',
    '--output=' + outputDir
  ];
  if (options.paths) args.push('--paths=' + options.paths);
  if (options.skipPaths) args.push('--skipPaths=' + options.skipPaths);
  if (options.maxRequestsPerMinute) args.push('--maxRequestsPerMinute=' + options.maxRequestsPerMinute);

  return new Promise((resolve, reject) => {
    const parts = catsCmd.trim().split(/\s+/);
    const isJava = parts[0].toLowerCase() === 'java';
    const cmd = isJava ? 'java' : parts[0];
    const cmdArgs = isJava ? parts.slice(1).concat(args) : (parts.length > 1 ? parts.slice(1) : []).concat(args);

    const child = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.stdout.on('data', () => {});

    child.on('close', (exitCode) => {
      const junitPath = path.join(outputDir, 'junit.xml');
      const junitPathAlt = path.join(outputDir, 'cats-report', 'junit.xml');
      const resolved = fs.existsSync(junitPath) ? junitPath : (fs.existsSync(junitPathAlt) ? junitPathAlt : null);
      resolve({ exitCode: exitCode ?? 1, junitPath: resolved });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run CATS: ${err.message}. Ensure CATS is installed (Java + CATS JAR or cats CLI).`));
    });
  });
}

/**
 * Recursively collect all testcase objects from a parsed JUNIT tree.
 * Handles testsuites -> testsuite[] -> testcase[] and flat testcase.
 * @param {object} node - Parsed XML node
 * @returns {object[]} Array of testcase-like objects
 */
function collectTestcases(node) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  const cases = node.testcase || node.testCase;
  if (cases) {
    const tcs = Array.isArray(cases) ? cases : [cases];
    out.push(...tcs);
  }
  const testsuite = node.testsuite || node.testSuite;
  if (testsuite) {
    const suites = Array.isArray(testsuite) ? testsuite : [testsuite];
    for (const s of suites) {
      out.push(...collectTestcases(s));
    }
  }
  const testsuites = node.testsuites || node.testSuites;
  if (testsuites) {
    out.push(...collectTestcases(testsuites));
  }
  return out;
}

/**
 * Get aggregate counts from root or first suite (supports attributes or child nodes).
 * @param {object} root - Parsed root (e.g. parsed or first testsuite)
 * @returns {{ tests: number, failures: number, errors: number, time: number }}
 */
function getSuiteCounts(root) {
  if (!root) return { tests: 0, failures: 0, errors: 0, time: 0 };
  const tests = parseInt(root['@_tests'] ?? root.tests ?? '0', 10);
  const failures = parseInt(root['@_failures'] ?? root.failures ?? '0', 10);
  const errors = parseInt(root['@_errors'] ?? root.errors ?? '0', 10);
  const time = parseFloat(root['@_time'] ?? root.time ?? '0') || 0;
  return { tests, failures, errors, time };
}

/**
 * Parse JUNIT XML report into structured data.
 * Supports CATS and other JUNIT outputs: testsuites/testsuite/testcase (nested or flat).
 * @param {string} junitPath - Path to junit.xml
 * @returns {object} { tests, failures, errors, time, testcases: [{ name, classname, time, failure?, error? }] }
 */
function parseJunitReport(junitPath) {
  const xml = fs.readFileSync(junitPath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const root = parsed.testsuites || parsed.testsuite || parsed;
  const rootObj = Array.isArray(root) ? root[0] : root;
  let { tests, failures, errors, time } = getSuiteCounts(rootObj);
  const innerSuite = rootObj && (rootObj.testsuite ? (Array.isArray(rootObj.testsuite) ? rootObj.testsuite[0] : rootObj.testsuite) : null);
  if (innerSuite && tests === 0 && failures === 0 && errors === 0) {
    const inner = getSuiteCounts(innerSuite);
    tests = inner.tests;
    failures = inner.failures;
    errors = inner.errors;
    time = inner.time;
  }

  const rawCases = collectTestcases(parsed);
  const list = rawCases.map((tc) => {
    const name = tc['@_name'] ?? tc.name ?? '';
    const classname = tc['@_classname'] ?? tc.classname ?? '';
    const timeVal = parseFloat(tc['@_time'] ?? tc.time ?? '0') || 0;
    const failure = tc.failure;
    const error = tc.error;
    const failureMsg = failure ? (typeof failure === 'string' ? failure : (failure['#text'] ?? failure['@_message'] ?? '')) : null;
    const errorMsg = error ? (typeof error === 'string' ? error : (error['#text'] ?? error['@_message'] ?? '')) : null;
    return {
      name,
      classname,
      time: timeVal,
      failure: failureMsg,
      error: errorMsg
    };
  });

  return { tests, failures, errors, time, testcases: list };
}

const MAX_RESPONSE_BODY_LENGTH = 65536;

/**
 * Execute fuzz run: create FuzzRun, run CATS, parse JUNIT, persist FuzzResults, update FuzzRun.
 * @param {number} projectId - Project ID
 * @param {number} apiSpecId - API spec ID (OpenAPI YAML/JSON)
 * @param {string} name - Run name
 * @param {object} options - { fuzzRunId, serverUrl, flowId, paths, skipPaths, ... }
 */
async function executeFuzz(projectId, apiSpecId, name, options = {}) {
  const { fuzzRunId, serverUrl, flowId } = options;
  let fuzzRun;

  if (fuzzRunId) {
    fuzzRun = await FuzzRun.findByPk(fuzzRunId);
    if (!fuzzRun) throw new Error(`FuzzRun ${fuzzRunId} not found`);
  } else {
    fuzzRun = await FuzzRun.create({
      name,
      status: 'running',
      project_id: projectId,
      api_spec_id: apiSpecId,
      flow_id: flowId || null,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
  }

  let contractPath;
  let outputDir;

  try {
    contractPath = await resolveContractPath(apiSpecId);
    if (!serverUrl || typeof serverUrl !== 'string' || !serverUrl.trim()) {
      throw new Error('serverUrl (base URL) is required for CATS');
    }
    const baseUrl = serverUrl.trim().replace(/\/$/, '');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    outputDir = path.join(tempDir, `cats-output-${fuzzRun.id}-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const { exitCode, junitPath } = await runCats({
      contractPath,
      serverUrl: baseUrl,
      outputDir,
      paths: options.paths,
      skipPaths: options.skipPaths,
      maxRequestsPerMinute: options.maxRequestsPerMinute
    });

    if (!junitPath) {
      await fuzzRun.update({
        status: 'failed',
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0
      });
      console.error('[fuzzRunner] No JUNIT report produced by CATS. Exit code:', exitCode);
      return fuzzRun;
    }

    const report = parseJunitReport(junitPath);
    const durationMs = Math.round((report.time || 0) * 1000);
    const failedCount = (report.failures || 0) + (report.errors || 0);
    const passedCount = Math.max(0, (report.tests || 0) - failedCount);

    const results = (report.testcases || []).map((tc, idx) => {
      const status = tc.failure || tc.error ? (tc.error ? 'error' : 'failed') : 'passed';
      const errorMessage = tc.failure || tc.error || null;
      return {
        fuzz_run_id: fuzzRun.id,
        test_name: tc.name || `Test ${idx + 1}`,
        endpoint: null,
        method: null,
        status,
        duration_ms: tc.time ? Math.round(tc.time * 1000) : null,
        request_body: null,
        response_body: null,
        response_code: null,
        fuzzer_name: tc.classname || null,
        error_message: errorMessage ? String(errorMessage).slice(0, 65535) : null,
        execution_order: idx + 1
      };
    });

    if (results.length > 0) {
      await FuzzResult.bulkCreate(results);
    }

    await fuzzRun.update({
      status: failedCount > 0 ? 'failed' : 'passed',
      total_tests: report.tests || 0,
      passed_tests: passedCount,
      failed_tests: failedCount,
      duration_ms: durationMs,
      report_path: outputDir
    });

    return fuzzRun;
  } catch (err) {
    console.error('[fuzzRunner] executeFuzz error:', err);
    await fuzzRun.update({
      status: 'failed',
      total_tests: fuzzRun.total_tests || 0,
      passed_tests: fuzzRun.passed_tests || 0,
      failed_tests: fuzzRun.failed_tests || 0
    });
    throw err;
  } finally {
    if (contractPath && contractPath.startsWith(tempDir)) {
      try { fs.unlinkSync(contractPath); } catch (e) {}
    }
  }
}

module.exports = {
  resolveContractPath,
  runCats,
  parseJunitReport,
  executeFuzz
};

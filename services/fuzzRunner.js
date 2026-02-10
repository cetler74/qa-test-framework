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

const PROGRESS_UPDATE_INTERVAL_MS = 2000;

/**
 * Run CATS CLI with given options. Optionally streams stdout/stderr to onProgress for live progress.
 * @param {object} options - { contractPath, serverUrl, outputDir, onProgress?(message: string), fuzzRunId? }
 * @returns {Promise<{ exitCode: number, junitPath: string | null }>}
 */
function runCats(options) {
  const { contractPath, serverUrl, outputDir, onProgress, fuzzRunId } = options;
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
    let lastProgressLine = '';
    let progressTimer = null;

    function flushProgress() {
      if (onProgress && fuzzRunId && lastProgressLine.trim()) {
        const msg = lastProgressLine.trim().slice(0, 1000);
        onProgress(fuzzRunId, msg).catch(() => {});
      }
      progressTimer = null;
    }

    function scheduleProgress() {
      if (!onProgress || !fuzzRunId || progressTimer) return;
      progressTimer = setTimeout(flushProgress, PROGRESS_UPDATE_INTERVAL_MS);
    }

    function onLine(line) {
      const s = (line || '').trim();
      if (!s) return;
      lastProgressLine = s;
      scheduleProgress();
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() || '';
      lines.forEach(onLine);
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      stderrBuf += data.toString();
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() || '';
      lines.forEach(onLine);
    });

    child.on('close', (exitCode) => {
      if (progressTimer) clearTimeout(progressTimer);
      if ((stdoutBuf || stderrBuf) && (stdoutBuf.trim() || stderrBuf.trim())) {
        lastProgressLine = (stdoutBuf || '').trim() || (stderrBuf || '').trim();
      }
      flushProgress();
      if (onProgress && fuzzRunId) {
        onProgress(fuzzRunId, null).catch(() => {}); // clear progress when done
      }
      const junitPath = path.join(outputDir, 'junit.xml');
      const junitPathAlt = path.join(outputDir, 'cats-report', 'junit.xml');
      const resolved = fs.existsSync(junitPath) ? junitPath : (fs.existsSync(junitPathAlt) ? junitPathAlt : null);
      resolve({ exitCode: exitCode ?? 1, junitPath: resolved });
    });

    child.on('error', (err) => {
      if (progressTimer) clearTimeout(progressTimer);
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
    const systemOut = tc['system-out'] != null ? (typeof tc['system-out'] === 'string' ? tc['system-out'] : (tc['system-out']['#text'] ?? '')) : '';
    const systemErr = tc['system-err'] != null ? (typeof tc['system-err'] === 'string' ? tc['system-err'] : (tc['system-err']['#text'] ?? '')) : '';
    const { requestBody, responseBody, endpoint, method, responseCode } = parseRequestResponseFromOutput(systemOut || systemErr);
    return {
      name,
      classname,
      time: timeVal,
      failure: failureMsg,
      error: errorMsg,
      requestBody: requestBody || null,
      responseBody: responseBody || null,
      endpoint: endpoint || null,
      method: method || null,
      responseCode: responseCode != null ? responseCode : null
    };
  });

  return { tests, failures, errors, time, testcases: list };
}

/**
 * Try to parse request/response from JUNIT system-out or system-err text.
 * Handles "Request:" / "Response:" blocks, JSON-like blocks, or returns nulls.
 */
function parseRequestResponseFromOutput(text) {
  const out = { requestBody: null, responseBody: null, endpoint: null, method: null, responseCode: null };
  if (!text || typeof text !== 'string') return out;
  const reqMatch = text.match(/(?:Request:?\s*|requestPayload:?\s*|requestBody:?\s*)(?:\n)?([\s\S]*?)(?=Response:?|responsePayload:?|responseBody:?|$)/i);
  const resMatch = text.match(/(?:Response:?\s*|responsePayload:?|responseBody:?)(?:\n)?([\s\S]*?)$/im);
  if (reqMatch && reqMatch[1]) out.requestBody = reqMatch[1].trim().slice(0, MAX_RESPONSE_BODY_LENGTH);
  if (resMatch && resMatch[1]) out.responseBody = resMatch[1].trim().slice(0, MAX_RESPONSE_BODY_LENGTH);
  const codeMatch = text.match(/(?:responseCode|status|HTTP)\s*:?\s*(\d{3})/i);
  if (codeMatch) out.responseCode = parseInt(codeMatch[1], 10);
  const methodMatch = text.match(/(?:method|HTTP)\s*:?\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/i);
  if (methodMatch) out.method = methodMatch[1].toUpperCase();
  const pathMatch = text.match(/(?:path|endpoint|url)\s*:?\s*(\S+)/i);
  if (pathMatch) out.endpoint = pathMatch[1].trim().slice(0, 500);
  return out;
}

/**
 * Normalize path for matching: strip protocol/host, leading/trailing slashes, query string.
 */
function normalizePathForMatching(pathOrUrl) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  let s = pathOrUrl.trim();
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      s = u.pathname || s;
    }
  } catch (_) {}
  s = s.replace(/^\//, '').replace(/\/$/, '').split('?')[0].trim();
  return s;
}

/**
 * Extract fuzzer name from CATS JSON or from request (e.g. User-Agent "Test N - FuzzerName").
 */
function extractFuzzerFromCatsJson(data, req) {
  const fromData = data.scenario ?? data.fuzzer ?? data.fuzzerName ?? data.fuzzer_name ?? null;
  if (fromData && typeof fromData === 'string') return fromData.trim() || null;
  if (req && typeof req === 'object') {
    const headers = req.headers || req.header;
    if (Array.isArray(headers)) {
      const ua = headers.find((h) => (h.key || h.name || '').toLowerCase() === 'user-agent');
      const val = ua && (ua.value || ua.val);
      if (val && typeof val === 'string') {
        const m = val.match(/Test\s*\d+\s*-\s*(\S+)/);
        if (m) return m[1].trim();
      }
    }
  }
  return null;
}

/**
 * Scan CATS output folder for JSON files and extract request/response per test.
 * Returns array of { request_body, response_body, endpoint, method, response_code, path_normalized, fuzzer_name } in file order.
 */
function loadRequestResponseFromCatsOutput(outputDir) {
  const entries = [];
  const dirs = [outputDir];
  const catsReport = path.join(outputDir, 'cats-report');
  if (fs.existsSync(catsReport) && fs.statSync(catsReport).isDirectory()) {
    dirs.push(catsReport);
  }
  const jsonFiles = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      jsonFiles.push(path.join(dir, f));
    }
  }
  jsonFiles.sort();
  for (const filePath of jsonFiles) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const req = data.requestPayload ?? data.request ?? data.requestBody ?? data.requestContent ?? data.requestPayloadContent ?? data.requestBodyContent ?? (data.request && data.request.payload) ?? (data.request && data.request.body) ?? null;
      const res = data.responsePayload ?? data.response ?? data.responseBody ?? data.responseContent ?? data.responsePayloadContent ?? data.responseBodyContent ?? (data.response && data.response.payload) ?? (data.response && data.response.body) ?? null;
      const reqObj = data.request ?? (typeof req === 'object' ? req : null);
      let requestBody = null;
      let responseBody = null;
      if (req != null) requestBody = typeof req === 'string' ? req : JSON.stringify(req, null, 2);
      if (res != null) responseBody = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
      if (requestBody && requestBody.length > MAX_RESPONSE_BODY_LENGTH) requestBody = requestBody.slice(0, MAX_RESPONSE_BODY_LENGTH);
      if (responseBody && responseBody.length > MAX_RESPONSE_BODY_LENGTH) responseBody = responseBody.slice(0, MAX_RESPONSE_BODY_LENGTH);
      const endpoint = (data.path ?? data.endpoint ?? data.url ?? (data.request && data.request.path) ?? (data.request && data.request.uri) ?? (data.request && data.request.url)) || null;
      const method = (data.method ?? data.httpMethod ?? (data.request && data.request.method)) ? String(data.method ?? data.httpMethod ?? data.request.method).toUpperCase().slice(0, 10) : null;
      const responseCode = data.responseCode ?? data.statusCode ?? data.status ?? (data.response && data.response.code) ?? (data.response && data.response.status) ?? null;
      const code = responseCode != null ? parseInt(responseCode, 10) : null;
      const path_normalized = normalizePathForMatching(endpoint);
      const fuzzer_name = extractFuzzerFromCatsJson(data, reqObj);
      entries.push({
        request_body: requestBody || null,
        response_body: responseBody || null,
        endpoint: endpoint ? String(endpoint).slice(0, 500) : null,
        method: method || null,
        response_code: Number.isInteger(code) ? code : null,
        path_normalized: path_normalized || null,
        fuzzer_name: fuzzer_name || null
      });
    } catch (e) {
      // Skip malformed or non-test JSON
    }
  }
  return entries;
}

/**
 * Build matching key for a DB result: (path_normalized, method, fuzzer_name).
 * Path from result.endpoint or parsed from result.test_name (e.g. "Test97 - /path").
 */
function resultMatchingKey(result) {
  let pathStr = (result.endpoint || '').trim();
  if (!pathStr && result.test_name) {
    const m = result.test_name.match(/\s+(\/[^\s]+)/);
    if (m) pathStr = m[1];
  }
  const pathNorm = normalizePathForMatching(pathStr);
  const method = (result.method || '').toUpperCase().slice(0, 10) || null;
  const fuzzer = (result.fuzzer_name || '').trim() || null;
  return `${pathNorm}|${method || ''}|${fuzzer || ''}`;
}

/**
 * Match CATS JSON entries to DB results by (path, method, fuzzer_name).
 * When multiple entries share the same key, assigns by order within that key.
 * Falls back to index-based match when no key match is possible.
 */
function matchCatsEntriesToResults(dbResults, catsEntries) {
  const indexByKey = new Map();
  const assignedCats = new Set();

  function entryKey(entry) {
    const pathNorm = (entry.path_normalized || normalizePathForMatching(entry.endpoint) || '').trim();
    const method = (entry.method || '').toUpperCase().slice(0, 10) || '';
    const fuzzer = (entry.fuzzer_name || '').trim() || '';
    return `${pathNorm}|${method}|${fuzzer}`;
  }

  const resultIndexToEntry = new Map();

  for (let i = 0; i < dbResults.length; i++) {
    const result = dbResults[i];
    const key = resultMatchingKey(result);
    if (!indexByKey.has(key)) indexByKey.set(key, 0);
    const orderWithinKey = indexByKey.get(key);

    const candidates = catsEntries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entryKey(entry) === key);
    const chosen = candidates[orderWithinKey];
    if (chosen && !assignedCats.has(chosen.idx)) {
      resultIndexToEntry.set(i, chosen.entry);
      assignedCats.add(chosen.idx);
    }
    indexByKey.set(key, orderWithinKey + 1);
  }

  if (resultIndexToEntry.size === 0 && dbResults.length > 0 && catsEntries.length > 0) {
    for (let i = 0; i < dbResults.length && i < catsEntries.length; i++) {
      resultIndexToEntry.set(i, catsEntries[i]);
    }
  }
  return resultIndexToEntry;
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
      const noReportMsg = `CATS did not produce a JUNIT report (exit code: ${exitCode}). Check that CATS is installed (Java + CATS JAR or \`cats\` CLI) and the OpenAPI spec is valid.`;
      await fuzzRun.update({
        status: 'failed',
        total_tests: 0,
        passed_tests: 0,
        failed_tests: 0,
        duration_ms: 0,
        progress_message: noReportMsg
      });
      console.error('[fuzzRunner] No JUNIT report produced by CATS. Exit code:', exitCode);
      return fuzzRun;
    }

    const report = parseJunitReport(junitPath);
    const durationMs = Math.round((report.time || 0) * 1000);

    const results = (report.testcases || []).map((tc, idx) => {
      const status = tc.failure || tc.error ? (tc.error ? 'error' : 'failed') : 'passed';
      const errorMessage = tc.failure || tc.error || null;
      return {
        fuzz_run_id: fuzzRun.id,
        test_name: tc.name || `Test ${idx + 1}`,
        endpoint: tc.endpoint ?? null,
        method: tc.method ?? null,
        status,
        duration_ms: tc.time ? Math.round(tc.time * 1000) : null,
        request_body: tc.requestBody ?? null,
        response_body: tc.responseBody ?? null,
        response_code: tc.responseCode ?? null,
        fuzzer_name: tc.classname || null,
        error_message: errorMessage ? String(errorMessage).slice(0, 65535) : null,
        execution_order: idx + 1
      };
    });

    if (results.length > 0) {
      await FuzzResult.bulkCreate(results);

      // Enrich from CATS JSON reports if present (request/response for copy-to-issue).
      // Match by (path, method, fuzzer_name) so the correct request/response is attached to each result.
      const catsEntries = loadRequestResponseFromCatsOutput(outputDir);
      if (catsEntries.length > 0) {
        const dbResults = await FuzzResult.findAll({
          where: { fuzz_run_id: fuzzRun.id },
          order: [['execution_order', 'ASC']]
        });
        const matchMap = matchCatsEntriesToResults(dbResults, catsEntries);
        for (let i = 0; i < dbResults.length; i++) {
          const entry = matchMap.get(i);
          if (!entry) continue;
          if (entry.request_body || entry.response_body || entry.endpoint || entry.method != null || entry.response_code != null) {
            await dbResults[i].update({
              request_body: entry.request_body ?? dbResults[i].request_body,
              response_body: entry.response_body ?? dbResults[i].response_body,
              endpoint: entry.endpoint ?? dbResults[i].endpoint,
              method: entry.method ?? dbResults[i].method,
              response_code: entry.response_code ?? dbResults[i].response_code
            });
          }
        }
      }
    }

    // Derive totals from actual stored results so they always match the DB (fixes mismatch when JUNIT root/suite counts differ)
    const actualTotal = results.length;
    const actualPassed = results.filter((r) => r.status === 'passed').length;
    const actualFailed = actualTotal - actualPassed;

    await fuzzRun.update({
      status: (actualFailed > 0 && actualPassed > 0) ? 'partial_failed' : (actualFailed > 0 ? 'failed' : 'passed'),
      total_tests: actualTotal,
      passed_tests: actualPassed,
      failed_tests: actualFailed,
      duration_ms: durationMs,
      report_path: outputDir,
      progress_message: null
    });

    // Pre-generate HTML report in background so View Report serves from file (does not block the app)
    const { generateFuzzReport } = require('./fuzzReportGenerator');
    setImmediate(() => {
      generateFuzzReport(fuzzRun.id, { skipCache: true, writeToStablePath: true })
        .catch((err) => console.error('[fuzzRunner] Pre-generate report failed:', err));
    });

    return fuzzRun;
  } catch (err) {
    console.error('[fuzzRunner] executeFuzz error:', err);
    const errMsg = (err && err.message) ? String(err.message).slice(0, 2000) : null;
    await fuzzRun.update({
      status: 'failed',
      total_tests: fuzzRun.total_tests || 0,
      passed_tests: fuzzRun.passed_tests || 0,
      failed_tests: fuzzRun.failed_tests || 0,
      progress_message: errMsg
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

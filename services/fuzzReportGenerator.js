const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { FuzzRun, FuzzResult, ApiSpec, Project } = require('../models');
const { QA_TEST_HUB_LOGO_DATA_URI } = require('./reportBranding');

const reportsDir = process.env.REPORTS_DIR || './reports';
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const REPORT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const reportCache = new Map(); // id -> { html, cachedAt }

const reportTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fuzz Report: {{run.name}}</title>
    <link rel="icon" href="{{{qaTestHubLogoDataUri}}}" type="image/svg+xml">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; background: #f9fafb; }
        .report-header { background: #111827; color: white; padding: 24px 32px; display: flex; align-items: center; gap: 16px; }
        .report-header > img { height: 36px; width: auto; }
        .report-brand-copy { display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
        .report-brand-org { font-size: 12px; font-weight: 600; }
        .report-header h1 { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 600; margin: 0; }
        .report-header h1 img { width: 28px; height: 28px; }
        .container { max-width: 1400px; margin: 0 auto; background: white; padding: 32px; min-height: calc(100vh - 80px); }
        header { border-bottom: 1px solid #e5e7eb; padding-bottom: 24px; margin-bottom: 32px; }
        .report-title { color: #1f2937; margin-bottom: 16px; font-size: 28px; font-weight: 700; }
        .metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 24px; }
        .metadata-item { padding: 16px; background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; }
        .metadata-label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; font-weight: 500; }
        .metadata-value { font-size: 16px; font-weight: 600; color: #1f2937; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 24px; margin: 32px 0; }
        .summary-card { padding: 24px; border-radius: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .summary-card.total { background: white; border: 1px solid #e5e7eb; border-top: 4px solid #14b8a6; }
        .summary-card.passed { background: white; border: 1px solid #e5e7eb; border-top: 4px solid #10b981; }
        .summary-card.failed { background: white; border: 1px solid #e5e7eb; border-top: 4px solid #ef4444; }
        .summary-card.duration { background: white; border: 1px solid #e5e7eb; border-top: 4px solid #f59e0b; }
        .summary-number { font-size: 36px; font-weight: 700; margin-bottom: 8px; }
        .summary-label { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 500; }
        .status-badge { display: inline-flex; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
        .status-badge.passed { background: #10b981; color: white; }
        .status-badge.failed { background: #ef4444; color: white; }
        .status-badge.error { background: #dc2626; color: white; }
        .status-badge.warn { background: #f59e0b; color: white; }
        .status-badge.running { background: #f59e0b; color: white; }
        .table-wrapper { overflow-x: auto; margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 8px; }
        .results-table { width: 100%; border-collapse: collapse; min-width: 1200px; }
        .results-table th, .results-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
        .results-table th { background: #f9fafb; font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 600; white-space: nowrap; }
        .results-table tr:hover { background: #f9fafb; }
        .results-table .col-order { width: 48px; text-align: right; }
        .results-table .col-status { min-width: 120px; }
        .results-table .col-url { min-width: 200px; max-width: 320px; word-break: break-all; white-space: pre-wrap; font-size: 12px; }
        .results-table .col-method { width: 80px; }
        .results-table .col-code { width: 90px; }
        .results-table .col-duration { width: 90px; }
        .error-cell { min-width: 200px; max-width: 380px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; color: #b91c1c; }
        .request-response-block { min-width: 280px; max-width: 520px; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 11px; line-height: 1.45; font-family: ui-monospace, 'SF Mono', 'Consolas', monospace; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
        .request-response-block.empty { color: #9ca3af; font-style: italic; }
        .detail-label { font-size: 11px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; font-weight: 600; }
        .copy-hint { font-size: 11px; color: #6b7280; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="report-header">
      <img src="https://conteudos.meo.pt/Style%20Library/quantcast/logo-meo.png?qc-size=98,56" alt="MEO logo">
      <div class="report-brand-copy">
        <span class="report-brand-org">DEO/ECP/EPS</span>
        <h1><span>QA Test Hub</span><img src="{{{qaTestHubLogoDataUri}}}" alt="QA Test Hub logo"></h1>
      </div>
    </div>
    <div class="container">
        <header>
            <div class="report-title">{{run.name}}</div>
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Status</div>
                    <div class="metadata-value"><span class="status-badge {{run.status}}">{{run.status}}</span></div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">API Spec</div>
                    <div class="metadata-value">{{apiSpecName}}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Project</div>
                    <div class="metadata-value">{{projectName}}</div>
                </div>
                {{#if run.server_url}}
                <div class="metadata-item">
                    <div class="metadata-label">Base URL (server)</div>
                    <div class="metadata-value">{{run.server_url}}</div>
                </div>
                {{/if}}
            </div>
            <div class="summary">
                <div class="summary-card total">
                    <div class="summary-number">{{run.total_tests}}</div>
                    <div class="summary-label">Total</div>
                </div>
                <div class="summary-card passed">
                    <div class="summary-number">{{run.passed_tests}}</div>
                    <div class="summary-label">Passed</div>
                </div>
                <div class="summary-card failed">
                    <div class="summary-number">{{run.failed_tests}}</div>
                    <div class="summary-label">Failed</div>
                </div>
                <div class="summary-card duration">
                    <div class="summary-number">{{durationSec}}</div>
                    <div class="summary-label">Duration (s)</div>
                </div>
            </div>
        </header>
        <h2 style="margin-bottom:16px;font-size:20px;">Fuzz Results (include request/response when submitting issues)</h2>
        <div class="table-wrapper">
        <table class="results-table">
            <thead>
                <tr>
                    <th class="col-order">#</th>
                    <th>Test name</th>
                    <th>Fuzzer</th>
                    <th class="col-status">Status</th>
                    <th class="col-url">Full URL (Base + path)</th>
                    <th class="col-method">Method</th>
                    <th class="col-code">Response code</th>
                    <th class="col-duration">Duration (ms)</th>
                    <th>Error / message</th>
                    <th>Request</th>
                    <th>Response</th>
                </tr>
            </thead>
            <tbody>
                {{#each results}}
                <tr>
                    <td class="col-order">{{this.execution_order}}</td>
                    <td>{{this.test_name}}</td>
                    <td>{{this.fuzzer_name}}</td>
                    <td class="col-status"><span class="status-badge {{this.status}}">{{this.statusWithCode}}</span></td>
                    <td class="col-url">{{#if this.full_url}}{{this.full_url}}{{else}}{{#if this.endpoint}}{{this.endpoint}}{{else}}—{{/if}}{{/if}}</td>
                    <td class="col-method">{{#if this.method}}{{this.method}}{{else}}—{{/if}}</td>
                    <td class="col-code">{{#if this.response_code}}{{this.response_code}}{{else}}—{{/if}}</td>
                    <td class="col-duration">{{this.duration_ms}}</td>
                    <td class="error-cell">{{this.error_message}}</td>
                    <td>
                        <div class="detail-label">Request body</div>
                        <div class="request-response-block {{#unless this.request_body}}empty{{/unless}}">{{#if this.request_body}}{{this.request_body}}{{else}}—{{/if}}</div>
                        {{#if this.request_body}}<div class="copy-hint">Copy above when submitting an issue</div>{{else}}<div class="copy-hint">Not captured. Use Error/message column or CATS HTML report (cats-report/index.html) for details.</div>{{/if}}
                    </td>
                    <td>
                        <div class="detail-label">Response body</div>
                        <div class="request-response-block {{#unless this.response_body}}empty{{/unless}}">{{#if this.response_body}}{{this.response_body}}{{else}}—{{/if}}</div>
                        {{#if this.response_body}}<div class="copy-hint">Copy above when submitting an issue</div>{{else}}<div class="copy-hint">Not captured. Use Error/message column or CATS HTML report (cats-report/index.html) for details.</div>{{/if}}
                    </td>
                </tr>
                {{/each}}
            </tbody>
        </table>
        </div>
        {{#unless results.length}}
        <p style="color:#6b7280;margin-top:16px;">No results recorded.</p>
        {{/unless}}
    </div>
</body>
</html>
`;

const compiledTemplate = handlebars.compile(reportTemplate);

/**
 * Generate HTML report for a fuzz run. Uses in-memory cache for completed runs (repeat views are fast).
 * @param {string|number} fuzzRunId - Fuzz run ID
 * @param {object} [options] - { skipCache: true } to force regenerate (e.g. for download)
 * @returns {Promise<{ html, filePath, fileName }>}
 */
async function generateFuzzReport(fuzzRunId, options = {}) {
  const id = typeof fuzzRunId === 'string' ? parseInt(fuzzRunId, 10) : fuzzRunId;
  const run = await FuzzRun.findByPk(id, {
    include: [
      { model: FuzzResult, as: 'fuzzResults', order: [['execution_order', 'ASC']] },
      { model: ApiSpec, as: 'apiSpec', attributes: ['id', 'name'] },
      { model: Project, as: 'project', attributes: ['id', 'name'] }
    ]
  });

  if (!run) {
    throw new Error('Fuzz run not found');
  }

  const status = (run.status || '').toLowerCase();
  const isRunning = status === 'running';
  const cached = !options.skipCache && !isRunning && reportCache.get(id);
  if (cached && (Date.now() - cached.cachedAt) < REPORT_CACHE_TTL_MS) {
    const fileName = `report-fuzz-${id}-${cached.cachedAt}.html`;
    const filePath = path.join(reportsDir, fileName);
    return { html: cached.html, filePath, fileName };
  }
  if (isRunning) {
    reportCache.delete(id);
  }

  const runJson = run.toJSON();
  const results = runJson.fuzzResults || [];
  const durationSec = run.duration_ms != null ? (run.duration_ms / 1000).toFixed(2) : '—';

  // Ensure summary totals match actual result rows (fixes mismatch when DB counts were wrong)
  if (results.length > 0) {
    runJson.total_tests = results.length;
    runJson.passed_tests = results.filter((r) => r.status === 'passed').length;
    runJson.failed_tests = results.length - runJson.passed_tests;
  }

  // Build full URL (Base URL + path) and status-with-code for each result
  const baseUrl = (runJson.server_url || '').replace(/\/$/, '');
  const resultsWithFullUrl = results.map((r) => {
    let pathPart = (r.endpoint || '').trim().replace(/^\//, '');
    if (!pathPart && r.test_name) {
      const pathMatch = r.test_name.match(/\s+(\/[^\s]+)/);
      if (pathMatch) pathPart = pathMatch[1].replace(/^\//, '');
    }
    const fullUrl = baseUrl && pathPart ? `${baseUrl}/${pathPart}` : (r.endpoint || null);
    const statusWithCode = (r.status === 'error' || r.status === 'failed') && r.response_code != null
      ? `${r.status} (${r.response_code})`
      : (r.status || '—');
    return { ...r, full_url: fullUrl || null, statusWithCode };
  });

  const templateData = {
    run: runJson,
    apiSpecName: run.apiSpec ? run.apiSpec.name : '—',
    projectName: run.project ? run.project.name : '—',
    durationSec,
    results: resultsWithFullUrl,
    qaTestHubLogoDataUri: QA_TEST_HUB_LOGO_DATA_URI
  };

  const html = compiledTemplate(templateData);

  const now = Date.now();
  const writeToStable = options.writeToStablePath === true;
  const fileName = writeToStable ? `report-fuzz-${id}.html` : `report-fuzz-${id}-${now}.html`;
  const filePath = path.join(reportsDir, fileName);
  fs.writeFileSync(filePath, html);

  if (!isRunning) {
    reportCache.set(id, { html, cachedAt: now });
  }

  return { html, filePath, fileName };
}

/**
 * Path to the pre-generated report file for a fuzz run (used so View Report can serve from file without blocking).
 */
function getStableReportPath(fuzzRunId) {
  const id = typeof fuzzRunId === 'string' ? parseInt(fuzzRunId, 10) : fuzzRunId;
  return path.join(reportsDir, `report-fuzz-${id}.html`);
}

module.exports = { generateFuzzReport, getStableReportPath };

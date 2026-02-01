const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { FuzzRun, FuzzResult, ApiSpec, Project } = require('../models');

const reportsDir = process.env.REPORTS_DIR || './reports';
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const reportTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fuzz Report: {{run.name}}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; background: #f9fafb; }
        .report-header { background: #111827; color: white; padding: 24px 32px; display: flex; align-items: center; gap: 16px; }
        .report-header h1 { font-size: 24px; font-weight: 600; margin: 0; }
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
        .results-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
        .results-table th, .results-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .results-table th { background: #f9fafb; font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 600; }
        .results-table tr:hover { background: #f9fafb; }
        .error-cell { max-width: 400px; white-space: pre-wrap; word-break: break-word; font-size: 13px; color: #b91c1c; }
    </style>
</head>
<body>
    <div class="report-header">
        <h1>Fuzz Report: {{run.name}}</h1>
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
        <h2 style="margin-bottom:16px;font-size:20px;">Fuzz Results</h2>
        <table class="results-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Test name</th>
                    <th>Fuzzer</th>
                    <th>Status</th>
                    <th>Duration (ms)</th>
                    <th>Error / message</th>
                </tr>
            </thead>
            <tbody>
                {{#each results}}
                <tr>
                    <td>{{this.execution_order}}</td>
                    <td>{{this.test_name}}</td>
                    <td>{{this.fuzzer_name}}</td>
                    <td><span class="status-badge {{this.status}}">{{this.status}}</span></td>
                    <td>{{this.duration_ms}}</td>
                    <td class="error-cell">{{this.error_message}}</td>
                </tr>
                {{/each}}
            </tbody>
        </table>
        {{#unless results.length}}
        <p style="color:#6b7280;margin-top:16px;">No results recorded.</p>
        {{/unless}}
    </div>
</body>
</html>
`;

/**
 * Generate HTML report for a fuzz run.
 * @param {string|number} fuzzRunId - Fuzz run ID
 * @returns {Promise<{ html, filePath, fileName }>}
 */
async function generateFuzzReport(fuzzRunId) {
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

  const runJson = run.toJSON();
  const results = runJson.fuzzResults || [];
  const durationSec = run.duration_ms != null ? (run.duration_ms / 1000).toFixed(2) : '—';

  const templateData = {
    run: runJson,
    apiSpecName: run.apiSpec ? run.apiSpec.name : '—',
    projectName: run.project ? run.project.name : '—',
    durationSec,
    results
  };

  const template = handlebars.compile(reportTemplate);
  const html = template(templateData);

  const fileName = `report-fuzz-${id}-${Date.now()}.html`;
  const filePath = path.join(reportsDir, fileName);
  fs.writeFileSync(filePath, html);

  return { html, filePath, fileName };
}

module.exports = { generateFuzzReport };

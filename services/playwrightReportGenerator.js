const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { PlaywrightRun, PlaywrightResult } = require('../models');
const { QA_TEST_HUB_LOGO_DATA_URI } = require('./reportBranding');

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
    <title>UI Test Report: {{run.name}}</title>
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
        .metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 16px; }
        .metadata-item { padding: 16px; background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; }
        .metadata-label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; font-weight: 500; }
        .metadata-value { font-size: 16px; font-weight: 600; color: #1f2937; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 24px; margin: 32px 0; }
        .summary-card { padding: 24px; border-radius: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; }
        .summary-card.total .summary-number { color: #14b8a6; }
        .summary-card.passed .summary-number { color: #10b981; }
        .summary-card.failed .summary-number { color: #ef4444; }
        .summary-card.duration .summary-number { color: #f59e0b; }
        .summary-number { font-size: 42px; font-weight: 700; margin-bottom: 8px; }
        .summary-label { font-size: 14px; text-transform: uppercase; color: #6b7280; font-weight: 500; }
        .status-badge { display: inline-flex; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
        .status-badge.passed { background: #10b981; color: white; }
        .status-badge.failed { background: #ef4444; color: white; }
        .status-badge.running { background: #f59e0b; color: white; }
        .test-results { margin-top: 32px; }
        .test-results h2 { color: #1f2937; font-size: 24px; font-weight: 600; margin-bottom: 24px; }
        .test-item { border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
        .test-item-header { padding: 16px 20px; background: white; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .test-item-header:hover { background: #f9fafb; }
        .test-item-name { font-weight: 500; color: #1f2937; font-size: 15px; }
        .test-item-details { padding: 20px; display: none; background: #f9fafb; }
        .test-item-details.active { display: block; }
        .detail-section { margin-bottom: 16px; }
        .detail-label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; font-weight: 500; }
        .detail-value { background: white; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all; border: 1px solid #e5e7eb; }
        .validations-list { list-style: none; padding: 0; margin: 0; }
        .validations-list li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; margin-bottom: 6px; border-radius: 8px; background: white; border: 1px solid #e5e7eb; }
        .validations-list li.passed { border-left: 4px solid #10b981; }
        .validations-list li.failed { border-left: 4px solid #ef4444; }
        .validation-badge { flex-shrink: 0; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .validation-badge.passed { background: #d1fae5; color: #065f46; }
        .validation-badge.failed { background: #fee2e2; color: #991b1b; }
        .validation-desc { flex: 1; font-size: 14px; color: #1f2937; }
        .validation-detail { font-size: 12px; color: #6b7280; margin-top: 4px; }
        .failure-screenshot { max-width: 100%; max-height: 70vh; border: 1px solid #e5e7eb; border-radius: 8px; display: block; }
        .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 13px; }
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
            <h1 class="report-title">UI Test Report: {{run.name}}</h1>
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Base URL</div>
                    <div class="metadata-value" style="word-break:break-all;">{{run.base_url}}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Status</div>
                    <div class="metadata-value"><span class="status-badge {{run.status}}">{{run.status}}</span></div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Date</div>
                    <div class="metadata-value">{{formatDate run.created_at}}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Duration</div>
                    <div class="metadata-value">{{formatDuration run.duration_ms}}</div>
                </div>
            </div>
        </header>
        <div class="summary">
            <div class="summary-card total"><div class="summary-number">{{run.total_tests}}</div><div class="summary-label">Total</div></div>
            <div class="summary-card passed"><div class="summary-number">{{run.passed_tests}}</div><div class="summary-label">Passed</div></div>
            <div class="summary-card failed"><div class="summary-number">{{run.failed_tests}}</div><div class="summary-label">Failed</div></div>
            <div class="summary-card duration"><div class="summary-number">{{formatDuration run.duration_ms}}</div><div class="summary-label">Duration</div></div>
        </div>
        <div class="test-results">
            <h2>Test Results</h2>
            {{#each results}}
            <div class="test-item">
                <div class="test-item-header" data-detail-id="pw_{{@index}}">
                    <div>
                        <span class="test-item-name">{{this.test_name}}</span>
                        {{#if this.endpoint}}<span style="margin-left:10px;font-size:12px;color:#6b7280;">{{this.endpoint}}</span>{{/if}}
                    </div>
                    <span class="status-badge {{this.status}}">{{this.status}}</span>
                </div>
                <div class="test-item-details" id="details_pw_{{@index}}">
                    {{#if this.duration_ms}}
                    <div class="detail-section"><div class="detail-label">Duration</div><div class="detail-value">{{this.duration_ms}} ms</div></div>
                    {{/if}}
                    {{#if this.endpoint}}
                    <div class="detail-section"><div class="detail-label">Page / Endpoint</div><div class="detail-value">{{this.endpoint}}</div></div>
                    {{/if}}
                    {{#if this.error_message}}
                    <div class="detail-section"><div class="detail-label">Error</div><div class="detail-value" style="color:#dc2626;background:#fef2f2;">{{this.error_message}}</div></div>
                    {{/if}}
                    {{#if this.assertions.validations}}
                    <div class="detail-section">
                        <div class="detail-label">Validations</div>
                        <ul class="validations-list">
                            {{#each this.assertions.validations}}
                            <li class="{{#if this.passed}}passed{{else}}failed{{/if}}">
                                <span class="validation-badge {{#if this.passed}}passed{{else}}failed{{/if}}">{{#if this.passed}}Passed{{else}}Failed{{/if}}</span>
                                <div>
                                    <div class="validation-desc">{{this.description}}</div>
                                    {{#if this.detail}}<div class="validation-detail">{{this.detail}}</div>{{/if}}
                                </div>
                            </li>
                            {{/each}}
                        </ul>
                    </div>
                    {{/if}}
                    {{#if this.assertions}}
                    {{#unless this.assertions.validations}}
                    <div class="detail-section"><div class="detail-label">Details</div><div class="detail-value">{{json this.assertions}}</div></div>
                    {{/unless}}
                    {{/if}}
                    {{#if this.screenshotDataUrl}}
                    <div class="detail-section">
                        <div class="detail-label">Screenshot at failure</div>
                        <img src="{{this.screenshotDataUrl}}" alt="Screenshot at failure" class="failure-screenshot" />
                    </div>
                    {{/if}}
                </div>
            </div>
            {{/each}}
        </div>
        <div class="footer">Generated on {{formatDate (now)}} by DEO/EPS -- QA Testing Tool</div>
    </div>
    <script>
        document.querySelectorAll('.test-item-header').forEach(function(el) {
            const id = el.getAttribute('data-detail-id');
            el.addEventListener('click', function() { var d = document.getElementById('details_' + id); if (d) d.classList.toggle('active'); });
        });
    </script>
</body>
</html>
`;

handlebars.registerHelper('formatDate', (date) => (date ? new Date(date).toLocaleString() : 'N/A'));
handlebars.registerHelper('formatDuration', (ms) => {
  if (!ms) return '0ms';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
});
handlebars.registerHelper('now', () => new Date());
handlebars.registerHelper('json', (v) => (typeof v === 'object' ? JSON.stringify(v, null, 2) : v));

async function generatePlaywrightReport(playwrightRunId) {
  const run = await PlaywrightRun.findByPk(playwrightRunId);
  if (!run) throw new Error('Playwright run not found');

  const results = await PlaywrightResult.findAll({
    where: { playwright_run_id: playwrightRunId },
    order: [['execution_order', 'ASC'], ['id', 'ASC']]
  });

  const screenshotsDir = path.join(reportsDir, 'playwright-screenshots');
  const resultsForTemplate = results.map(r => {
    const j = r.toJSON();
    if (j.screenshot_path) {
      const fp = path.join(screenshotsDir, j.screenshot_path);
      if (fs.existsSync(fp)) {
        try {
          j.screenshotDataUrl = 'data:image/png;base64,' + fs.readFileSync(fp).toString('base64');
        } catch (_) { /* leave undefined */ }
      }
    }
    return j;
  });

  const template = handlebars.compile(reportTemplate);
  const html = template({
    run: run.toJSON(),
        results: resultsForTemplate,
        qaTestHubLogoDataUri: QA_TEST_HUB_LOGO_DATA_URI
  });

  const fileName = `playwright-report-${playwrightRunId}-${Date.now()}.html`;
  const filePath = path.join(reportsDir, fileName);
  fs.writeFileSync(filePath, html);

  return { html, filePath, fileName };
}

module.exports = { generatePlaywrightReport };

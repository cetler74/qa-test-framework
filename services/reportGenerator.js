const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { TestRun, TestResult, Project, ApiSpec } = require('../models');

// Ensure reports directory exists
const reportsDir = process.env.REPORTS_DIR || './reports';
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

/**
 * HTML Report Template - Modern UI with Teal Branding
 */
const reportTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report: {{testRun.name}}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background: #f9fafb;
            padding: 0;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        .report-header {
            background: #111827;
            color: white;
            padding: 24px 32px;
            display: flex;
            align-items: center;
            gap: 16px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .report-header img {
            height: 36px;
            width: auto;
        }
        .report-header h1 {
            font-size: 24px;
            font-weight: 600;
            letter-spacing: -0.025em;
            margin: 0;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 32px;
            min-height: calc(100vh - 80px);
        }
        header {
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 24px;
            margin-bottom: 32px;
        }
        .report-title {
            color: #1f2937;
            margin-bottom: 16px;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.025em;
        }
        .metadata {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 24px;
        }
        .metadata-item {
            padding: 16px;
            background: #f9fafb;
            border-radius: 12px;
            border: 1px solid #e5e7eb;
            transition: all 200ms ease-in-out;
        }
        .metadata-item:hover {
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
            transform: translateY(-1px);
        }
        .metadata-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            margin-bottom: 8px;
            font-weight: 500;
            letter-spacing: 0.05em;
        }
        .metadata-value {
            font-size: 16px;
            font-weight: 600;
            color: #1f2937;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 24px;
            margin: 32px 0;
        }
        .summary-card {
            padding: 24px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
            transition: all 200ms ease-in-out;
            position: relative;
            overflow: hidden;
        }
        .summary-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
        }
        .summary-card:hover {
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            transform: translateY(-2px);
        }
        .summary-card.total {
            background: white;
            border: 1px solid #e5e7eb;
        }
        .summary-card.total::before {
            background: linear-gradient(90deg, #14b8a6, #5eead4);
        }
        .summary-card.total .summary-number {
            color: #14b8a6;
        }
        .summary-card.passed {
            background: white;
            border: 1px solid #e5e7eb;
        }
        .summary-card.passed::before {
            background: #10b981;
        }
        .summary-card.passed .summary-number {
            color: #10b981;
        }
        .summary-card.failed {
            background: white;
            border: 1px solid #e5e7eb;
        }
        .summary-card.failed::before {
            background: #ef4444;
        }
        .summary-card.failed .summary-number {
            color: #ef4444;
        }
        .summary-card.duration {
            background: white;
            border: 1px solid #e5e7eb;
        }
        .summary-card.duration::before {
            background: #f59e0b;
        }
        .summary-card.duration .summary-number {
            color: #f59e0b;
        }
        .summary-number {
            font-size: 42px;
            font-weight: 700;
            margin-bottom: 8px;
            line-height: 1;
        }
        .summary-label {
            font-size: 14px;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 500;
            letter-spacing: 0.05em;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .status-badge.passed {
            background: #10b981;
            color: white;
        }
        .status-badge.failed {
            background: #ef4444;
            color: white;
        }
        .status-badge.pending {
            background: #f59e0b;
            color: white;
        }
        .status-badge.running {
            background: #f59e0b;
            color: white;
        }
        .test-results {
            margin-top: 32px;
        }
        .test-results h2 {
            color: #1f2937;
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 24px;
            letter-spacing: -0.025em;
        }
        .test-group {
            margin-bottom: 32px;
        }
        .test-group-header {
            background: #f3f4f6;
            padding: 16px 20px;
            border-left: 4px solid #14b8a6;
            margin-bottom: 16px;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .test-group-header h3 {
            color: #1f2937;
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }
        .test-group-header span {
            color: #6b7280;
            font-size: 14px;
        }
        .test-item {
            border: none;
            border-radius: 12px;
            margin-bottom: 16px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
            transition: all 200ms ease-in-out;
        }
        .test-item:hover {
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            transform: translateY(-1px);
        }
        .test-item-header {
            padding: 16px 20px;
            background: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            border-bottom: 1px solid #e5e7eb;
        }
        .test-item-header:hover {
            background: #f9fafb;
        }
        .test-item-name {
            font-weight: 500;
            color: #1f2937;
            font-size: 15px;
        }
        .test-item-details {
            padding: 20px;
            display: none;
            background: #f9fafb;
        }
        .test-item-details.active {
            display: block;
        }
        .detail-section {
            margin-bottom: 20px;
        }
        .detail-section:last-child {
            margin-bottom: 0;
        }
        .detail-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            margin-bottom: 8px;
            font-weight: 500;
            letter-spacing: 0.05em;
        }
        .detail-value {
            background: white;
            padding: 12px;
            border-radius: 8px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #e5e7eb;
            color: #1f2937;
        }
        .detail-value pre {
            margin: 0;
            font-family: inherit;
        }
        .method-badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .method-badge.GET {
            background: #10b981;
            color: white;
        }
        .method-badge.POST {
            background: #3b82f6;
            color: white;
        }
        .method-badge.PUT {
            background: #f59e0b;
            color: white;
        }
        .method-badge.DELETE {
            background: #ef4444;
            color: white;
        }
        .method-badge.PATCH {
            background: #8b5cf6;
            color: white;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            background: #14b8a6;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: all 200ms ease-in-out;
        }
        .btn:hover {
            background: #0d9488;
            transform: translateY(-1px);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .footer {
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 13px;
        }
        .footer img {
            height: 20px;
            vertical-align: middle;
            margin-right: 8px;
        }
        .assertion-item {
            margin-bottom: 12px;
            padding: 12px;
            border-left: 3px solid;
            border-radius: 6px;
            background: white;
        }
        .assertion-item.passed {
            border-left-color: #10b981;
            background: #ecfdf5;
        }
        .assertion-item.failed {
            border-left-color: #ef4444;
            background: #fef2f2;
        }
        .assertion-item strong {
            color: #1f2937;
        }
        .assertion-error {
            margin-top: 6px;
            color: #dc2626;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="report-header">
        <img src="https://conteudos.meo.pt/Style%20Library/quantcast/logo-meo.png?qc-size=98,56" alt="MEO logo">
        <h1>DEO/EPS -- QA Testing Tool</h1>
    </div>
    <div class="container">
        <header>
            <h1 class="report-title">Test Report: {{testRun.name}}</h1>
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Project</div>
                    <div class="metadata-value">{{project.name}}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Status</div>
                    <div class="metadata-value">
                        <span class="status-badge {{testRun.status}}">{{testRun.status}}</span>
                    </div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Date</div>
                    <div class="metadata-value">{{formatDate testRun.created_at}}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Duration</div>
                    <div class="metadata-value">{{formatDuration testRun.duration_ms}}ms</div>
                </div>
            </div>
        </header>

        <div class="summary">
            <div class="summary-card total">
                <div class="summary-number">{{testRun.total_tests}}</div>
                <div class="summary-label">Total Tests</div>
            </div>
            <div class="summary-card passed">
                <div class="summary-number">{{testRun.passed_tests}}</div>
                <div class="summary-label">Passed</div>
            </div>
            <div class="summary-card failed">
                <div class="summary-number">{{testRun.failed_tests}}</div>
                <div class="summary-label">Failed</div>
            </div>
            <div class="summary-card duration">
                <div class="summary-number">{{formatDuration testRun.duration_ms}}</div>
                <div class="summary-label">Duration</div>
            </div>
        </div>

        <div class="test-results">
            <h2>Test Results</h2>
            {{#each testResultsBySpec}}
            <div class="test-group">
                <div class="test-group-header">
                    <h3>{{@key}}</h3>
                    <span>{{this.length}} test(s)</span>
                </div>
                {{#each this}}
                <div class="test-item">
                    <div class="test-item-header" data-detail-id="{{this.groupIndex}}_{{this.itemIndex}}">
                        <div>
                            <span class="method-badge {{this.method}}">{{this.method}}</span>
                            <span class="test-item-name">{{this.test_name}}</span>
                        </div>
                        <span class="status-badge {{this.status}}">{{this.status}}</span>
                    </div>
                    <div class="test-item-details" id="details_{{this.groupIndex}}_{{this.itemIndex}}">
                        <div class="detail-section">
                            <div class="detail-label">Request</div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <small style="color:#666;">Request evidence</small>
                                <a href="{{this.request_download}}" download="{{this.test_name}}-request.txt" class="btn" style="font-size:12px;">Download</a>
                            </div>
                            <div class="detail-value">{{#if this.request_body_pretty}}{{this.request_body_pretty}}{{else}}Method: {{this.method}}\nURL: {{this.endpoint}}{{/if}}</div>
                            {{#if this.request_headers}}
                            <div style="margin-top:8px; font-size:12px; color:#666;">Headers:</div>
                            <div class="detail-value" style="margin-top:6px;">{{this.request_headers}}</div>
                            {{/if}}
                        </div>

                        <div class="detail-section">
                            <div class="detail-label">Response ({{#if this.response_code}}{{this.response_code}}{{else}}-{{/if}})</div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <small style="color:#6b7280; font-size:12px;">Response evidence</small>
                                <a href="{{this.response_download}}" download="{{this.test_name}}-response.txt" class="btn">Download</a>
                            </div>
                            <div class="detail-value">{{#if this.response_is_json}}<pre>{{this.response_body_pretty}}</pre>{{else}}{{this.response_body_pretty}}{{/if}}</div>
                        </div>
                        {{#if this.error_message}}
                        <div class="detail-section">
                            <div class="detail-label">Error</div>
                            <div class="detail-value" style="color: #dc2626; background: #fef2f2; border-color: #fecaca;">{{this.error_message}}</div>
                        </div>
                        {{/if}}
                        {{#if this.assertions}}
                        <div class="detail-section">
                            <div class="detail-label">Test Script Assertions</div>
                            <div>
                                {{#each this.assertions}}
                                <div class="assertion-item {{#if this.error}}failed{{else}}passed{{/if}}">
                                    <strong>{{#if this.error}}❌ Failed{{else}}✅ Passed{{/if}}:</strong> 
                                    {{#if this.assertion}}{{this.assertion}}{{else}}{{#if this.error}}Assertion failed{{else}}Assertion passed{{/if}}{{/if}}
                                    {{#if this.error}}
                                    <div class="assertion-error">
                                        {{#if this.error.message}}{{this.error.message}}{{else}}{{this.error}}{{/if}}
                                    </div>
                                    {{/if}}
                                </div>
                                {{/each}}
                            </div>
                        </div>
                        {{/if}}
                    </div>
                </div>
                {{/each}}
            </div>
            {{/each}}
        </div>

        <div class="footer">
            <p><img src="https://conteudos.meo.pt/Style%20Library/quantcast/logo-meo.png?qc-size=98,56" alt="MEO logo"> Generated on {{formatDate (now)}} by DEO/EPS -- QA Testing Tool</p>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.test-item-header').forEach(function(el) {
                const id = el.getAttribute('data-detail-id');
                if (!id) return;
                el.addEventListener('click', function() {
                    const details = document.getElementById('details_' + id);
                    if (details) details.classList.toggle('active');
                });
            });
        });
    </script>
</body>
</html>
`;

// Register Handlebars helpers
handlebars.registerHelper('formatDate', (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString();
});

handlebars.registerHelper('formatDuration', (ms) => {
  if (!ms) return '0';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
});

handlebars.registerHelper('now', () => {
  return new Date();
});

/**
 * Generate HTML report for a test run
 * @param {number} testRunId - Test run ID
 * @returns {Promise<string>} HTML report content
 */
async function generateReport(testRunId) {
  try {
    // Fetch test run with related data
    const testRun = await TestRun.findByPk(testRunId, {
      include: [
        {
          model: Project,
          as: 'project',
          attributes: ['id', 'name', 'description']
        }
      ]
    });

    if (!testRun) {
      throw new Error('Test run not found');
    }

    // Fetch test results
    const testResults = await TestResult.findAll({
      where: { test_run_id: testRunId },
      include: [
        {
          model: ApiSpec,
          as: 'apiSpec',
          attributes: ['id', 'name'],
          required: false
        }
      ],
      order: [['api_spec_id', 'ASC'], ['test_name', 'ASC']]
    });

    // Group test results by API spec
    const testResultsBySpec = {};
    testResults.forEach((result) => {
      const specName = result.apiSpec?.name || 'Unknown API Spec';
      if (!testResultsBySpec[specName]) {
        testResultsBySpec[specName] = [];
      }
      testResultsBySpec[specName].push(result.toJSON());
    });
    
    // Add index to each group for template
    Object.keys(testResultsBySpec).forEach((specName, specIndex) => {
      testResultsBySpec[specName].forEach((result, resultIndex) => {
        result.groupIndex = specIndex;
        result.itemIndex = resultIndex;

        // Prepare download Data URIs and pretty-printing for request/response
        const reqRaw = result.request_body || '';
        const respRaw = result.response_body || '';

        try {
          // Attempt to extract and pretty-print request body if it's JSON
          let reqBody = '';
          const bodyMarker = '\nBody:\n';
          const bodyPos = reqRaw.indexOf(bodyMarker);
          if (bodyPos >= 0) {
            reqBody = reqRaw.substring(bodyPos + bodyMarker.length).trim();
            try {
              const parsedReq = JSON.parse(reqBody);
              result.request_body_pretty = JSON.stringify(parsedReq, null, 2);
            } catch (e) {
              // Not JSON - leave as-is
              result.request_body_pretty = reqBody || null;
            }
            // Extract headers if present
            const headersMarker = '\nHeaders:\n';
            const headersPos = reqRaw.indexOf(headersMarker);
            if (headersPos >= 0 && bodyPos > headersPos) {
              result.request_headers = reqRaw.substring(headersPos + headersMarker.length, bodyPos).trim() || null;
            }
          } else {
            // Fallback: store full request text
            result.request_body_pretty = reqRaw || null;
          }
        } catch (e) {
          result.request_body_pretty = reqRaw || null;
        }

        try {
          // Try to detect JSON response and pretty-print
          let respTrim = typeof respRaw === 'string' ? respRaw.trim() : '';
          if ((respTrim.startsWith('{') || respTrim.startsWith('['))) {
            try {
              result.response_body_pretty = JSON.stringify(JSON.parse(respTrim), null, 2);
              result.response_is_json = true;
            } catch (e) {
              result.response_body_pretty = respRaw || null;
              result.response_is_json = false;
            }
          } else {
            result.response_body_pretty = respRaw || null;
            result.response_is_json = false;
          }
        } catch (e) {
          result.response_body_pretty = respRaw || null;
          result.response_is_json = false;
        }

        // Create download links (data URIs)
        result.request_download = 'data:text/plain;charset=utf-8,' + encodeURIComponent(reqRaw || '');
        result.response_download = 'data:text/plain;charset=utf-8,' + encodeURIComponent(respRaw || '');
      });
    });

    // Prepare data for template
    const templateData = {
      testRun: testRun.toJSON(),
      project: testRun.project.toJSON(),
      testResultsBySpec: testResultsBySpec
    };

    // Compile and render template
    const template = handlebars.compile(reportTemplate);
    const html = template(templateData);

    // Save report to file
    const fileName = `report-${testRunId}-${Date.now()}.html`;
    const filePath = path.join(reportsDir, fileName);
    fs.writeFileSync(filePath, html);

    return {
      html,
      filePath,
      fileName
    };
  } catch (error) {
    throw new Error(`Failed to generate report: ${error.message}`);
  }
}

module.exports = {
  generateReport
};


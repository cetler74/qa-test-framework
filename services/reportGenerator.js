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
 * HTML Report Template
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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        header {
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .metadata {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .metadata-item {
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
        }
        .metadata-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .metadata-value {
            font-size: 16px;
            font-weight: 600;
            color: #2c3e50;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 30px 0;
        }
        .summary-card {
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card.total {
            background: #e3f2fd;
            color: #1976d2;
        }
        .summary-card.passed {
            background: #e8f5e9;
            color: #388e3c;
        }
        .summary-card.failed {
            background: #ffebee;
            color: #d32f2f;
        }
        .summary-card.duration {
            background: #fff3e0;
            color: #f57c00;
        }
        .summary-number {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .summary-label {
            font-size: 14px;
            text-transform: uppercase;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .status-badge.passed {
            background: #4caf50;
            color: white;
        }
        .status-badge.failed {
            background: #f44336;
            color: white;
        }
        .status-badge.pending {
            background: #ff9800;
            color: white;
        }
        .test-results {
            margin-top: 30px;
        }
        .test-group {
            margin-bottom: 30px;
        }
        .test-group-header {
            background: #f8f9fa;
            padding: 15px;
            border-left: 4px solid #1976d2;
            margin-bottom: 15px;
            border-radius: 4px;
        }
        .test-item {
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            margin-bottom: 15px;
            overflow: hidden;
        }
        .test-item-header {
            padding: 15px;
            background: #f8f9fa;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        .test-item-header:hover {
            background: #e9ecef;
        }
        .test-item-name {
            font-weight: 600;
            color: #2c3e50;
        }
        .test-item-details {
            padding: 15px;
            display: none;
            border-top: 1px solid #e0e0e0;
        }
        .test-item-details.active {
            display: block;
        }
        .detail-section {
            margin-bottom: 15px;
        }
        .detail-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .detail-value {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 300px;
            overflow-y: auto;
        }
        .method-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 8px;
        }
        .method-badge.GET {
            background: #4caf50;
            color: white;
        }
        .method-badge.POST {
            background: #2196f3;
            color: white;
        }
        .method-badge.PUT {
            background: #ff9800;
            color: white;
        }
        .method-badge.DELETE {
            background: #f44336;
            color: white;
        }
        .method-badge.PATCH {
            background: #9c27b0;
            color: white;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            color: #666;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Test Report: {{testRun.name}}</h1>
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
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <small style="color:#666;">Response evidence</small>
                                <a href="{{this.response_download}}" download="{{this.test_name}}-response.txt" class="btn" style="font-size:12px;">Download</a>
                            </div>
                            <div class="detail-value">{{#if this.response_is_json}}<pre>{{this.response_body_pretty}}</pre>{{else}}{{this.response_body_pretty}}{{/if}}</div>
                        </div>
                        {{#if this.error_message}}
                        <div class="detail-section">
                            <div class="detail-label">Error</div>
                            <div class="detail-value" style="color: #d32f2f;">{{this.error_message}}</div>
                        </div>
                        {{/if}}
                        {{#if this.assertions}}
                        <div class="detail-section">
                            <div class="detail-label">Test Script Assertions</div>
                            <div class="detail-value">
                                {{#each this.assertions}}
                                <div style="margin-bottom: 8px; padding: 8px; border-left: 3px solid {{#if this.error}}#f44336{{else}}#4caf50{{/if}}; background: {{#if this.error}}#ffebee{{else}}#e8f5e9{{/if}};">
                                    <strong>{{#if this.error}}❌ Failed{{else}}✅ Passed{{/if}}:</strong> 
                                    {{#if this.assertion}}{{this.assertion}}{{else}}{{#if this.error}}Assertion failed{{else}}Assertion passed{{/if}}{{/if}}
                                    {{#if this.error}}
                                    <div style="margin-top: 4px; color: #d32f2f; font-size: 12px;">
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
            <p><img src="https://conteudos.meo.pt/Style%20Library/quantcast/logo-meo.png?qc-size=98,56" alt="MEO logo" style="height:20px; vertical-align:middle; margin-right:8px;"> Generated on {{formatDate (now)}} by DEO/EPS -- QA Testing Tool</p>
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


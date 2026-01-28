const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest } = require('../models');
const playwrightConfig = require('../config/playwright');
const uiTestsConfig = require('../e2e/ui-tests.config');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

/** Build the full list of test ids and names (for UI and runOnly filtering). */
function getPlaywrightTestList() {
  const sections = uiTestsConfig.apiSections || [];
  const filterValidations = uiTestsConfig.filterValidations || [];
  const list = [
    { id: 'consent', name: 'Accept consent (CONCORDO)' },
    { id: 'page-load', name: 'Page load' },
    // Removed by request:
    // - key-elements
    // - basic-nav
    // - filter-panel
  ];
  filterValidations.forEach((fv, i) => {
    list.push({ id: `filter-${i}`, name: `Filter: ${fv.categoryName} shows only expected sections` });
  });
  sections.forEach((s, i) => {
    list.push({ id: `api-section-${i}`, name: `API section: ${s.name}` });
  });
  return list;
}

/**
 * Combined list: built-in tests + recorded tests from DB.
 * Recorded entries have id like "recorded-<numericId>".
 * @returns {Promise<Array<{ id: string, name: string, base_url?: string }>>}
 */
async function getPlaywrightTestListWithRecorded() {
  const builtIn = getPlaywrightTestList();
  let recorded = [];
  try {
    const rows = await PlaywrightRecordedTest.findAll({
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'base_url']
    });
    recorded = rows.map(r => ({
      id: `recorded-${r.id}`,
      name: `Recorded: ${r.name}`,
      base_url: r.base_url || undefined
    }));
  } catch (err) {
    console.error('[playwrightRunner] Failed to load recorded tests:', err.message);
  }
  return [...builtIn, ...recorded];
}

/**
 * Run UI tests (page load, key elements visible, basic navigation) and persist results.
 * @param {Object} options
 * @param {number} options.playwrightRunId - DB id of the PlaywrightRun row to update
 * @param {string} [options.baseUrl] - Base URL to test (default from config)
 * @param {boolean} [options.headless] - Run browser headless (default from config)
 * @param {number} [options.timeoutMs] - Default timeout per action (default from config)
 * @param {string[]} [options.runOnly] - If set, only run these test ids (same order as getPlaywrightTestList).
 * @returns {Promise<{ summary: { total, passed, failed }, results: Array }>}
 */
async function runPlaywrightTests(options = {}) {
  const runId = options.playwrightRunId;
  const baseUrl = (options.baseUrl || playwrightConfig.baseUrl).replace(/\/$/, '');
  const headless = options.headless !== undefined ? options.headless : playwrightConfig.headless;
  const timeoutMs = options.timeoutMs || playwrightConfig.timeoutMs;
  const runOnly = options.runOnly && Array.isArray(options.runOnly) ? options.runOnly : null;
  const recordedIds = runOnly ? runOnly.filter(id => String(id).startsWith('recorded-')).map(id => String(id).replace('recorded-', '')) : [];
  const builtInRunOnly = runOnly ? runOnly.filter(id => !String(id).startsWith('recorded-')) : null;
  const shouldRun = (id) => !builtInRunOnly || builtInRunOnly.includes(id);

  const results = [];
  const startTime = Date.now();
  let total = 0;
  let passed = 0;
  let failed = 0;
  let order = 0;

  const record = async (orderNum, testName, status, durationMs, endpoint, errorMessage, assertions) => {
    results.push({ test_name: testName, status, duration_ms: durationMs, endpoint, error_message: errorMessage, assertions, execution_order: orderNum });
    await recordResult(runId, orderNum, testName, status, durationMs, endpoint, errorMessage, assertions);
    total++;
    if (status === 'passed') passed++; else failed++;
  };

  const hasBuiltInToRun = builtInRunOnly === null || builtInRunOnly.length > 0;
  let browser;
  let page;

  if (hasBuiltInToRun) {
    try {
      browser = await chromium.launch({ headless });
    } catch (err) {
      await record(++order, 'Browser launch', 'failed', 0, baseUrl, err.message, null);
      await updateRunSummary(runId, 1, 0, 1, Date.now() - startTime, 'failed');
      return { summary: { total: 1, passed: 0, failed: 1 }, results };
    }
    const context = await browser.newContext({ baseURL: baseUrl });
    context.setDefaultTimeout(timeoutMs);
    page = await context.newPage();
  }

  if (hasBuiltInToRun) {
    // Load page once so consent popup can appear
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});

  // 1. Accept consent – wait for popup to show, then click "CONCORDO"
  if (shouldRun('consent')) {
  try {
    const t0 = Date.now();
    const popupWaitMs = 8000;
    const btn = page.locator('button, a, [role="button"]').filter({ hasText: /CONCORDO/i }).first();
    await btn.waitFor({ state: 'visible', timeout: popupWaitMs }).catch(() => null);
    const visible = await btn.isVisible().catch(() => false);
    if (visible) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 500));
      await record(++order, 'Accept consent (CONCORDO)', 'passed', Date.now() - t0, page.url(), null, null);
    } else {
      await record(++order, 'Accept consent (CONCORDO)', 'failed', Date.now() - t0, page.url(), 'CONCORDO button not found in consent popup', { message: 'Consent button not present' });
    }
  } catch (err) {
    await record(++order, 'Accept consent (CONCORDO)', 'failed', 0, page.url(), err.message || String(err), null);
  }
  }

  // 2. Page load
  if (shouldRun('page-load')) {
  try {
    const t0 = Date.now();
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const duration = Date.now() - t0;
    const ok = response && response.ok();
    await record(++order, 'Page load', ok ? 'passed' : 'failed', duration, baseUrl, ok ? null : `HTTP ${response?.status()}`, { status: response?.status(), ok: !!ok });
  } catch (err) {
    await record(++order, 'Page load', 'failed', 0, baseUrl, err.message || String(err), null);
  }
  }

  const apisPath = '/apis';
  const sectionBaseUrl = baseUrl.replace(/\/?$/, '') + (baseUrl.includes(apisPath) ? '' : apisPath);

  // Filter validations: select category and verify only expected sections are shown
  const filterValidations = uiTestsConfig.filterValidations || [];
  for (let fi = 0; fi < filterValidations.length; fi++) {
    if (!shouldRun(`filter-${fi}`)) continue;
    const fv = filterValidations[fi];
    const testName = `Filter: ${fv.categoryName} shows only expected sections`;
    const t0 = Date.now();
    try {
      await page.goto(sectionBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
      // Clear filters first
      const clearAll = page.locator('a, button').filter({ hasText: /Limpar tudo/i }).first();
      if (await clearAll.isVisible().catch(() => false)) {
        await clearAll.click({ timeout: 3000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
      }
      // Find and check the category checkbox (e.g. "Device Location")
      const categoryRe = new RegExp(fv.categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const checkbox = page.getByRole('checkbox', { name: categoryRe }).first();
      const labelOrDiv = page.locator('label, [role="checkbox"], .checkbox, li').filter({ hasText: categoryRe }).first();
      let checked = false;
      if (await checkbox.count() > 0 && await checkbox.isVisible().catch(() => false)) {
        await checkbox.check({ timeout: 5000 }).catch(() => {});
        checked = true;
      } else if (await labelOrDiv.count() > 0 && await labelOrDiv.isVisible().catch(() => false)) {
        await labelOrDiv.click({ timeout: 5000 }).catch(() => {});
        checked = true;
      }
      if (!checked) {
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Filter option "${fv.categoryName}" not found or not clickable`, null);
        continue;
      }
      await new Promise(r => setTimeout(r, 1500));
      const mainText = await page.locator('main, [role="main"], .content, #content, body').first().innerText().catch(() => '');
      const expectedSections = fv.expectedSections || [];
      const errors = [];
      for (const sec of expectedSections) {
        if (!mainText.includes(sec.title)) errors.push(`Section "${sec.title}" not found`);
        else if (sec.descriptionContains && !mainText.includes(sec.descriptionContains)) errors.push(`Section "${sec.title}" missing description: "${sec.descriptionContains}"`);
        if (sec.envLabels) {
          for (const env of sec.envLabels) {
            if (!mainText.includes(env)) errors.push(`Section "${sec.title}" missing environment: ${env}`);
          }
        }
      }
      const duration = Date.now() - t0;
      if (errors.length > 0) {
        await record(++order, testName, 'failed', duration, page.url(), errors.join('; '), { expectedSections: fv.expectedSections, errors });
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { category: fv.categoryName, sections: expectedSections.map(s => s.title) });
      }
    } catch (err) {
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), null);
    }
  }

  // 7. API sections: scrape page for section boxes/cards (no login) and validate Documentação, Especificação, Utilização tabs
  const sections = uiTestsConfig.apiSections || [];
  const requiredTabs = uiTestsConfig.requiredTabs || ['Documentação', 'Especificação', 'Utilização'];
  const minContentLength = 20;

  for (const section of sections) {
    const testName = `API section: ${section.name}`;
    const t0 = Date.now();
    try {
      await page.goto(sectionBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));

      const linkText = section.linkText || section.name;
      const linkRe = new RegExp(linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      // Scrape: find a box/card or link that contains the section text (any tag: card, div, article, a)
      const withText = page.locator('a, [role="link"], div, article, section, li').filter({ hasText: linkRe });
      const n = await withText.count();
      let clicked = false;
      for (let i = 0; i < n && !clicked; i++) {
        const el = withText.nth(i);
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await new Promise(r => setTimeout(r, 200));
        const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
        const isLink = tag === 'a' || (await el.getAttribute('role')) === 'link';
        if (isLink) {
          await el.click({ timeout: 6000 }).catch(() => {});
          clicked = true;
          break;
        }
        const childLink = el.locator('a').first();
        if (await childLink.count() > 0) {
          await childLink.click({ timeout: 6000 }).catch(() => {});
          clicked = true;
          break;
        }
        const parentLink = el.locator('xpath=ancestor::a[1]').first();
        if (await parentLink.count() > 0) {
          await parentLink.click({ timeout: 6000 }).catch(() => {});
          clicked = true;
          break;
        }
        // Box/card with no link: try clicking the element itself (e.g. clickable div)
        await el.click({ timeout: 5000 }).catch(() => {});
        clicked = true;
        break;
      }
      if (!clicked) {
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Section box/link not found: ${linkText}`, null);
        continue;
      }
      await new Promise(r => setTimeout(r, 1000));

      const excludedEndpoints = (uiTestsConfig.excludedEndpoints || []).map(u => u.replace(/\/$/, ''));
      const isExcludedUrl = (url) => excludedEndpoints.some(ex => url === ex || url.startsWith(ex + '/'));

      if (isExcludedUrl(page.url())) {
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), 'Invalid endpoint (removed from tests): ' + page.url(), { excluded: true });
        continue;
      }

      const envBtn = section.envButton || 'Sandbox';
      const envLink = page.getByRole('link', { name: new RegExp(envBtn, 'i') }).first();
      if (await envLink.count() > 0) {
        const href = await envLink.getAttribute('href').catch(() => '');
        const resolvedHref = href ? new URL(href, sectionBaseUrl).href : '';
        if (!resolvedHref || !excludedEndpoints.some(ex => resolvedHref.startsWith(ex.replace(/\/$/, '')))) {
          await envLink.click({ timeout: 5000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const currentUrl = page.url();
      if (isExcludedUrl(currentUrl)) {
        await record(++order, testName, 'failed', Date.now() - t0, currentUrl, 'Invalid endpoint (removed from tests): ' + currentUrl, { excluded: true });
        continue;
      }

      const tabErrors = [];
      const escapedTab = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const tabName of requiredTabs) {
        const tabRe = new RegExp(escapedTab(tabName), 'i');
        const tab = page.getByRole('tab', { name: tabRe }).first();
        const tabAsButton = page.getByRole('button', { name: tabRe }).first();
        const tabAsLink = page.locator('a, button, [role="tab"]').filter({ hasText: tabRe }).first();

        let tabEl = null;
        if (await tab.count() > 0) tabEl = tab;
        else if (await tabAsButton.count() > 0) tabEl = tabAsButton;
        else if (await tabAsLink.count() > 0) tabEl = tabAsLink;

        if (!tabEl) {
          tabErrors.push(`Tab "${tabName}" not found`);
          continue;
        }
        await tabEl.click({ timeout: 3000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 400));

        const contentSelectors = '[role="tabpanel"], .tab-content, .tabpanel, [class*="tab-panel"], [class*="TabPanel"], main, [class*="content"]';
        const content = await page.locator(contentSelectors).first().innerText().catch(() => '');
        const hasContent = content && content.trim().length >= minContentLength;
        if (!hasContent) {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          if (!bodyText || bodyText.trim().length < minContentLength) tabErrors.push(`Tab "${tabName}" has no substantial content`);
        }
      }

      const duration = Date.now() - t0;
      if (tabErrors.length > 0) {
        await record(++order, testName, 'failed', duration, page.url(), tabErrors.join('; '), { requiredTabs, tabErrors });
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { requiredTabs });
      }
    } catch (err) {
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), null);
    }
  }

  }

  if (browser) await browser.close();

  for (const recId of recordedIds) {
    try {
      await runRecordedSpec(runId, recId, baseUrl, async (testName, status, durationMs, errorMessage, assertions) => {
        await record(++order, testName, status, durationMs, null, errorMessage || null, assertions || null);
      });
    } catch (err) {
      await record(++order, `Recorded test ${recId}`, 'failed', 0, null, err.message || String(err), null);
    }
  }

  const durationMs = Date.now() - startTime;
  const status = failed > 0 ? 'failed' : 'passed';
  await updateRunSummary(runId, total, passed, failed, durationMs, status);

  return { summary: { total, passed, failed }, results };
}

/**
 * Run a single recorded spec (from DB) via Playwright Test CLI and report results.
 * @param {number} runId - PlaywrightRun id
 * @param {string} recordedId - PlaywrightRecordedTest id (numeric string)
 * @param {string} baseUrl - Base URL for the run
 * @param {function(string, string, number, string?, any?): Promise<void>} addRecord - (testName, status, durationMs, errorMessage, assertions) => record one result
 */
async function runRecordedSpec(runId, recordedId, baseUrl, addRecord) {
  const test = await PlaywrightRecordedTest.findByPk(recordedId);
  if (!test) throw new Error(`Recorded test ${recordedId} not found`);
  const baseUrlToUse = baseUrl || test.base_url || playwrightConfig.baseUrl || 'https://example.com';
  const headless = playwrightConfig.headless !== undefined ? playwrightConfig.headless : true;
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const slug = `recorded-${recordedId}-${Date.now()}`;
  const specPath = path.join(REPORTS_DIR, `${slug}.spec.js`);
  const configPath = path.join(REPORTS_DIR, `${slug}.config.cjs`);
  const resultPath = path.join(REPORTS_DIR, `${slug}-result.json`);
  try {
    fs.writeFileSync(specPath, test.spec_content, 'utf8');
    const specFileName = path.basename(specPath);
    const configContent = `
module.exports = {
  testDir: ${JSON.stringify(REPORTS_DIR)},
  testMatch: ${JSON.stringify([specFileName])},
  use: {
    baseURL: ${JSON.stringify(baseUrlToUse)},
    trace: 'off',
    // Playwright Test: ensure headed/headless is respected
    launchOptions: { headless: ${headless} }
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  timeout: ${playwrightConfig.timeoutMs || 30000},
  reporter: [['json', { outputFile: ${JSON.stringify(resultPath)} }]]
};
`;
    fs.writeFileSync(configPath, configContent.trim(), 'utf8');
    const cwd = path.join(__dirname, '..');
    const isWin = process.platform === 'win32';
    const playwrightBin = path.join(cwd, 'node_modules', '.bin', 'playwright' + (isWin ? '.cmd' : ''));
    const args = ['test', '--config', configPath];
    if (!headless) args.push('--headed');
    const command = fs.existsSync(playwrightBin) ? playwrightBin : (isWin ? 'npx.cmd' : 'npx');
    const finalArgs = fs.existsSync(playwrightBin) ? args : ['playwright', 'test', '--config', configPath];
    if (!headless && !fs.existsSync(playwrightBin)) finalArgs.push('--headed');
    const result = spawnSync(command, finalArgs, {
      cwd,
      encoding: 'utf8',
      timeout: (playwrightConfig.timeoutMs || 30000) * 2 + 10000,
      maxBuffer: 4 * 1024 * 1024,
      shell: isWin
    });
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const combinedOutput = [stderr, stdout, result.error ? String(result.error.message || result.error) : '']
      .filter(Boolean)
      .join('\n')
      .trim();

    let report = [];
    if (fs.existsSync(resultPath)) {
      try {
        const raw = fs.readFileSync(resultPath, 'utf8');
        const trimmed = raw.trim();
        // Prefer parsing Playwright JSON report format (object with suites/specs/tests).
        if (trimmed.startsWith('{')) {
          try {
            const obj = JSON.parse(trimmed);
            if (obj && Array.isArray(obj.suites)) {
              report = flattenPlaywrightJsonReport(obj);
            }
          } catch (_) { /* ignore */ }
        }
        // Fallback: newline-delimited JSON objects/events.
        if (report.length === 0 && trimmed) {
          const lines = raw.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event && (event.testId || event.title || event.data?.title)) {
                report.push(event);
              }
            } catch (_) { /* skip malformed line */ }
          }
        }
      } catch (_) { /* ignore */ }
    }
    if (report.length > 0) {
      for (const e of report) {
        const rawTitle = e.title || e.data?.title || test.name;
        const title = `Recorded: ${test.name}${rawTitle && rawTitle !== test.name ? ` › ${rawTitle}` : ''}`;
        const rawStatus = String(e.status || e.data?.status || (result.status === 0 ? 'passed' : 'failed')).toLowerCase();
        const status = rawStatus === 'passed' ? 'passed' : 'failed';
        const durationMs = e.durationMs ?? e.data?.durationMs ?? 0;
        const errorFromReport = e.error?.message || e.data?.error?.message || null;
        const errorMessage = (status !== 'passed' && !errorFromReport && combinedOutput)
          ? (combinedOutput.length > 2000 ? combinedOutput.slice(0, 2000) + '...' : combinedOutput)
          : errorFromReport;
        const finalError = (status !== 'passed' && errorMessage && rawStatus !== 'failed')
          ? `[${rawStatus}] ${errorMessage}`
          : errorMessage;
        await addRecord(title, status, durationMs, finalError, {
          source: 'recorded',
          recorded_test_id: String(recordedId),
          recorded_test_name: test.name,
          raw_status: rawStatus,
          raw_title: rawTitle,
          duration_ms: durationMs,
          report_entry: e
        });
      }
    } else {
      const status = result.status === 0 ? 'passed' : 'failed';
      const errorMessage = combinedOutput
        ? (combinedOutput.length > 2000 ? combinedOutput.slice(0, 2000) + '...' : combinedOutput)
        : (result.status !== 0 ? 'Playwright test run failed (no output captured)' : null);
      await addRecord(`Recorded: ${test.name}`, status, 0, errorMessage, {
        source: 'recorded',
        recorded_test_id: String(recordedId),
        recorded_test_name: test.name,
        raw_status: result.status === 0 ? 'passed' : 'failed',
        output: combinedOutput || null
      });
    }
  } finally {
    try { if (fs.existsSync(specPath)) fs.unlinkSync(specPath); } catch (_) {}
    try { if (fs.existsSync(configPath)) fs.unlinkSync(configPath); } catch (_) {}
    try { if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath); } catch (_) {}
  }
}

function flattenPlaywrightJsonReport(report) {
  const out = [];
  const walkSuite = (suite) => {
    if (!suite) return;
    if (Array.isArray(suite.suites)) suite.suites.forEach(walkSuite);
    if (Array.isArray(suite.specs)) {
      suite.specs.forEach(spec => {
        const specTitle = spec.title || 'Recorded test';
        if (Array.isArray(spec.tests)) {
          spec.tests.forEach(t => {
            const testTitle = [specTitle, t.title].filter(Boolean).join(' › ');
            const lastResult = Array.isArray(t.results) && t.results.length ? t.results[t.results.length - 1] : null;
            const status = (lastResult && lastResult.status) ? String(lastResult.status).toLowerCase() : (t.ok ? 'passed' : 'failed');
            const durationMs = lastResult && typeof lastResult.duration === 'number' ? lastResult.duration : 0;
            const errorMessage = lastResult && lastResult.error ? (lastResult.error.message || JSON.stringify(lastResult.error)) : null;
            out.push({ title: testTitle, status, durationMs, error: errorMessage ? { message: errorMessage } : null });
          });
        } else {
          out.push({ title: specTitle, status: spec.ok ? 'passed' : 'failed' });
        }
      });
    }
  };
  if (Array.isArray(report.suites)) report.suites.forEach(walkSuite);
  return out;
}

async function recordResult(runId, order, testName, status, durationMs, endpoint, errorMessage, assertions) {
  await PlaywrightResult.create({
    playwright_run_id: runId,
    test_name: testName,
    status,
    duration_ms: durationMs || null,
    endpoint: endpoint || null,
    error_message: errorMessage || null,
    assertions: assertions || null,
    execution_order: order
  });
}

async function updateRunSummary(runId, totalTests, passedTests, failedTests, durationMs, status) {
  await PlaywrightRun.update(
    { total_tests: totalTests, passed_tests: passedTests, failed_tests: failedTests, duration_ms: durationMs, status },
    { where: { id: runId } }
  );
}

const isCli = process.argv.includes('--cli');
if (isCli) {
  (async () => {
    const run = await PlaywrightRun.create({
      name: 'CLI run ' + new Date().toISOString(),
      status: 'running',
      base_url: playwrightConfig.baseUrl,
      total_tests: 0,
      passed_tests: 0,
      failed_tests: 0,
      duration_ms: 0
    });
    await runPlaywrightTests({ playwrightRunId: run.id });
    console.log('Playwright run completed:', run.id);
    process.exit(0);
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runPlaywrightTests, getPlaywrightTestList, getPlaywrightTestListWithRecorded };

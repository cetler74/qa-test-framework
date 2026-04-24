const { chromium, firefox, webkit } = require('playwright');

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Op } = require('sequelize');
const { PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest, ProjectRecordedTest, ProjectTest, ProjectTestStat } = require('../models');
const playwrightConfig = require('../config/playwright');
const uiTestsConfig = require('../e2e/ui-tests.config');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const SCREENSHOTS_DIR = path.join(REPORTS_DIR, 'playwright-screenshots');
const VIDEOS_DIR = path.join(REPORTS_DIR, 'playwright-videos');
const TRACES_DIR = path.join(REPORTS_DIR, 'playwright-traces');

const BROWSERS = { chromium, firefox, webkit };

function detectUiVariableNamesFromSpec(specContent) {
  if (!specContent || typeof specContent !== 'string') return [];
  const names = new Set();
  const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match;
  while ((match = re.exec(specContent)) !== null) {
    if (match[1]) names.add(match[1]);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function normalizeUiVariablesMap(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || value == null) return;
    out[normalizedKey] = String(value);
  });
  return out;
}

function escapeUiVariableReplacement(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\$\{/g, '\\${')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function applyUiVariablesToSpec(specContent, uiVariables = {}) {
  const variableNames = detectUiVariableNamesFromSpec(specContent);
  const normalizedVariables = normalizeUiVariablesMap(uiVariables);
  const missingVariables = variableNames.filter((name) => !(name in normalizedVariables) || normalizedVariables[name] === '');
  if (missingVariables.length > 0) {
    const err = new Error(`Missing UI test variables: ${missingVariables.join(', ')}`);
    err.code = 'MISSING_UI_TEST_VARIABLES';
    throw err;
  }

  let effectiveSpecContent = String(specContent || '');
  variableNames.forEach((name) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    effectiveSpecContent = effectiveSpecContent.replace(
      new RegExp(`\\$\\{${escapedName}\\}`, 'g'),
      escapeUiVariableReplacement(normalizedVariables[name])
    );
  });
  return { effectiveSpecContent, variableNames };
}

/** RunId -> { cancelled: boolean, child?: ChildProcess, browser?: Browser }. Used to cancel running UI tests. */
const runningPlaywrightState = {};

/**
 * Take a full-page screenshot on failure. Returns filename (e.g. "runId_order.png") or null.
 * @param {import('playwright').Page} page
 * @param {number} runId
 * @param {number} order - execution_order for the result being recorded
 * @returns {Promise<string|null>} - Filename relative to SCREENSHOTS_DIR, or null
 */
async function takeFailureScreenshot(page, runId, order) {
  if (!page) return null;
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const filename = `${runId}_${order}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
    return fs.existsSync(filePath) ? filename : null;
  } catch (_) {
    return null;
  }
}

/**
 * Parse recorded spec content to extract step descriptions (navigation, clicks, fills, checks, expectations).
 * Returns an array of { description } in execution order, similar to precreated UI test validations.
 * @param {string} specContent - Raw spec JS/TS content
 * @returns {Array<{ description: string }>}
 */
function parseRecordedSpecSteps(specContent) {
  if (!specContent || typeof specContent !== 'string') return [];
  const steps = [];
  const lines = specContent.split(/\r?\n/);
  function extractStrings(line) {
    const out = [];
    let m;
    const re = /['"](?:[^'"\\]|\\.)*['"]/g;
    while ((m = re.exec(line)) !== null) out.push(m[0].slice(1, -1).replace(/\\(.)/g, '$1'));
    return out;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('import ') || trimmed.startsWith('test(')) continue;
    const strings = extractStrings(line);
    // getByRole('role', { name: 'X' }) -> strings[0]=role, strings[1]=name. Other patterns may have different order.
    const roleName = strings.length >= 2 ? strings[1] : (strings[0] || '');
    // page.goto('...')
    if (/page\.goto\s*\(/.test(line)) {
      const url = strings[0] || 'URL';
      const short = url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || url;
      steps.push({ description: `Navigate to ${short}` });
      continue;
    }
    // expect(...).toContainText('...')
    if (/expect\s*\(.*\)\.toContainText\s*\(/.test(line)) {
      steps.push({ description: strings.length ? `Expect content to contain "${strings[strings.length - 1]}"` : 'Expect content' });
      continue;
    }
    // getByRole('textbox', { name: 'X' }).fill('Y') -> strings: role, name, value (value is last)
    if (/getByRole\s*\(\s*['"]textbox['"]/.test(line) && /\.fill\s*\(/.test(line)) {
      const name = strings.length >= 2 ? strings[1] : (strings[0] || 'field');
      const value = strings.length >= 3 ? strings[strings.length - 1] : (strings.length === 1 ? strings[0] : '');
      const isPasswordLike = /palavra-passe|password|senha/i.test(name);
      const displayValue = isPasswordLike ? '***' : (value ? `"${value}"` : 'text');
      steps.push({ description: `Fill "${name}" with ${displayValue}` });
      continue;
    }
    // getByRole('textbox', { name: 'X' }).press('Key')
    if (/getByRole\s*\(\s*['"]textbox['"]/.test(line) && /\.press\s*\(/.test(line)) {
      const name = strings.length >= 2 ? strings[1] : (strings[0] || 'field');
      steps.push({ description: `Press key in "${name}"` });
      continue;
    }
    // getByRole('checkbox', { name: 'X' }).check()
    if (/getByRole\s*\(\s*['"]checkbox['"]/.test(line) && /\.check\s*\(/.test(line)) {
      const name = roleName || 'checkbox';
      steps.push({ description: `Check "${name}"` });
      continue;
    }
    // getByRole('option', { name: 'X' }).click()
    if (/getByRole\s*\(\s*['"]option['"]/.test(line) && /\.click\s*\(/.test(line)) {
      const name = roleName || 'option';
      steps.push({ description: `Select option "${name}"` });
      continue;
    }
    // getByRole('button'|'link'|..., { name: 'X' }).click()
    if (/getByRole\s*\(\s*['"](button|link|menuitem|tab)['"]/.test(line) && /\.click\s*\(/.test(line)) {
      const role = (line.match(/getByRole\s*\(\s*['"](button|link|menuitem|tab)['"]/) || [])[1] || 'element';
      const name = roleName || '';
      steps.push({ description: `Click ${role} "${name}"` });
      continue;
    }
    // getByRole('textbox', { name: 'X' }).click()
    if (/getByRole\s*\(\s*['"]textbox['"]/.test(line) && /\.click\s*\(/.test(line)) {
      const name = roleName || 'field';
      steps.push({ description: `Click textbox "${name}"` });
      continue;
    }
    // locator(...).filter({ hasText: 'X' }).click() -> first string is the selector, second is hasText
    if (/\.filter\s*\(\s*\{\s*hasText\s*:/.test(line) && /\.click\s*\(/.test(line)) {
      const text = strings.length >= 1 ? strings[strings.length - 1] : 'element';
      steps.push({ description: `Click "${text}"` });
      continue;
    }
    // Generic getByRole(..., { name: 'X' }).click()
    if (/getByRole\s*\(/.test(line) && /\.click\s*\(/.test(line)) {
      const name = roleName || 'element';
      steps.push({ description: `Click "${name}"` });
      continue;
    }
  }
  return steps;
}

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
 * Combined list: recorded tests only (no built-in tests).
 * Recorded entries have id like "recorded-<numericId>".
 * @param {number} [projectId] - If set, only include recorded tests linked to this project (project_recorded_tests).
 * @returns {Promise<Array<{ id: string, name: string, base_url?: string }>>}
 */
async function getPlaywrightTestListWithRecorded(projectId = null) {
  let recorded = [];
  try {
    const options = {
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'base_url', 'spec_content']
    };
    if (projectId) {
      const links = await ProjectRecordedTest.findAll({
        where: { project_id: projectId },
        attributes: ['recorded_test_id']
      });
      const ids = links.map(l => l.recorded_test_id);
      if (ids.length === 0) {
        return [];
      }
      options.where = { id: ids };
    }
    const rows = await PlaywrightRecordedTest.findAll(options);
    recorded = rows.map(r => ({
      id: `recorded-${r.id}`,
      name: r.name,
      base_url: r.base_url || undefined,
      variable_names: detectUiVariableNamesFromSpec(r.spec_content || '')
    }));
  } catch (err) {
    console.error('[playwrightRunner] Failed to load recorded tests:', err.message);
  }
  return recorded;
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
  runningPlaywrightState[runId] = { cancelled: false };
  try {
  const baseUrl = (options.baseUrl !== undefined && options.baseUrl !== '' && String(options.baseUrl).trim())
    ? String(options.baseUrl).trim().replace(/\/$/, '')
    : undefined;
  const headless = options.headless !== undefined ? options.headless : playwrightConfig.headless;
  const timeoutMs = options.timeoutMs || playwrightConfig.timeoutMs;
  const runOnly = options.runOnly && Array.isArray(options.runOnly) ? options.runOnly : null;
  const videoOpt = options.video || 'off';
  const traceOpt = options.trace || 'off';
  const browserName = options.browserName && BROWSERS[options.browserName] ? options.browserName : 'chromium';
  const slowMo = typeof options.slowMo === 'number' && options.slowMo >= 0 ? options.slowMo : 0;
  const uiVariables = normalizeUiVariablesMap(options.uiVariables);

  const recordedIds = runOnly ? runOnly.filter(id => String(id).startsWith('recorded-')).map(id => String(id).replace('recorded-', '')) : [];
  const builtInRunOnly = null;
  const shouldRun = () => false;

  const results = [];
  const startTime = Date.now();
  let total = 0;
  let passed = 0;
  let failed = 0;
  let order = 0;

  const hasBuiltInToRun = false;
  const filterValidations = uiTestsConfig.filterValidations || [];
  const sections = uiTestsConfig.apiSections || [];
  // Start with 0 total; we update with actual result count as tests complete (recorded specs can have multiple test() blocks).
  await updateRunSummary(runId, 0, 0, 0, 0, 'running');

  if (recordedIds.length === 0) {
    await updateRunSummary(runId, 0, 0, 0, 0, 'passed');
    return { summary: { total: 0, passed: 0, failed: 0 }, results: [] };
  }

  const record = async (orderNum, testName, status, durationMs, endpoint, errorMessage, assertions, screenshotPath = null) => {
    results.push({ test_name: testName, status, duration_ms: durationMs, endpoint, error_message: errorMessage, assertions, execution_order: orderNum, screenshot_path: screenshotPath });
    await recordResult(runId, orderNum, testName, status, durationMs, endpoint, errorMessage, assertions, screenshotPath);
    total++;
    if (status === 'passed') passed++; else failed++;
    // Use actual total so progress shows "X of X" (recorded specs can report more than one result).
    await updateRunSummary(runId, total, passed, failed, Date.now() - startTime, 'running');
  };
  let browser;
  let page;
  let builtInContext = null;

  const proxy = options.proxy && (options.proxy.http || options.proxy.https) ? options.proxy : null;
  const proxyServer = proxy ? (proxy.http || proxy.https) : null;

  if (hasBuiltInToRun) {
    try {
      const launchOptions = {
        headless,
        args: playwrightConfig.launchArgs || []
      };
      if (slowMo > 0) launchOptions.slowMo = slowMo;
      if (proxyServer) {
        launchOptions.proxy = {
          server: proxyServer,
          ...(proxy.bypass && proxy.bypass.trim() ? { bypass: proxy.bypass.trim() } : {})
        };
      }
      const launch = BROWSERS[browserName] || chromium;
      browser = await launch.launch(launchOptions);
      if (runningPlaywrightState[runId]) runningPlaywrightState[runId].browser = browser;
    } catch (err) {
      await record(++order, 'Browser launch', 'failed', 0, baseUrl, err.message, null);
      await updateRunSummary(runId, 1, 0, 1, Date.now() - startTime, 'failed');
      return { summary: { total: 1, passed: 0, failed: 1 }, results };
    }
    // Use a desktop viewport so headless matches headed (headless default is small; site may use mobile layout).
    const viewport = { width: 1280, height: 720 };
    const contextOptions = { baseURL: baseUrl, viewport };
    // Use a normal Chrome user agent so sites don't return 403 for headless/automation (HeadlessChrome).
    if (playwrightConfig.userAgent) {
      contextOptions.userAgent = playwrightConfig.userAgent;
    }
    if (videoOpt !== 'off') {
      const videoDir = path.join(VIDEOS_DIR, 'temp', String(runId));
      if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
      contextOptions.recordVideo = { dir: videoDir };
    }
    const context = await browser.newContext(contextOptions);
    builtInContext = context;
    context.setDefaultTimeout(timeoutMs);
    if (traceOpt !== 'off') {
      await context.tracing.start();
    }
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
    const validations = [];
    const btn = page.locator('button, a, [role="button"]').filter({ hasText: /CONCORDO/i }).first();
    await btn.waitFor({ state: 'visible', timeout: popupWaitMs }).catch(() => null);
    const visible = await btn.isVisible().catch(() => false);
    validations.push({ description: 'Consent popup / CONCORDO button visible', passed: visible });
    if (visible) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 500));
      validations.push({ description: 'CONCORDO button clicked', passed: true });
      await record(++order, 'Accept consent (CONCORDO)', 'passed', Date.now() - t0, page.url(), null, { validations });
    } else {
      validations.push({ description: 'CONCORDO button clicked', passed: false, detail: 'Button not found' });
      const shot = await takeFailureScreenshot(page, runId, order + 1);
      await record(++order, 'Accept consent (CONCORDO)', 'failed', Date.now() - t0, page.url(), 'CONCORDO button not found in consent popup', { validations, message: 'Consent button not present' }, shot);
    }
  } catch (err) {
    const shot = await takeFailureScreenshot(page, runId, order + 1);
    await record(++order, 'Accept consent (CONCORDO)', 'failed', 0, page.url(), err.message || String(err), { validations: [{ description: 'Accept consent', passed: false, detail: err.message || String(err) }] }, shot);
  }
  }

  // 2. Page load
  if (shouldRun('page-load')) {
  try {
    const t0 = Date.now();
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const duration = Date.now() - t0;
    const ok = response && response.ok();
    const statusCode = response?.status();
    const validations = [
      { description: 'Navigation to base URL', passed: !!response },
      { description: `HTTP response OK (status ${statusCode})`, passed: !!ok, detail: statusCode != null ? `Status: ${statusCode}` : undefined }
    ];
    if (ok) {
      await record(++order, 'Page load', 'passed', duration, baseUrl, null, { validations, status: statusCode, ok: true });
    } else {
      const shot = await takeFailureScreenshot(page, runId, order + 1);
      await record(++order, 'Page load', 'failed', duration, baseUrl, `HTTP ${statusCode}`, { validations, status: statusCode, ok: false }, shot);
    }
  } catch (err) {
    const shot = await takeFailureScreenshot(page, runId, order + 1);
    await record(++order, 'Page load', 'failed', 0, baseUrl, err.message || String(err), { validations: [{ description: 'Page load', passed: false, detail: err.message || String(err) }] }, shot);
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
      const validations = [];
      await page.goto(sectionBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
      validations.push({ description: 'Navigate to /apis', passed: true });
      // Clear filters first
      const clearAll = page.locator('a, button').filter({ hasText: /Limpar tudo/i }).first();
      const clearVisible = await clearAll.isVisible().catch(() => false);
      if (clearVisible) {
        await clearAll.click({ timeout: 3000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
      }
      validations.push({ description: 'Clear filters (Limpar tudo)', passed: true });
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
      validations.push({ description: `Filter option "${fv.categoryName}" found and selected`, passed: checked });
      if (!checked) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Filter option "${fv.categoryName}" not found or not clickable`, { validations }, shot);
        continue;
      }
      await new Promise(r => setTimeout(r, 1500));
      const mainText = await page.locator('main, [role="main"], .content, #content, body').first().innerText().catch(() => '');
      const expectedSections = fv.expectedSections || [];
      const errors = [];
      for (const sec of expectedSections) {
        const secFound = mainText.includes(sec.title);
        validations.push({ description: `Section "${sec.title}" found`, passed: secFound });
        if (!secFound) errors.push(`Section "${sec.title}" not found`);
        else {
          if (sec.descriptionContains) {
            const descOk = mainText.includes(sec.descriptionContains);
            validations.push({ description: `Section "${sec.title}" contains expected description`, passed: descOk });
            if (!descOk) errors.push(`Section "${sec.title}" missing description: "${sec.descriptionContains}"`);
          }
          if (sec.envLabels) {
            for (const env of sec.envLabels) {
              const envOk = mainText.includes(env);
              validations.push({ description: `Section "${sec.title}" has environment: ${env}`, passed: envOk });
              if (!envOk) errors.push(`Section "${sec.title}" missing environment: ${env}`);
            }
          }
        }
      }
      const duration = Date.now() - t0;
      if (errors.length > 0) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', duration, page.url(), errors.join('; '), { validations, expectedSections: fv.expectedSections, errors }, shot);
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { validations, category: fv.categoryName, sections: expectedSections.map(s => s.title) });
      }
    } catch (err) {
      const shot = await takeFailureScreenshot(page, runId, order + 1);
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), { validations: [{ description: 'Filter validation', passed: false, detail: err.message || String(err) }] }, shot);
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
      const validations = [];
      await page.goto(sectionBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await new Promise(r => setTimeout(r, 800));
      validations.push({ description: 'Navigate to /apis', passed: true });

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
      validations.push({ description: `Section link/card "${linkText}" found and clicked`, passed: clicked });
      if (!clicked) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Section box/link not found: ${linkText}`, { validations }, shot);
        continue;
      }
      await new Promise(r => setTimeout(r, 1000));

      const excludedEndpoints = (uiTestsConfig.excludedEndpoints || []).map(u => u.replace(/\/$/, ''));
      const isExcludedUrl = (url) => excludedEndpoints.some(ex => url === ex || url.startsWith(ex + '/'));

      const urlExcluded = isExcludedUrl(page.url());
      validations.push({ description: 'Page URL not excluded from tests', passed: !urlExcluded });
      if (urlExcluded) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), 'Invalid endpoint (removed from tests): ' + page.url(), { validations, excluded: true }, shot);
        continue;
      }

      const envBtn = section.envButton || 'Sandbox';
      const envLink = page.getByRole('link', { name: new RegExp(envBtn, 'i') }).first();
      const envLinkCount = await envLink.count();
      if (envLinkCount > 0) {
        const href = await envLink.getAttribute('href').catch(() => '');
        const resolvedHref = href ? new URL(href, sectionBaseUrl).href : '';
        const envExcluded = resolvedHref && excludedEndpoints.some(ex => resolvedHref.startsWith(ex.replace(/\/$/, '')));
        if (!resolvedHref || !envExcluded) {
          await envLink.click({ timeout: 5000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1000));
        }
        validations.push({ description: `Environment link "${envBtn}" found and selected`, passed: true });
      }

      const currentUrl = page.url();
      const currentExcluded = isExcludedUrl(currentUrl);
      validations.push({ description: 'Current URL not excluded after navigation', passed: !currentExcluded });
      if (currentExcluded) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', Date.now() - t0, currentUrl, 'Invalid endpoint (removed from tests): ' + currentUrl, { validations, excluded: true }, shot);
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

        const tabFound = !!tabEl;
        validations.push({ description: `Tab "${tabName}" found`, passed: tabFound });
        if (!tabEl) {
          tabErrors.push(`Tab "${tabName}" not found`);
          continue;
        }
        await tabEl.click({ timeout: 3000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 400));

        const contentSelectors = '[role="tabpanel"], .tab-content, .tabpanel, [class*="tab-panel"], [class*="TabPanel"], main, [class*="content"]';
        const content = await page.locator(contentSelectors).first().innerText().catch(() => '');
        const hasContent = content && content.trim().length >= minContentLength;
        let contentOk = hasContent;
        if (!hasContent) {
          const bodyText = await page.locator('body').innerText().catch(() => '');
          contentOk = !!(bodyText && bodyText.trim().length >= minContentLength);
          if (!contentOk) tabErrors.push(`Tab "${tabName}" has no substantial content`);
        }
        validations.push({ description: `Tab "${tabName}" has substantial content`, passed: contentOk });
      }

      const duration = Date.now() - t0;
      if (tabErrors.length > 0) {
        const shot = await takeFailureScreenshot(page, runId, order + 1);
        await record(++order, testName, 'failed', duration, page.url(), tabErrors.join('; '), { validations, requiredTabs, tabErrors }, shot);
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { validations, requiredTabs });
      }
    } catch (err) {
      const shot = await takeFailureScreenshot(page, runId, order + 1);
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), { validations: [{ description: 'API section test', passed: false, detail: err.message || String(err) }] }, shot);
    }
  }

  }

  // Save built-in run artifacts (video, trace) and close context before closing browser
  if (hasBuiltInToRun && browser && builtInContext) {
    const artifactUpdates = { browser_name: browserName };
    if (traceOpt !== 'off') {
      const keepTrace = traceOpt === 'on' || (traceOpt === 'retain-on-failure' && failed > 0);
      if (keepTrace) {
        if (!fs.existsSync(TRACES_DIR)) fs.mkdirSync(TRACES_DIR, { recursive: true });
        const tracePath = path.join(TRACES_DIR, `${runId}.zip`);
        await builtInContext.tracing.stop({ path: tracePath });
        artifactUpdates.trace_path = `${runId}.zip`;
      } else {
        await builtInContext.tracing.stop();
      }
    }
    await builtInContext.close();
    if (videoOpt !== 'off') {
      const keepVideo = videoOpt === 'on' || (videoOpt === 'retain-on-failure' && failed > 0);
      if (keepVideo) {
        const tempVideoDir = path.join(VIDEOS_DIR, 'temp', String(runId));
        const src = findFirstFileByExt(tempVideoDir, '.webm');
        if (src) {
          if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
          const dest = path.join(VIDEOS_DIR, `${runId}.webm`);
          fs.copyFileSync(src, dest);
          artifactUpdates.video_path = `${runId}.webm`;
        }
      }
    }
    await updateRunArtifacts(runId, artifactUpdates);
  }

  if (browser) await browser.close();

  // Track each recorded spec's output dir and whether it had a failure (so we prefer failed test's artifacts for run-level video/trace)
  const recordedRunDirs = [];
  for (const recId of recordedIds) {
    if (runningPlaywrightState[runId] && runningPlaywrightState[runId].cancelled) break;
    try {
      const startOrder = order + 1;
      const runOpts = { timeoutMs, headless, video: videoOpt, trace: traceOpt, browserName, slowMo, proxy };
      const out = await runRecordedSpec(runId, recId, baseUrl, startOrder, {
        ...runOpts,
        uiVariables
      });
      if (out.cancelled) {
        await updateRunSummary(runId, total, passed, failed, Date.now() - startTime, 'cancelled');
        return { summary: { total, passed, failed }, results };
      }
      const recResults = out.results;
      const recTestResultsDir = out.testResultsDir;
      const hasFailure = recResults.some(r => r.status === 'failed');
      recordedRunDirs.push({ testResultsDir: recTestResultsDir, hasFailure });
      for (const r of recResults) {
        await record(++order, r.testName, r.status, r.durationMs, null, r.errorMessage || null, r.assertions || null, r.screenshotPath || null);
      }
      // Save this spec's video/trace under stable names and link to the result row(s) we just created.
      // Only set result paths when we actually find and copy the file (on timeout Playwright may not flush artifacts).
      // Ensure we only use files inside this run's dir so we never attach another spec's artifact.
      if ((videoOpt !== 'off' || traceOpt !== 'off') && recTestResultsDir && fs.existsSync(recTestResultsDir)) {
        const videoFilename = `${runId}_${recId}.webm`;
        const traceFilename = `${runId}_${recId}.zip`;
        const keepVideo = videoOpt === 'on' || (videoOpt === 'retain-on-failure' && hasFailure);
        const keepTrace = traceOpt === 'on' || (traceOpt === 'retain-on-failure' && hasFailure);
        const dirRoot = path.resolve(recTestResultsDir);
        const isInsideDir = (filePath) => path.resolve(filePath).startsWith(dirRoot + path.sep) || path.resolve(filePath) === dirRoot;
        let resultVideoPath = null;
        let resultTracePath = null;
        if (keepVideo) {
          const src = findFirstFileByExt(recTestResultsDir, '.webm');
          if (src && isInsideDir(src)) {
            if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
            const dest = path.join(VIDEOS_DIR, videoFilename);
            try {
              fs.copyFileSync(src, dest);
              resultVideoPath = videoFilename;
            } catch (_) { /* ignore */ }
          }
        }
        if (keepTrace) {
          const src = findFirstFileByExt(recTestResultsDir, '.zip');
          if (src && isInsideDir(src)) {
            if (!fs.existsSync(TRACES_DIR)) fs.mkdirSync(TRACES_DIR, { recursive: true });
            const dest = path.join(TRACES_DIR, traceFilename);
            try {
              fs.copyFileSync(src, dest);
              resultTracePath = traceFilename;
            } catch (_) { /* ignore */ }
          }
        }
        if (resultVideoPath || resultTracePath) {
          const updatePayload = {};
          if (resultVideoPath) updatePayload.video_path = resultVideoPath;
          if (resultTracePath) updatePayload.trace_path = resultTracePath;
          await PlaywrightResult.update(updatePayload, {
            where: {
              playwright_run_id: runId,
              execution_order: { [Op.between]: [startOrder, startOrder + recResults.length - 1] }
            }
          });
        }
      }
    } catch (err) {
      await record(++order, `Recorded test ${recId}`, 'failed', 0, null, err.message || String(err), null, null);
    }
  }

  // Recorded-only run: set run-level video/trace only when there is exactly one recorded test. When there are multiple, each result has its own video/trace — do not set run-level so users use the per-result links (one file cannot contain all tests).
  const artifactSourceDir = (() => {
    if (!recordedRunDirs.length) return null;
    if (recordedRunDirs.length > 1) return null;
    const firstFailed = recordedRunDirs.find(d => d.hasFailure);
    return (firstFailed && firstFailed.testResultsDir) ? firstFailed.testResultsDir : recordedRunDirs[recordedRunDirs.length - 1].testResultsDir;
  })();
  if (!hasBuiltInToRun && artifactSourceDir && (videoOpt !== 'off' || traceOpt !== 'off')) {
    const keepVideo = videoOpt === 'on' || (videoOpt === 'retain-on-failure' && failed > 0);
    const keepTrace = traceOpt === 'on' || (traceOpt === 'retain-on-failure' && failed > 0);
    const artifactUpdates = { browser_name: browserName };
    if (keepVideo) {
      const src = findFirstFileByExt(artifactSourceDir, '.webm');
      if (src) {
        if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
        const dest = path.join(VIDEOS_DIR, `${runId}.webm`);
        try { fs.copyFileSync(src, dest); artifactUpdates.video_path = `${runId}.webm`; } catch (_) { /* ignore */ }
      }
    }
    if (keepTrace) {
      const src = findFirstFileByExt(artifactSourceDir, '.zip');
      if (src) {
        if (!fs.existsSync(TRACES_DIR)) fs.mkdirSync(TRACES_DIR, { recursive: true });
        const dest = path.join(TRACES_DIR, `${runId}.zip`);
        try { fs.copyFileSync(src, dest); artifactUpdates.trace_path = `${runId}.zip`; } catch (_) { /* ignore */ }
      }
    }
    await updateRunArtifacts(runId, artifactUpdates);
  }

  const durationMs = Date.now() - startTime;
  const status = (failed > 0 && passed > 0) ? 'partial_failed' : (failed > 0 ? 'failed' : 'passed');
  await updateRunSummary(runId, total, passed, failed, durationMs, status);

  return { summary: { total, passed, failed }, results };
  } finally {
    delete runningPlaywrightState[runId];
  }
}

/**
 * Recursively collect all .png file paths under dir. Returns paths sorted by name for stable ordering.
 * @param {string} dir
 * @returns {string[]}
 */
function collectScreenshotPaths(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith('.png')) list.push(full);
    }
  };
  walk(dir);
  return list.sort();
}

function collectFilesByName(dir, fileName) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  const expected = String(fileName || '').toLowerCase();
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase() === expected) list.push(full);
    }
  };
  walk(dir);
  return list.sort();
}

/**
 * Execute a recorded spec via Playwright Test CLI and return in-memory results plus temporary artifact paths.
 * This helper is intentionally persistence-free so it can back both saved runs and draft validation.
 * @param {{
 *   runId?: number,
 *   recordedId?: string | number | null,
 *   recordedName: string,
 *   specContent: string,
 *   baseUrl?: string,
 *   defaultBaseUrl?: string,
 *   startOrder?: number,
 *   runOptions?: { timeoutMs?: number, headless?: boolean, video?: string, trace?: string, browserName?: string, slowMo?: number, proxy?: object, uiVariables?: object },
 *   assertionSource?: string,
 *   persistScreenshots?: boolean
 * }} input
 * @returns {Promise<{ results: Array<{ testName, status, durationMs, errorMessage, assertions, screenshotPath? }>, testResultsDir: string, combinedOutput: string|null, artifacts: { videoFile: string|null, traceFile: string|null } }>} 
 */
async function executeRecordedSpec(input) {
  const runId = input && input.runId !== undefined ? input.runId : null;
  const recordedId = input && input.recordedId !== undefined ? input.recordedId : null;
  const testName = input && typeof input.recordedName === 'string' && input.recordedName.trim()
    ? input.recordedName.trim()
    : 'Recorded test';
  const specContent = input && typeof input.specContent === 'string' ? input.specContent : '';
  const defaultBaseUrl = input && typeof input.defaultBaseUrl === 'string' ? input.defaultBaseUrl : '';
  const baseUrl = input && typeof input.baseUrl === 'string' ? input.baseUrl : '';
  const startOrder = input && Number.isInteger(input.startOrder) ? input.startOrder : 0;
  const runOptions = input && input.runOptions ? input.runOptions : {};
  const assertionSource = input && typeof input.assertionSource === 'string' && input.assertionSource.trim()
    ? input.assertionSource.trim()
    : 'recorded';
  const persistScreenshots = input && input.persistScreenshots === false ? false : true;
  const baseUrlToUse = baseUrl || defaultBaseUrl || playwrightConfig.baseUrl || 'https://example.com';
  const headless = runOptions.headless !== undefined ? runOptions.headless : (playwrightConfig.headless !== undefined ? playwrightConfig.headless : true);
  const timeoutMs = runOptions.timeoutMs || playwrightConfig.timeoutMs || 60000;
  const videoOpt = runOptions.video || 'off';
  const traceOpt = runOptions.trace || 'off';
  const browserName = runOptions.browserName && ['chromium', 'firefox', 'webkit'].includes(runOptions.browserName) ? runOptions.browserName : 'chromium';
  const slowMo = typeof runOptions.slowMo === 'number' && runOptions.slowMo >= 0 ? runOptions.slowMo : 0;

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const slug = `recorded-${recordedId || 'draft'}-${Date.now()}`;
  const specPath = path.join(REPORTS_DIR, `${slug}.spec.js`);
  const configPath = path.join(REPORTS_DIR, `${slug}.config.cjs`);
  const resultPath = path.join(REPORTS_DIR, `${slug}-result.json`);
  const testResultsDir = path.join(REPORTS_DIR, 'playwright-test-results', slug);
  try {
    const { effectiveSpecContent } = applyUiVariablesToSpec(specContent || '', runOptions.uiVariables || {});
    fs.writeFileSync(specPath, effectiveSpecContent, 'utf8');
    const specFileName = path.basename(specPath);
    const launchArgs = playwrightConfig.launchArgs || [];
    const userAgent = playwrightConfig.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const useVideo = videoOpt !== 'off' ? (videoOpt === 'retain-on-failure' ? "'retain-on-failure'" : "'on'") : "'off'";
    const useTrace = traceOpt !== 'off' ? (traceOpt === 'retain-on-failure' ? "'retain-on-failure'" : "'on'") : "'off'";
    const proxySpec = runOptions.proxy && (runOptions.proxy.http || runOptions.proxy.https) ? runOptions.proxy : null;
    const proxyServer = proxySpec ? (proxySpec.http || proxySpec.https) : null;
    const launchOpts = { headless, args: launchArgs };
    if (slowMo > 0) launchOpts.slowMo = slowMo;
    if (proxyServer) {
      launchOpts.proxy = {
        server: proxyServer,
        ...(proxySpec.bypass && proxySpec.bypass.trim() ? { bypass: proxySpec.bypass.trim() } : {})
      };
    }
    const proxyObj = launchOpts.proxy ? (proxySpec.bypass && proxySpec.bypass.trim()
      ? { server: proxyServer, bypass: proxySpec.bypass.trim() }
      : { server: proxyServer }) : null;
    const useProxyLine = proxyObj ? `proxy: ${JSON.stringify(proxyObj)},` : '';
    const configContent = `
module.exports = {
  testDir: ${JSON.stringify(REPORTS_DIR)},
  testMatch: ${JSON.stringify([specFileName])},
  outputDir: ${JSON.stringify(testResultsDir)},
  use: {
    baseURL: ${JSON.stringify(baseUrlToUse)},
    userAgent: ${JSON.stringify(userAgent)},
    trace: ${useTrace},
    video: ${useVideo},
    screenshot: 'only-on-failure',
    ${useProxyLine}
    launchOptions: ${JSON.stringify(launchOpts)}
  },
  projects: [{ name: ${JSON.stringify(browserName)}, use: { browserName: ${JSON.stringify(browserName)} } }],
  timeout: ${timeoutMs},
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
    // Use spawn (async) instead of spawnSync so the Node event loop is not blocked during the
    // subprocess run (video/trace recording can take a long time); the server can then accept
    // new run requests while this run is in progress.
    const spawnEnv = { ...process.env };
    if (proxySpec) {
      const u = proxySpec.http || proxySpec.https || '';
      spawnEnv.HTTP_PROXY = u;
      spawnEnv.HTTPS_PROXY = u;
      spawnEnv.NO_PROXY = proxySpec.bypass || '';
      spawnEnv.http_proxy = u;
      spawnEnv.https_proxy = u;
      spawnEnv.no_proxy = proxySpec.bypass || '';
    }
    const result = await new Promise((resolve, reject) => {
      const timeout = timeoutMs * 2 + 10000;
      let timedOut = false;
      let cancelledByUser = false;
      const child = spawn(command, finalArgs, {
        cwd,
        shell: isWin,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (runId != null && runningPlaywrightState[runId]) runningPlaywrightState[runId].child = child;
      const chunks = { stdout: [], stderr: [] };
      const maxBuffer = 4 * 1024 * 1024;
      let totalLen = 0;
      function onData(channel, data) {
        if (totalLen >= maxBuffer) return;
        chunks[channel].push(data);
        totalLen += data.length;
        if (totalLen > maxBuffer) {
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }
      child.stdout.on('data', (d) => onData('stdout', d));
      child.stderr.on('data', (d) => onData('stderr', d));
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch (_) {}
      }, timeout);
      child.once('close', (code, signal) => {
        if (runId != null && runningPlaywrightState[runId]) runningPlaywrightState[runId].child = null;
        if (signal && !timedOut) cancelledByUser = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(chunks.stdout).toString('utf8').trim();
        const stderr = Buffer.concat(chunks.stderr).toString('utf8').trim();
        resolve({
          status: timedOut ? 1 : (code != null ? code : (signal ? 1 : 0)),
          stdout,
          stderr,
          error: timedOut ? new Error(`Playwright test timed out after ${timeout}ms`) : null,
          cancelled: cancelledByUser
        });
      });
      child.once('error', (err) => {
        if (runId != null && runningPlaywrightState[runId]) runningPlaywrightState[runId].child = null;
        clearTimeout(timer);
        try { child.kill(); } catch (_) {}
        resolve({
          status: 1,
          stdout: Buffer.concat(chunks.stdout).toString('utf8').trim(),
          stderr: Buffer.concat(chunks.stderr).toString('utf8').trim(),
          error: err,
          cancelled: false
        });
      });
    });
    if (result.cancelled) return { results: [], testResultsDir, cancelled: true };
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
    // Collect failure artifacts from Playwright test output.
    const screenshotSources = collectScreenshotPaths(testResultsDir);
    const errorContextSources = collectFilesByName(testResultsDir, 'error-context.md');
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    // Parse spec content to get step descriptions (navigation, clicks, fills, etc.) for validations
    const parsedSteps = parseRecordedSpecSteps(effectiveSpecContent || '');

    const results = [];
    let failedScreenshotIndex = 0;
    let failedErrorContextIndex = 0;

    function pushResult(testName, status, durationMs, errorMessage, assertions, resultIndex) {
      let screenshotPath = null;
      let draftScreenshotFile = null;
      let draftErrorContextFile = null;
      if (persistScreenshots && runId != null && status === 'failed' && failedScreenshotIndex < screenshotSources.length) {
        const src = screenshotSources[failedScreenshotIndex++];
        const filename = `${runId}_${startOrder + resultIndex}.png`;
        const dest = path.join(SCREENSHOTS_DIR, filename);
        try {
          fs.copyFileSync(src, dest);
          screenshotPath = filename;
        } catch (_) { /* ignore */ }
      } else if (status === 'failed' && failedScreenshotIndex < screenshotSources.length) {
        draftScreenshotFile = screenshotSources[failedScreenshotIndex++] || null;
      }
      if (status === 'failed' && failedErrorContextIndex < errorContextSources.length) {
        draftErrorContextFile = errorContextSources[failedErrorContextIndex++] || null;
      }
      results.push({ testName, status, durationMs, errorMessage, assertions, screenshotPath, draftScreenshotFile, draftErrorContextFile });
    }

    if (report.length > 0) {
      report.forEach((e, i) => {
        const rawTitle = e.title || e.data?.title || testName;
        const title = `Recorded: ${testName}${rawTitle && rawTitle !== testName ? ` › ${rawTitle}` : ''}`;
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
        const validations = [];
        if (parsedSteps.length > 0) {
          for (const step of parsedSteps) {
            validations.push({
              description: step.description,
              passed: status === 'passed',
              detail: undefined
            });
          }
        }
        if (Array.isArray(e.steps) && e.steps.length > 0 && validations.length === 0) {
          for (const step of e.steps) {
            validations.push({
              description: step.title || 'Step',
              passed: !step.error,
              detail: step.error || undefined
            });
          }
        }
        validations.push({
          description: rawTitle || 'Test result',
          passed: status === 'passed',
          detail: status !== 'passed' ? (e.error?.message || e.data?.error?.message || finalError) : undefined
        });
        const assertions = {
          validations,
          source: assertionSource,
          recorded_test_id: recordedId != null ? String(recordedId) : null,
          recorded_test_name: testName,
          raw_status: rawStatus,
          raw_title: rawTitle,
          duration_ms: durationMs,
          report_entry: e
        };
        pushResult(title, status, durationMs, finalError, assertions, i);
      });
    } else {
      const status = result.status === 0 ? 'passed' : 'failed';
      const errorMessage = combinedOutput
        ? (combinedOutput.length > 2000 ? combinedOutput.slice(0, 2000) + '...' : combinedOutput)
        : (result.status !== 0 ? 'Playwright test run failed (no output captured)' : null);
      const validations = [];
      if (parsedSteps.length > 0) {
        for (const step of parsedSteps) {
          validations.push({ description: step.description, passed: status === 'passed', detail: undefined });
        }
      }
      validations.push({ description: 'Recorded test run', passed: result.status === 0, detail: result.status !== 0 ? errorMessage : undefined });
      pushResult(`Recorded: ${test.name}`, status, 0, errorMessage, {
        validations,
        source: assertionSource,
        recorded_test_id: recordedId != null ? String(recordedId) : null,
        recorded_test_name: testName,
        raw_status: result.status === 0 ? 'passed' : 'failed',
        output: combinedOutput || null
      }, 0);
    }
    const artifacts = {
      videoFile: videoOpt !== 'off' ? findFirstFileByExt(testResultsDir, '.webm') : null,
      traceFile: traceOpt !== 'off' ? findFirstFileByExt(testResultsDir, '.zip') : null
    };
    return { results, testResultsDir, combinedOutput: combinedOutput || null, artifacts };
  } finally {
    try { if (fs.existsSync(specPath)) fs.unlinkSync(specPath); } catch (_) {}
    try { if (fs.existsSync(configPath)) fs.unlinkSync(configPath); } catch (_) {}
    try { if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath); } catch (_) {}
  }
}

/**
 * Run a single recorded spec (from DB) via Playwright Test CLI and return result rows (with optional screenshotPath for failures).
 * @param {number} runId - PlaywrightRun id
 * @param {string} recordedId - PlaywrightRecordedTest id (numeric string)
 * @param {string} baseUrl - Base URL for the run
 * @param {number} startOrder - execution_order for the first result (so we can name screenshots runId_startOrder.png, etc.)
 * @param {{ timeoutMs?: number, headless?: boolean, video?: string, trace?: string, browserName?: string, slowMo?: number }} [runOptions] - Optional timeout, headless, video/trace/browser/slowMo
 * @returns {Promise<{ results: Array<{ testName, status, durationMs, errorMessage, assertions, screenshotPath? }>, testResultsDir: string, combinedOutput: string|null, artifacts: { videoFile: string|null, traceFile: string|null } }>}
 */
async function runRecordedSpec(runId, recordedId, baseUrl, startOrder, runOptions = {}) {
  const test = await PlaywrightRecordedTest.findByPk(recordedId);
  if (!test) throw new Error(`Recorded test ${recordedId} not found`);
  return executeRecordedSpec({
    runId,
    recordedId,
    recordedName: test.name,
    specContent: test.spec_content || '',
    baseUrl,
    defaultBaseUrl: test.base_url || '',
    startOrder,
    runOptions,
    assertionSource: 'recorded',
    persistScreenshots: true
  });
}

/** Flatten nested steps from Playwright JSON report into a list of { title, error? }. */
function flattenReportSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const list = [];
  for (const s of steps) {
    const errMsg = s.error && (typeof s.error === 'string' ? s.error : s.error.message || JSON.stringify(s.error));
    list.push({ title: s.title || 'Step', error: errMsg || null });
    if (Array.isArray(s.steps) && s.steps.length > 0) {
      list.push(...flattenReportSteps(s.steps));
    }
  }
  return list;
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
            const steps = lastResult && Array.isArray(lastResult.steps) ? flattenReportSteps(lastResult.steps) : [];
            out.push({ title: testTitle, status, durationMs, error: errorMessage ? { message: errorMessage } : null, steps });
          });
        } else {
          out.push({ title: specTitle, status: spec.ok ? 'passed' : 'failed', steps: [] });
        }
      });
    }
  };
  if (Array.isArray(report.suites)) report.suites.forEach(walkSuite);
  return out;
}

async function recordResult(runId, order, testName, status, durationMs, endpoint, errorMessage, assertions, screenshotPath = null) {
  const uiResult = await PlaywrightResult.create({
    playwright_run_id: runId,
    test_name: testName,
    status,
    duration_ms: durationMs || null,
    endpoint: endpoint || null,
    error_message: errorMessage || null,
    assertions: assertions || null,
    execution_order: order,
    screenshot_path: screenshotPath || null
  });

  // Update per-test catalogue stats for this UI result
  const run = await PlaywrightRun.findByPk(runId);
  await updateProjectTestStatsForUiResult(run, uiResult);
}

async function updateRunSummary(runId, totalTests, passedTests, failedTests, durationMs, status) {
  await PlaywrightRun.update(
    { total_tests: totalTests, passed_tests: passedTests, failed_tests: failedTests, duration_ms: durationMs, status },
    { where: { id: runId } }
  );
}

/**
 * Update artifact paths and browser_name on a run.
 * @param {number} runId
 * @param {{ video_path?: string | null, trace_path?: string | null, browser_name?: string | null }} updates
 */
async function updateRunArtifacts(runId, updates = {}) {
  const set = {};
  if (updates.video_path !== undefined) set.video_path = updates.video_path || null;
  if (updates.trace_path !== undefined) set.trace_path = updates.trace_path || null;
  if (updates.browser_name !== undefined) set.browser_name = updates.browser_name || null;
  if (Object.keys(set).length === 0) return;
  await PlaywrightRun.update(set, { where: { id: runId } });
}

/**
 * Ensure a ProjectTest and ProjectTestStat exist for a given UI PlaywrightResult
 * and update aggregated stats.
 * Stable keys:
 *  - Built-in UI tests: ui_builtin:<id>
 *  - Recorded tests: ui_recorded:<recordedId>
 * For recorded tests we prefer assertions.recorded_test_id; for built-in tests we
 * fall back to the test_name to maintain stability.
 * @param {import('../models/PlaywrightRun')} run
 * @param {import('../models/PlaywrightResult')} result
 * @returns {Promise<void>}
 */
async function updateProjectTestStatsForUiResult(run, result) {
  try {
    if (!run || !run.project_id) return;

    const testName = (result.test_name || '').toString();
    const assertions = result.assertions || {};
    let stableKey;
    let testType;
    let sourceId = null;
    let sourceKind = null;

    if (assertions && assertions.source === 'recorded' && assertions.recorded_test_id) {
      // Recorded UI test with explicit recorded_test_id
      const recordedId = String(assertions.recorded_test_id);
      stableKey = `ui_recorded:${recordedId}`;
      testType = 'ui_recorded';
      sourceId = parseInt(recordedId, 10) || null;
      sourceKind = 'ui_recorded';
    } else if (testName.startsWith('Recorded:')) {
      // Fallback: treat as recorded by name
      stableKey = `ui_recorded:${testName.replace(/^Recorded:\s*/, '')}`;
      testType = 'ui_recorded';
      sourceKind = 'ui_recorded';
    } else {
      // Built-in UI test: we do not include these in the project_tests catalogue anymore
      // to avoid polluting coverage with global UI checks.
      return;
    }

    const name = testName || 'UI Test';

    const [projectTest] = await ProjectTest.findOrCreate({
      where: {
        project_id: run.project_id,
        stable_key: stableKey
      },
      defaults: {
        test_type: testType,
        name,
        endpoint: result.endpoint || null,
        method: 'UI',
        source_id: sourceId,
        source_kind: sourceKind,
        is_active: true
      }
    });

    await projectTest.update({
      name,
      endpoint: result.endpoint || projectTest.endpoint,
      method: 'UI',
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
      last_status: result.status || stats.last_status || 'not_run',
      last_run_at: new Date(),
      last_run_source: 'ui_run',
      last_run_type: 'ui',
      last_run_id: run.id
    });
  } catch (err) {
    // Never break UI execution because catalogue updates failed
    console.error('[playwrightRunner] Failed to update project test stats for UI result:', err.message || err);
  }
}

/**
 * Find first file with given extension under dir (recursive). Returns absolute path or null.
 * @param {string} dir
 * @param {string} ext - e.g. '.webm'
 * @returns {string|null}
 */
function findFirstFileByExt(dir, ext) {
  if (!fs.existsSync(dir)) return null;
  const lower = ext.toLowerCase();
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (e.name.toLowerCase().endsWith(lower)) return full;
    }
    return null;
  };
  return walk(dir);
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

/**
 * Cancel a running Playwright run by killing its subprocess and closing the browser (if any).
 * Updates the run status to 'cancelled'. Idempotent if run is not running or already cancelled.
 * @param {number} runId - PlaywrightRun id
 * @returns {Promise<boolean>} true if run was running and was cancelled, false otherwise
 */
async function cancelPlaywrightRun(runId) {
  const state = runningPlaywrightState[runId];
  if (!state) return false;
  state.cancelled = true;
  if (state.child) {
    try { state.child.kill('SIGTERM'); } catch (_) {}
    state.child = null;
  }
  if (state.browser) {
    try { await state.browser.close(); } catch (_) {}
    state.browser = null;
  }
  await PlaywrightRun.update({ status: 'cancelled' }, { where: { id: runId } });
  return true;
}

module.exports = {
  runPlaywrightTests,
  getPlaywrightTestList,
  getPlaywrightTestListWithRecorded,
  cancelPlaywrightRun,
  detectUiVariableNamesFromSpec,
  executeRecordedSpec
};

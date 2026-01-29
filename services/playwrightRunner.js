const { chromium } = require('playwright');


const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PlaywrightRun, PlaywrightResult, PlaywrightRecordedTest, ProjectRecordedTest } = require('../models');
const playwrightConfig = require('../config/playwright');
const uiTestsConfig = require('../e2e/ui-tests.config');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

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
 * Combined list: built-in tests + recorded tests from DB.
 * Recorded entries have id like "recorded-<numericId>".
 * @param {number} [projectId] - If set, only include recorded tests linked to this project (project_recorded_tests).
 * @returns {Promise<Array<{ id: string, name: string, base_url?: string }>>}
 */
async function getPlaywrightTestListWithRecorded(projectId = null) {
  const builtIn = getPlaywrightTestList();
  let recorded = [];
  try {
    const options = {
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'base_url']
    };
    if (projectId) {
      const links = await ProjectRecordedTest.findAll({
        where: { project_id: projectId },
        attributes: ['recorded_test_id']
      });
      const ids = links.map(l => l.recorded_test_id);
      if (ids.length === 0) {
        return [...builtIn];
      }
      options.where = { id: ids };
    }
    const rows = await PlaywrightRecordedTest.findAll(options);
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

  const hasBuiltInToRun = builtInRunOnly === null || builtInRunOnly.length > 0;
  const filterValidations = uiTestsConfig.filterValidations || [];
  const sections = uiTestsConfig.apiSections || [];
  // Start with 0 total; we update with actual result count as tests complete (recorded specs can have multiple test() blocks).
  await updateRunSummary(runId, 0, 0, 0, 0, 'running');

  const record = async (orderNum, testName, status, durationMs, endpoint, errorMessage, assertions) => {
    results.push({ test_name: testName, status, duration_ms: durationMs, endpoint, error_message: errorMessage, assertions, execution_order: orderNum });
    await recordResult(runId, orderNum, testName, status, durationMs, endpoint, errorMessage, assertions);
    total++;
    if (status === 'passed') passed++; else failed++;
    // Use actual total so progress shows "X of X" (recorded specs can report more than one result).
    await updateRunSummary(runId, total, passed, failed, Date.now() - startTime, 'running');
  };
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
      await record(++order, 'Accept consent (CONCORDO)', 'failed', Date.now() - t0, page.url(), 'CONCORDO button not found in consent popup', { validations, message: 'Consent button not present' });
    }
  } catch (err) {
    await record(++order, 'Accept consent (CONCORDO)', 'failed', 0, page.url(), err.message || String(err), { validations: [{ description: 'Accept consent', passed: false, detail: err.message || String(err) }] });
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
    await record(++order, 'Page load', ok ? 'passed' : 'failed', duration, baseUrl, ok ? null : `HTTP ${statusCode}`, { validations, status: statusCode, ok: !!ok });
  } catch (err) {
    await record(++order, 'Page load', 'failed', 0, baseUrl, err.message || String(err), { validations: [{ description: 'Page load', passed: false, detail: err.message || String(err) }] });
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
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Filter option "${fv.categoryName}" not found or not clickable`, { validations });
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
        await record(++order, testName, 'failed', duration, page.url(), errors.join('; '), { validations, expectedSections: fv.expectedSections, errors });
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { validations, category: fv.categoryName, sections: expectedSections.map(s => s.title) });
      }
    } catch (err) {
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), { validations: [{ description: 'Filter validation', passed: false, detail: err.message || String(err) }] });
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
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), `Section box/link not found: ${linkText}`, { validations });
        continue;
      }
      await new Promise(r => setTimeout(r, 1000));

      const excludedEndpoints = (uiTestsConfig.excludedEndpoints || []).map(u => u.replace(/\/$/, ''));
      const isExcludedUrl = (url) => excludedEndpoints.some(ex => url === ex || url.startsWith(ex + '/'));

      const urlExcluded = isExcludedUrl(page.url());
      validations.push({ description: 'Page URL not excluded from tests', passed: !urlExcluded });
      if (urlExcluded) {
        await record(++order, testName, 'failed', Date.now() - t0, page.url(), 'Invalid endpoint (removed from tests): ' + page.url(), { validations, excluded: true });
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
        await record(++order, testName, 'failed', Date.now() - t0, currentUrl, 'Invalid endpoint (removed from tests): ' + currentUrl, { validations, excluded: true });
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
        await record(++order, testName, 'failed', duration, page.url(), tabErrors.join('; '), { validations, requiredTabs, tabErrors });
      } else {
        await record(++order, testName, 'passed', duration, page.url(), null, { validations, requiredTabs });
      }
    } catch (err) {
      await record(++order, testName, 'failed', Date.now() - t0, page.url(), err.message || String(err), { validations: [{ description: 'API section test', passed: false, detail: err.message || String(err) }] });
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
    // Parse spec content to get step descriptions (navigation, clicks, fills, etc.) for validations
    const parsedSteps = parseRecordedSpecSteps(test.spec_content || '');

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
        // Build validations: parsed spec steps (each action with description) + overall test result
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
        // If report has test.step() steps, use those for per-step pass/fail when available
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
        await addRecord(title, status, durationMs, finalError, {
          validations,
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
      const validations = [];
      if (parsedSteps.length > 0) {
        for (const step of parsedSteps) {
          validations.push({ description: step.description, passed: status === 'passed', detail: undefined });
        }
      }
      validations.push({ description: 'Recorded test run', passed: result.status === 0, detail: result.status !== 0 ? errorMessage : undefined });
      await addRecord(`Recorded: ${test.name}`, status, 0, errorMessage, {
        validations,
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

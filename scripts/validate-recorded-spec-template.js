'use strict';

/**
 * Focused validation script for services/recordedSpecTemplate.js.
 * Run with: node scripts/validate-recorded-spec-template.js
 * Exit code 0 = all assertions passed.  Exit code 1 = at least one failed.
 */

const {
  applyRecordedSpecTemplate,
  hasPlaywrightTestImport,
  ensureExpectImport,
  hasTemplateHelpers,
  injectTemplateHelpers,
  fixTestUsePosition,
  injectClearCookies,
  injectOneTimeStorageClearAfterFirstGoto,
  transformClickCalls,
  transformFillCalls,
  removeRecorderNoise,
  removeRedundantEnterPresses,
  removeRedundantPreFillClicks,
} = require('../services/recordedSpecTemplate');

// ─── Tiny assertion helpers ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertContains(haystack, needle, message) {
  assert(haystack.includes(needle), message || `contains: ${needle.slice(0, 60)}`);
}

function assertNotContains(haystack, needle, message) {
  assert(!haystack.includes(needle), message || `does not contain: ${needle.slice(0, 60)}`);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RAW_CODEGEN = `const { test } = require('@playwright/test');

test('test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('textbox', { name: 'Username' }).fill('my-user');
  await page.getByRole('textbox', { name: 'Username' }).press('Tab');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'As minhas aplicações' }).click();
});
`;

// Simulate what normalizeRecordedSpec produces before our transformer runs:
// ensureRecordedSpecIgnoresHttpsErrors prepends test.use when none exists.
const AFTER_BASE_NORM = `test.use({
  ignoreHTTPSErrors: true
});

const { test } = require('@playwright/test');

test('test', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('textbox', { name: 'Username' }).fill('my-user');
  await page.getByRole('textbox', { name: 'Username' }).press('Tab');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'As minhas aplicações' }).click();
});
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

section('hasPlaywrightTestImport');
assert(hasPlaywrightTestImport(`const { test } = require('@playwright/test');`), 'detects CJS import');
assert(!hasPlaywrightTestImport(`const { test } = require('other');`), 'ignores non-playwright require');

section('ensureExpectImport');
{
  const r1 = ensureExpectImport(`const { test } = require('@playwright/test');`);
  assertContains(r1, 'expect', 'adds expect when missing');
  assertNotContains(r1, 'test, expect, expect', 'does not duplicate expect');

  const r2 = ensureExpectImport(`const { test, expect } = require('@playwright/test');`);
  assert(r2 === `const { test, expect } = require('@playwright/test');`, 'leaves existing expect import unchanged');

  const r3 = ensureExpectImport(`const { test, page } = require('@playwright/test');`);
  assertContains(r3, 'expect', 'adds expect alongside other imports');
}

section('hasTemplateHelpers');
assert(!hasTemplateHelpers('const { test } = ...'), 'false when helpers absent');
assert(hasTemplateHelpers('async function clickVisibleElement(locator) {}'), 'true when helpers present');

section('fixTestUsePosition — test.use before import');
{
  const r = fixTestUsePosition(AFTER_BASE_NORM.replace('const { test } = require', 'const { test, expect } = require'));
  const importIdx = r.indexOf("const { test, expect }");
  const testUseIdx = r.indexOf('test.use(');
  assert(importIdx < testUseIdx, 'import appears before test.use after fix');
  assert(importIdx !== -1, 'import is present');
}

section('fixTestUsePosition — test.use already after import (no change)');
{
  const alreadyCorrect = `const { test, expect } = require('@playwright/test');\n\ntest.use({\n  ignoreHTTPSErrors: true\n});\n`;
  const r = fixTestUsePosition(alreadyCorrect);
  assert(r === alreadyCorrect, 'returns spec unchanged when ordering is already correct');
}

section('injectTemplateHelpers');
{
  const base = `const { test, expect } = require('@playwright/test');\n\ntest('x', async ({ page }) => {});\n`;
  const r = injectTemplateHelpers(base);
  assertContains(r, 'function clickVisibleElement', 'injects clickVisibleElement');
  assertContains(r, 'function clickVisibleButton', 'injects clickVisibleButton');
  assertContains(r, 'function fillLikeUser', 'injects fillLikeUser');
  // Import must come before the helpers
  assert(r.indexOf("require('@playwright/test')") < r.indexOf('function clickVisibleElement'), 'import before helpers');
  // Helpers must come before the test block
  assert(r.indexOf('function fillLikeUser') < r.indexOf("test('x'"), 'helpers before test block');
  // Running again must not duplicate helpers
  const r2 = injectTemplateHelpers(r);
  const count = (r2.match(/function clickVisibleElement/g) || []).length;
  assert(count === 1, 'helpers injected exactly once (idempotent)');
}

section('transformClickCalls — button role → clickVisibleButton');
{
  const input = `  await page.getByRole('button', { name: 'Submit' }).click();\n`;
  const r = transformClickCalls(input);
  assertContains(r, 'clickVisibleButton', 'button role uses clickVisibleButton');
  assertNotContains(r, '.click()', 'raw .click() removed');
}

section('transformClickCalls — non-button → clickVisibleElement');
{
  const input = `  await page.getByRole('link', { name: 'Home' }).click();\n`;
  const r = transformClickCalls(input);
  assertContains(r, 'clickVisibleElement', 'non-button uses clickVisibleElement');
  assertNotContains(r, '.click()', 'raw .click() removed');
}

section('transformClickCalls — click with options left unchanged');
{
  const input = `  await page.getByRole('button', { name: 'X' }).click({ force: true });\n`;
  const r = transformClickCalls(input);
  assertContains(r, '.click({ force: true })', 'click with options left unchanged');
}

section('transformClickCalls — dialog.getByRole button');
{
  const input = `  await dialog.getByRole('button', { name: 'OK' }).click();\n`;
  const r = transformClickCalls(input);
  assertContains(r, 'clickVisibleButton', 'dialog button uses clickVisibleButton');
}

section('transformFillCalls — textbox fill → fillLikeUser');
{
  const input = `  await page.getByRole('textbox', { name: 'Username' }).fill('my-user');\n`;
  const r = transformFillCalls(input);
  assertContains(r, 'fillLikeUser', 'fill rewritten to fillLikeUser');
  assertContains(r, "'my-user'", 'value preserved');
  assertNotContains(r, '.fill(', 'raw .fill( removed');
}

section('transformFillCalls — fill with options left unchanged');
{
  const input = `  await page.getByLabel('Search').fill('query', { force: true });\n`;
  const r = transformFillCalls(input);
  assertContains(r, '.fill(', 'fill with options left unchanged');
  assertNotContains(r, 'fillLikeUser', 'fillLikeUser not used when fill has options');
}

section('removeRecorderNoise — Tab/CapsLock press lines removed');
{
  const spec = [
    `  await page.getByRole('textbox', { name: 'Username' }).press('Tab');`,
    `  await page.getByRole('textbox', { name: 'Pin' }).press('CapsLock');`,
    `  await page.getByRole('button', { name: 'Submit' }).click();`,
  ].join('\n') + '\n';
  const r = removeRecorderNoise(spec);
  assertNotContains(r, `press('Tab')`, 'Tab press removed');
  assertNotContains(r, `press('CapsLock')`, 'CapsLock press removed');
  assertContains(r, '.click()', 'other lines preserved');
}

section('removeRecorderNoise — page.keyboard.press preserved');
{
  const input = `  await page.keyboard.press('Tab');\n`;
  const r = removeRecorderNoise(input);
  assertContains(r, `keyboard.press('Tab')`, 'intentional keyboard.press preserved');
}

section('injectClearCookies — adds clearCookies as first test statement');
{
  const spec = `const { test, expect } = require('@playwright/test');
test('login test', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
});
`;
  const r = injectClearCookies(spec);
  assertContains(r, 'await page.context().clearCookies();', 'clearCookies injected');
  assert(r.indexOf('clearCookies') < r.indexOf('page.goto'), 'clearCookies before goto');
  assertNotContains(r, 'page.addInitScript', 'does not inject persistent addInitScript');
}

section('injectOneTimeStorageClearAfterFirstGoto — clears storage after first goto then reloads');
{
  const spec = `const { test, expect } = require('@playwright/test');
test('login test', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
});
`;
  const r = injectOneTimeStorageClearAfterFirstGoto(spec);
  assertContains(r, 'localStorage.clear()', 'localStorage.clear injected');
  assertContains(r, 'sessionStorage.clear()', 'sessionStorage.clear injected');
  assertContains(r, "page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })", 'reload injected after storage clear');
  assert(r.indexOf('page.goto') < r.indexOf('localStorage.clear'), 'storage clear after first goto');
  assert(r.indexOf('localStorage.clear') < r.indexOf('Iniciar sessão'), 'storage clear before login action');
  assertNotContains(r, 'page.addInitScript', 'does not use persistent addInitScript');
}

section('injectOneTimeStorageClearAfterFirstGoto — idempotent');
{
  const already = `const { test, expect } = require('@playwright/test');
test('t', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('https://example.com');
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} try { sessionStorage.clear(); } catch (_) {} });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
});
`;
  const r = injectOneTimeStorageClearAfterFirstGoto(already);
  const count = (r.match(/localStorage\.clear/g) || []).length;
  assert(count === 1, 'localStorage.clear appears exactly once after double-run');
}

section('injectClearCookies — idempotent (does not double-inject)');
{
  const already = `const { test, expect } = require('@playwright/test');
test('t', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('https://example.com');
});
`;
  const r = injectClearCookies(already);
  const count = (r.match(/clearCookies/g) || []).length;
  assert(count === 1, 'clearCookies appears exactly once after double-run');
}

section('applyRecordedSpecTemplate — full sample includes clearCookies');
{
  const result = applyRecordedSpecTemplate(AFTER_BASE_NORM);
  // Import ordering
  const importIdx = result.indexOf("const { test, expect }");
  const testUseIdx = result.indexOf('test.use(');
  const helpersIdx = result.indexOf('function clickVisibleElement');
  assert(importIdx !== -1, 'import present');
  assert(importIdx < helpersIdx, 'import before helpers');
  assert(helpersIdx < testUseIdx, 'helpers before test.use');

  // expect added
  assertContains(result, 'const { test, expect }', 'expect imported');

  // All three helpers
  assertContains(result, 'function clickVisibleElement', 'clickVisibleElement helper');
  assertContains(result, 'function clickVisibleButton', 'clickVisibleButton helper');
  assertContains(result, 'function fillLikeUser', 'fillLikeUser helper');

  // Interactions transformed
  assertContains(result, 'fillLikeUser(page.getByRole', 'fill rewritten to fillLikeUser');
  assertContains(result, 'clickVisibleButton(page.getByRole', 'button click rewritten');
  assertContains(result, 'clickVisibleElement(page.getByRole', 'link click rewritten');
  assertNotContains(result, ".fill('my-user')", 'raw fill removed');
  assertNotContains(result, ".click()", 'raw click removed');
  assertNotContains(result, "press('Tab')", 'Tab press noise removed');

  // Clean unauthenticated start without clearing post-login tokens on redirects
  assertContains(result, 'await page.context().clearCookies();', 'clearCookies injected by full pipeline');
  assertContains(result, 'localStorage.clear()', 'one-time localStorage clear injected by full pipeline');
  assertContains(result, 'page.reload({ waitUntil: \'domcontentloaded\', timeout: 60000 })', 'reload after storage clear injected by full pipeline');
  assert(result.indexOf('page.goto') < result.indexOf('localStorage.clear'), 'storage clear occurs after first goto');
  assertNotContains(result, 'page.addInitScript', 'full pipeline does not use persistent addInitScript');

  // HTTPS errors setting preserved
  assertContains(result, 'ignoreHTTPSErrors: true', 'ignoreHTTPSErrors preserved');
}

section('applyRecordedSpecTemplate — idempotency');
{
  const first = applyRecordedSpecTemplate(AFTER_BASE_NORM);
  const second = applyRecordedSpecTemplate(first);
  assert(first === second, 'applying twice produces identical output');

  const clickCount = (second.match(/function clickVisibleElement/g) || []).length;
  const buttonCount = (second.match(/function clickVisibleButton/g) || []).length;
  const fillCount = (second.match(/function fillLikeUser\s*\(/g) || []).length;
  // The function DEFINITION appears once; the helper call may also appear.
  assert(clickCount === 1, 'clickVisibleElement defined exactly once');
  assert(buttonCount === 1, 'clickVisibleButton defined exactly once');
  // fillLikeUser appears in the definition AND in a call — at least 1 definition
  assert(fillCount >= 1, 'fillLikeUser present');
}

section('applyRecordedSpecTemplate — non-Playwright input returned unchanged');
{
  const notASpec = 'console.log("hello world");';
  assert(applyRecordedSpecTemplate(notASpec) === notASpec, 'non-Playwright string returned unchanged');
  assert(applyRecordedSpecTemplate(null) === null, 'null returned unchanged');
  assert(applyRecordedSpecTemplate(42) === 42, 'number returned unchanged');
}

section('applyRecordedSpecTemplate — spec with existing test.use and viewport');
{
  const withViewport = `const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true
});

test('viewport test', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'Go' }).click();
});
`;
  const r = applyRecordedSpecTemplate(withViewport);
  assertContains(r, 'viewport', 'viewport option preserved');
  assertContains(r, 'clickVisibleButton', 'button click transformed');
  const importIdx = r.indexOf("require('@playwright/test')");
  const helpersIdx = r.indexOf('function clickVisibleElement');
  const testUseIdx = r.indexOf('test.use(');
  assert(importIdx < helpersIdx, 'import before helpers');
  assert(helpersIdx < testUseIdx, 'helpers before test.use');
}

section('applyRecordedSpecTemplate — spec with existing test.use and viewport');
{
  const withViewport = `const { test, expect } = require('@playwright/test');

test.use({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true
});

test('viewport test', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'Go' }).click();
});
`;
  const r = applyRecordedSpecTemplate(withViewport);
  assertContains(r, 'viewport', 'viewport option preserved');
  assertContains(r, 'clickVisibleButton', 'button click transformed');
  const importIdx = r.indexOf("require('@playwright/test')");
  const helpersIdx = r.indexOf('function clickVisibleElement');
  const testUseIdx = r.indexOf('test.use(');
  assert(importIdx < helpersIdx, 'import before helpers');
  assert(helpersIdx < testUseIdx, 'helpers before test.use');
}

section('clickVisibleButton helper — uses mouse.move/down/up (not mouse.click)');
{
  const spec = `const { test, expect } = require('@playwright/test');
test('x', async ({ page }) => {
  await page.getByRole('button', { name: 'OK' }).click();
});`;
  const r = applyRecordedSpecTemplate(spec);
  assertContains(r, 'page.mouse.move(', 'helper uses mouse.move');
  assertContains(r, 'page.mouse.down()', 'helper uses mouse.down');
  assertContains(r, 'page.mouse.up()', 'helper uses mouse.up');
  // clickVisibleButton should not use the old single-call mouse.click pattern
  const buttonFnStart = r.indexOf('async function clickVisibleButton');
  const buttonFnEnd = r.indexOf('\nasync function', buttonFnStart + 1);
  const buttonFnBody = r.slice(buttonFnStart, buttonFnEnd > -1 ? buttonFnEnd : undefined);
  assertNotContains(buttonFnBody, 'mouse.click(', 'clickVisibleButton does not use old mouse.click');
}

section('fillLikeUser helper — uses clickVisibleElement internally, no Tab at end');
{
  const spec = `const { test, expect } = require('@playwright/test');
test('x', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Name' }).fill('value');
});`;
  const r = applyRecordedSpecTemplate(spec);
  assertContains(r, 'await clickVisibleElement(locator)', 'fillLikeUser uses clickVisibleElement');
  assertNotContains(r, "locator.press('Tab')", 'fillLikeUser does not press Tab at end');
  assertNotContains(r, "await locator.click()", 'fillLikeUser does not use locator.click');
}

section('removeRedundantPreFillClicks — drops click before fill on same locator');
{
  const spec = [
    `  await clickVisibleElement(page.getByRole('textbox', { name: 'Username' }));`,
    `  await fillLikeUser(page.getByRole('textbox', { name: 'Username' }), 'user@example.com');`,
  ].join('\n') + '\n';
  const r = removeRedundantPreFillClicks(spec);
  assertNotContains(r, 'clickVisibleElement(page.getByRole', 'redundant pre-fill click removed');
  assertContains(r, 'fillLikeUser(', 'fillLikeUser line kept');
}

section('removeRedundantPreFillClicks — keeps click when not immediately before fill');
{
  const spec = [
    `  await clickVisibleElement(page.getByTestId('nav-menu-my-apps-button'));`,
    `  await clickVisibleElement(page.getByTestId('create-app-button'));`,
  ].join('\n') + '\n';
  const r = removeRedundantPreFillClicks(spec);
  assert((r.match(/clickVisibleElement/g) || []).length === 2, 'non-fill clicks are kept');
}

section('applyRecordedSpecTemplate — ESM import detected and placed first');
{
  // Simulate what happens when ensureRecordedSpecIgnoresHttpsErrors prepends test.use
  // before an ESM-style spec.
  const esmAfterBaseNorm = `test.use({
  ignoreHTTPSErrors: true
});

import { test, expect } from '@playwright/test';

test('esmTest', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'Go' }).click();
});
`;
  const r = applyRecordedSpecTemplate(esmAfterBaseNorm);
  const importIdx = r.indexOf("import {");
  const testUseIdx = r.indexOf('test.use(');
  const helpersIdx = r.indexOf('function clickVisibleElement');
  assert(importIdx !== -1, 'ESM import present');
  assert(importIdx === 0 || r.slice(0, importIdx).trim() === '', 'ESM import at top');
  assert(importIdx < helpersIdx, 'ESM import before helpers');
  assertContains(r, 'clickVisibleButton', 'button click transformed for ESM spec');
}

section('ensureExpectImport — handles ESM style');
{
  const r = ensureExpectImport(`import { test } from '@playwright/test';`);
  assertContains(r, 'expect', 'adds expect to ESM import');
  const r2 = ensureExpectImport(`import { test, expect } from '@playwright/test';`);
  assert(r2 === `import { test, expect } from '@playwright/test';`, 'no change when expect already present');
}

section('removeRedundantEnterPresses — removes Enter press before clickVisible* call');
{
  const spec = [
    `  await fillLikeUser(page.getByRole('textbox', { name: 'Palavra-passe' }), 'secret');`,
    `  await page.getByRole('textbox', { name: 'Palavra-passe' }).press('Enter');`,
    `  await clickVisibleButton(page.getByRole('button', { name: 'Entrar' }));`,
  ].join('\n') + '\n';
  const r = removeRedundantEnterPresses(spec);
  assertNotContains(r, `press('Enter')`, 'redundant Enter press removed');
  assertContains(r, 'clickVisibleButton', 'button click kept');
}

section('removeRedundantEnterPresses — keeps Enter press when not before a clickVisible call');
{
  const spec = [
    `  await fillLikeUser(page.getByRole('searchbox', { name: 'Search' }), 'query');`,
    `  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');`,
  ].join('\n') + '\n';
  const r = removeRedundantEnterPresses(spec);
  assertContains(r, `press('Enter')`, 'intentional Enter press kept');
}

section('applyRecordedSpecTemplate — login form Enter before Entrar button removed');
{
  const loginSpec = `const { test, expect } = require('@playwright/test');
test('login', async ({ page }) => {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
  await page.getByRole('textbox', { name: 'Palavra-passe' }).fill('secret');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).press('Enter');
  await page.getByRole('button', { name: 'Entrar' }).click();
});
`;
  const r = applyRecordedSpecTemplate(loginSpec);
  assertNotContains(r, `press('Enter')`, 'redundant Enter before Entrar removed by full pipeline');
  assertContains(r, 'clickVisibleButton', 'Entrar click kept');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All assertions passed.');
  process.exit(0);
}

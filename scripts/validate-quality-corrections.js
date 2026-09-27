'use strict';

const { analyzeSpecQuality, applyQualityCorrections } = require('../services/recordedTestValidation');

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

const RAW = `const { test } = require('@playwright/test');

test('test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'As minhas aplicações' }).click();
});
`;

const warnings = analyzeSpecQuality(RAW);
const visible = warnings.find((warning) => warning.includes('toBeVisible({ timeout: 15000 })'));
const link = warnings.find((warning) => warning.includes('toHaveURL'));
const nth = 'Avoid positional selectors like `.nth(...)` when possible. Prefer stable semantic selectors such as `getByRole`, `getByLabel`, or a selector tied to a stable target.';

console.log('\n── both Results corrections ──');
const both = applyQualityCorrections(RAW, [visible, link, nth]);
assert(both.specContent.includes("await page.getByRole('button', { name: 'Entrar' }).click();"), 'original button click stays in the code');
assert(both.specContent.includes("await page.getByRole('link', { name: 'As minhas aplicações' }).click();"), 'original link click stays in the code');
assert(both.specContent.includes("await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible({ timeout: 15000 });"), 'visibility wait before button click');
assert(both.specContent.includes("await expect(page.getByRole('link', { name: 'As minhas aplicações' })).toBeVisible({ timeout: 15000 });"), 'visibility wait before link click');
assert(both.specContent.includes('await expect(page).toHaveURL(/.+/, { timeout: 15000 });'), 'destination assertion after link click');
assert(both.specContent.includes('expect'), 'expect import added');
assert(both.specContent.includes('const { test, expect }'), 'expect added to import');
assert(both.applied.includes(visible) && both.applied.includes(link), 'both result warnings applied');
assert(both.unchanged.some((item) => item.warning === nth && item.reason === 'manual'), 'selector advice stays manual');
assert(!analyzeSpecQuality(both.specContent).includes(visible), 'visibility warning clears after apply');
assert(!analyzeSpecQuality(both.specContent).includes(link), 'link warning clears after apply');

console.log('\n── only the warning from one result ──');
const linkOnly = applyQualityCorrections(RAW, [link]);
assert(linkOnly.specContent.includes('toHaveURL'), 'link correction applied');
assert(!linkOnly.specContent.includes('toBeVisible({ timeout: 15000 })'), 'visibility correction omitted when that result did not recommend it');
assert(linkOnly.applied.length === 1 && linkOnly.applied[0] === link, 'only the link warning is applied');

const visibleOnly = applyQualityCorrections(RAW, [visible]);
assert(visibleOnly.specContent.includes('toBeVisible({ timeout: 15000 })'), 'visibility correction applied');
assert(!visibleOnly.specContent.includes('toHaveURL'), 'link correction omitted when that result did not recommend it');

console.log('\n── idempotent ──');
const again = applyQualityCorrections(both.specContent, [visible, link]);
assert(again.specContent === both.specContent, 'applying the same corrections twice does not duplicate lines');
assert(again.applied.length === 0, 'already-present corrections are not reported as newly applied');

console.log('\n── helper clicks, goto, and https ──');
const helperSpec = `import { test } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://example.com');
  await clickVisibleElement(page.getByRole('link', { name: 'Home' }));
});
`;
const helperWarnings = analyzeSpecQuality(helperSpec);
const helperResult = applyQualityCorrections(helperSpec, helperWarnings);
assert(helperResult.specContent.includes("await expect(page.getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 15000 });"), 'visibility wait before helper click');
assert(helperResult.specContent.includes('toHaveURL'), 'link assertion after helper click');
assert(helperResult.specContent.includes("waitUntil: 'domcontentloaded'"), 'goto waitUntil from that warning');
assert(helperResult.specContent.includes('timeout: 30000'), 'goto timeout from that warning');
assert(helperResult.specContent.includes('ignoreHTTPSErrors: true'), 'https correction from that warning');
assert(helperResult.specContent.indexOf('import { test, expect }') < helperResult.specContent.indexOf('ignoreHTTPSErrors'), 'https option stays after the import');
const remaining = analyzeSpecQuality(helperResult.specContent);
assert(!remaining.some((warning) => helperResult.applied.includes(warning)), 'applied warnings no longer come back');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

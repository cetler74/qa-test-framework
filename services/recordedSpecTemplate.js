'use strict';

// ─── Sentinel / constants ────────────────────────────────────────────────────

const PLAYWRIGHT_IMPORT_RE =
  /const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?/;

// ESM-style: import { test, expect } from '@playwright/test'
const ESM_PLAYWRIGHT_IMPORT_RE =
  /import\s*\{[^}]+\}\s*from\s*['"]@playwright\/test['"]\s*;?/;

// String used to detect whether the helpers have already been injected.
const HELPER_SENTINEL = 'function clickVisibleElement';

const HELPERS = `async function clickVisibleElement(locator) {
  await expect(locator).toBeVisible({ timeout: 30000 });
  await locator.scrollIntoViewIfNeeded();

  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Element has no bounding box');
  }

  await locator.page().mouse.click(
    box.x + box.width / 2,
    box.y + box.height / 2
  );
}

async function clickVisibleButton(locator) {
  await expect(locator).toBeVisible({ timeout: 30000 });
  await expect(locator).toBeEnabled({ timeout: 30000 });
  await locator.scrollIntoViewIfNeeded();

  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Button has no bounding box');
  }

  const page = locator.page();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function fillLikeUser(locator, value) {
  await clickVisibleElement(locator);
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Backspace');
  await locator.type(value, { delay: 20 });
}`;

// ─── Detection ───────────────────────────────────────────────────────────────

function hasPlaywrightTestImport(spec) {
  return PLAYWRIGHT_IMPORT_RE.test(spec) || ESM_PLAYWRIGHT_IMPORT_RE.test(spec);
}

function looksLikePlaywrightSpec(spec) {
  return (
    hasPlaywrightTestImport(spec) ||
    (/\btest\s*\(/.test(spec) &&
      /\bpage\b|\blocator\s*\(|\bgetByRole\s*\(/.test(spec))
  );
}

// ─── Import handling ─────────────────────────────────────────────────────────

/**
 * Ensures `expect` is in the Playwright import destructure (CJS and ESM).
 */
function ensureExpectImport(spec) {
  const addExpect = (open, names, close) => {
    if (/\bexpect\b/.test(names)) return `${open}${names}${close}`;
    const trimmedNames = names.trimEnd().replace(/,\s*$/, '');
    return `${open}${trimmedNames}, expect ${close}`;
  };
  // CJS
  spec = spec.replace(
    /(const\s*\{)([^}]+)(\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?)/,
    (_, open, names, close) => addExpect(open, names, close)
  );
  // ESM
  spec = spec.replace(
    /(import\s*\{)([^}]+)(\}\s*from\s*['"]@playwright\/test['"]\s*;?)/,
    (_, open, names, close) => addExpect(open, names, close)
  );
  return spec;
}

// ─── Helper injection ────────────────────────────────────────────────────────

function hasTemplateHelpers(spec) {
  return spec.includes(HELPER_SENTINEL);
}

/**
 * If `test.use(...)` appears before the Playwright import (e.g. because
 * ensureRecordedSpecIgnoresHttpsErrors prepended it), move it to after the
 * import so the resulting file is valid JavaScript.
 */
function fixTestUsePosition(spec) {
  // Match ESM import first; fall back to CJS.
  const importMatch =
    spec.match(/(import\s*\{[^}]+\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?)/) ||
    spec.match(/(const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?[ \t]*\n?)/);
  if (!importMatch) return spec;

  const importStr = importMatch[1];
  const importStart = spec.indexOf(importStr);
  if (importStart === 0) return spec; // already first, nothing to fix

  const beforeImport = spec.slice(0, importStart).trimEnd();
  if (!beforeImport) return spec;

  const afterImport = spec.slice(importStart + importStr.length);
  const importLine = importStr.endsWith('\n') ? importStr : `${importStr}\n`;
  // Reconstruct: import → content-that-was-before-import → rest
  return `${importLine}\n${beforeImport}\n${afterImport.replace(/^\n+/, '\n')}`;
}

/**
 * Injects the three helper functions once, immediately after the Playwright
 * import line.  Falls back to before the first test.use / test() block if
 * there is no CommonJS import (e.g. ESM specs).
 */
function injectTemplateHelpers(spec) {
  if (hasTemplateHelpers(spec)) return spec;

  const cjsMatch = spec.match(
    /(const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?[ \t]*\n?)/
  );
  const esmMatch = spec.match(
    /(import\s*\{[^}]+\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?)/
  );
  const importMatch = cjsMatch || esmMatch;

  if (importMatch) {
    const importStr = importMatch[1];
    const importEnd = spec.indexOf(importStr) + importStr.length;
    const afterImport = spec.slice(importEnd).replace(/^\n+/, '');
    return `${spec.slice(0, importEnd)}\n${HELPERS}\n\n${afterImport}`;
  }

  // No import found — inject before first test.use or test()
  const firstBlockMatch = spec.match(/^(test\.use\s*\(|test\s*\()/m);
  if (firstBlockMatch) {
    const idx = spec.indexOf(firstBlockMatch[0]);
    const before = spec.slice(0, idx).replace(/\n+$/, '\n');
    return `${before}${HELPERS}\n\n${spec.slice(idx)}`;
  }

  return spec;
}

/**
 * Injects `await page.context().clearCookies()` as the first statement inside
 * every test(..., async ({ page }) => { ... }) block.  This clears HTTP
 * session cookies without touching auth tokens created after login.
 * Idempotent: skips blocks that already start with clearCookies.
 */
function injectClearCookies(spec) {
  // Negative lookahead avoids double-injecting on already-transformed specs.
  return spec.replace(
    /(test\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*async\s*\(\s*\{[^}]*\bpage\b[^}]*\}\s*\)\s*=>\s*\{)([ \t]*\n)(?!\s*await page\.context\(\)\.clearCookies)/g,
    `$1$2  await page.context().clearCookies();\n`
  );
}

/**
 * Clears SPA auth storage once after the first page.goto, then reloads the page.
 * This avoids persistent addInitScript storage clearing, which also runs after
 * successful login redirects and wipes the fresh token.
 */
function injectOneTimeStorageClearAfterFirstGoto(spec) {
  const marker = 'localStorage.clear(); } catch (_) {} try { sessionStorage.clear(); }';
  if (spec.includes(marker)) return spec;

  return spec.replace(
    /(await page\.goto\([\s\S]*?\)\s*;)([ \t]*\n)/,
    `$1$2  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} try { sessionStorage.clear(); } catch (_) {} });\n  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });\n`
  );
}

// ─── Interaction transformation ──────────────────────────────────────────────

// Guards for already-transformed calls — skip lines that already use helpers.
const ALREADY_TRANSFORMED_RE =
  /\b(clickVisibleElement|clickVisibleButton|fillLikeUser)\s*\(/;

// Matches .getByRole('button', ...) or .getByRole("button") anywhere in the locator.
const BUTTON_ROLE_RE = /\.getByRole\s*\(\s*(['"`])button\1/;

// Matches recorder-generated .press('Tab') / .press('CapsLock') lines.
// Intentional keyboard actions on page.keyboard are preserved.
const PRESS_NOISE_RE =
  /\.press\s*\(\s*(['"`])(Tab|CapsLock)\1\s*\)\s*;?\s*$/;

/**
 * Splits a top-level argument list string by commas, respecting nested
 * brackets, braces, parentheses and string literals.
 */
function splitTopLevelArgs(source) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    current += ch;

    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) { quote = null; }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      parts.push(current.slice(0, -1).trim());
      current = '';
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Rewrites zero-argument `.click()` calls to `clickVisibleButton` (for button
 * role locators) or `clickVisibleElement` (for all other locators).
 * Skips lines that already use helper functions or that have click options.
 */
function transformClickCalls(spec) {
  return spec
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('await ')) return line;
      if (ALREADY_TRANSFORMED_RE.test(trimmed)) return line;

      const indent = line.slice(0, line.length - trimmed.length);
      const clickMatch = line.match(/^(\s*)(await\s+)(.*?)\.click\(\s*\)\s*;?\s*$/);
      if (!clickMatch) return line;

      const locator = clickMatch[3].trim();
      const helper = BUTTON_ROLE_RE.test(locator)
        ? 'clickVisibleButton'
        : 'clickVisibleElement';
      return `${indent}await ${helper}(${locator});`;
    })
    .join('\n');
}

/**
 * Rewrites single-argument `.fill(value)` calls to `fillLikeUser(locator, value)`.
 * Skips lines with multiple arguments (e.g. fill with options).
 */
function transformFillCalls(spec) {
  return spec
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('await ')) return line;
      if (ALREADY_TRANSFORMED_RE.test(trimmed)) return line;

      const indent = line.slice(0, line.length - trimmed.length);
      const fillMatch = line.match(/^(\s*)(await\s+)(.*?)\.fill\(([\s\S]*)\)\s*;?\s*$/);
      if (!fillMatch) return line;

      const locator = fillMatch[3].trim();
      const fillArgs = fillMatch[4];
      // Skip multi-argument fills (e.g. .fill(value, { force: true })).
      if (splitTopLevelArgs(fillArgs).length !== 1) return line;

      return `${indent}await fillLikeUser(${locator}, ${fillArgs.trim()});`;
    })
    .join('\n');
}

/**
 * Removes recorder-generated press('Tab') / press('CapsLock') noise lines.
 * Deliberate page.keyboard.press() calls are left unchanged.
 */
function removeRecorderNoise(spec) {
  return spec
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('await ')) return true;
      if (ALREADY_TRANSFORMED_RE.test(trimmed)) return true;
      if (/\.keyboard\.press\s*\(/.test(trimmed)) return true;
      return !PRESS_NOISE_RE.test(line);
    })
    .join('\n');
}

/**
 * Removes a `clickVisibleElement(X)` line that is immediately followed by
 * `fillLikeUser(X, ...)` on the same locator.  Since fillLikeUser already
 * calls clickVisibleElement internally, the preceding standalone click is
 * redundant and was produced by Codegen recording both a click and a fill.
 */
function removeRedundantPreFillClicks(spec) {
  const lines = spec.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];

    if (next !== undefined) {
      const clickMatch = line.match(/^(\s*)await clickVisibleElement\((.*)\)\s*;?\s*$/);
      if (clickMatch) {
        const locator = clickMatch[2].trim();
        const fillOuter = next.match(/^(\s*)await fillLikeUser\(([\s\S]+)\)\s*;?\s*$/);
        if (fillOuter) {
          const fillArgParts = splitTopLevelArgs(fillOuter[2]);
          if (fillArgParts.length >= 2 && fillArgParts[0].trim() === locator) {
            continue; // drop the redundant pre-fill click
          }
        }
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Removes redundant `press('Enter')` calls that are immediately followed by a
 * `clickVisibleButton` or `clickVisibleElement` call.  Codegen records both
 * when the user presses Enter in a form field and then clicks the submit
 * button; the button click alone is sufficient.
 */
function removeRedundantEnterPresses(spec) {
  const ENTER_RE = /\.press\s*\(\s*(['"`])Enter\1\s*\)\s*;?\s*$/;
  const CLICK_RE = /^\s*await clickVisible(?:Button|Element)\s*\(/;
  return spec
    .split('\n')
    .filter((line, i, arr) => {
      if (!ENTER_RE.test(line)) return true;
      const next = arr[i + 1];
      return !(next && CLICK_RE.test(next));
    })
    .join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Transforms a raw Playwright Codegen spec into a robust version that uses
 * the three interaction helpers.  Safe to call multiple times (idempotent).
 *
 * @param {string} specContent
 * @returns {string}
 */
function applyRecordedSpecTemplate(specContent) {
  if (typeof specContent !== 'string') return specContent;
  if (!looksLikePlaywrightSpec(specContent)) return specContent;

  let spec = specContent;
  spec = ensureExpectImport(spec);
  spec = fixTestUsePosition(spec);
  spec = injectTemplateHelpers(spec);
  spec = injectClearCookies(spec);
  spec = injectOneTimeStorageClearAfterFirstGoto(spec);
  spec = transformClickCalls(spec);
  spec = transformFillCalls(spec);
  spec = removeRecorderNoise(spec);
  spec = removeRedundantEnterPresses(spec);
  spec = removeRedundantPreFillClicks(spec);
  return spec;
}

module.exports = {
  applyRecordedSpecTemplate,
  // Exported individually for focused validation / testing.
  hasPlaywrightTestImport,
  looksLikePlaywrightSpec,
  ensureExpectImport,
  hasTemplateHelpers,
  injectTemplateHelpers,
  fixTestUsePosition,
  transformClickCalls,
  transformFillCalls,
  removeRecorderNoise,
  removeRedundantEnterPresses,
  removeRedundantPreFillClicks,
  injectClearCookies,
  injectOneTimeStorageClearAfterFirstGoto,
};

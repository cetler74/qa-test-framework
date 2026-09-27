/**
 * Basic validation for pasted Playwright spec content.
 * Rejects obviously dangerous patterns since we run the spec as a file.
 */
const DANGEROUS_PATTERNS = [
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
  /\brequire\s*\(\s*['"]fs['"]\s*\)/,
  /\brequire\s*\(\s*['"]path['"]\s*\)/,
  /\brequire\s*\(\s*['"]process['"]\s*\)/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bprocess\.(exit|env|argv|cwd)\b/,
  /\bchild_process\b/,
  /\bspawn\s*\(/,
  /\bexec\s*\(/,
  /\bexecSync\s*\(/
];

const MIN_LENGTH = 20;
const MAX_LENGTH = 500000;

/**
 * @param {string} specContent
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSpecContent(specContent) {
  if (typeof specContent !== 'string') {
    return { valid: false, error: 'spec_content must be a string' };
  }
  const trimmed = specContent.trim();
  if (trimmed.length < MIN_LENGTH) {
    return { valid: false, error: `spec_content is too short (minimum ${MIN_LENGTH} characters)` };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { valid: false, error: `spec_content exceeds maximum length (${MAX_LENGTH} characters)` };
  }
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(trimmed)) {
      return { valid: false, error: 'spec_content contains disallowed pattern (e.g. require, process, eval)' };
    }
  }
  if (!/\btest\s*\(|page\.|locator\(|getByRole\(|expect\s*\(/.test(trimmed)) {
    return { valid: false, error: 'spec_content does not look like a Playwright test (expected test(), page., locator, getByRole, or expect)' };
  }
  return { valid: true };
}

function analyzeSpecQuality(specContent) {
  if (typeof specContent !== 'string') return [];
  const trimmed = specContent.trim();
  if (!trimmed) return [];

  const warnings = [];

  if (/\.nth\s*\(/.test(trimmed)) {
    warnings.push('Avoid positional selectors like `.nth(...)` when possible. Prefer stable semantic selectors such as `getByRole`, `getByLabel`, or a selector tied to a stable target.');
  }

  if (/locator\s*\(\s*['"`](div|span|p|section|article|figure|img|li|ul)['"`]\s*\)/i.test(trimmed)) {
    warnings.push('Generic container selectors such as `locator(\'div\')` are brittle. Prefer semantic selectors that target the actual interactive element.');
  }

  if (/getByText\s*\(/.test(trimmed) && !/getByRole\s*\(/.test(trimmed)) {
    warnings.push('Text-only selectors can be fragile on portal pages. Prefer `getByRole` or `getByLabel` when the UI exposes stable accessible names.');
  }

  if (/page\.goto\s*\(/.test(trimmed) && !/waitUntil\s*:\s*['"`]domcontentloaded['"`]/.test(trimmed)) {
    warnings.push('Use `page.goto(..., { waitUntil: \'domcontentloaded\', timeout: 30000 })` for portal pages so navigation becomes less timing-sensitive and the page is ready before selectors run.');
  }

  if (/page\.goto\s*\(/.test(trimmed) && !/timeout\s*:\s*30000/.test(trimmed)) {
    warnings.push('Add an explicit navigation timeout such as `timeout: 30000` to `page.goto(...)` so slow UAT pages fail predictably.');
  }

  if (/getByRole\s*\(/.test(trimmed) && !/toBeVisible\s*\(\s*\{\s*timeout\s*:\s*(15000|20000)/.test(trimmed)) {
    warnings.push('Before clicking key UI elements, add `await expect(...).toBeVisible({ timeout: 15000 })` or a similar explicit visibility assertion so the recording waits for the intended target instead of racing the UI.');
  }

  if (/getByRole\s*\(\s*['"`]link['"`]/.test(trimmed) && !/toHaveURL\s*\(/.test(trimmed)) {
    warnings.push('When a recorded test clicks a navigation link, add a follow-up assertion such as `await expect(page).toHaveURL(...)` or a strong destination-page visibility check.');
  }

  if (/https:\/\//.test(trimmed) && !/ignoreHTTPSErrors\s*:\s*true/.test(trimmed) && !/test\.use\s*\(\s*\{\s*ignoreHTTPSErrors\s*:\s*true\s*\}\s*\)/.test(trimmed)) {
    warnings.push('If this UAT environment has certificate issues, consider `test.use({ ignoreHTTPSErrors: true })` for this recorded test.');
  }

  return warnings;
}

const VISIBILITY_WARNING = 'toBeVisible({ timeout: 15000 })';
const LINK_WARNING = 'toHaveURL';
const GOTO_WAIT_WARNING = "waitUntil: 'domcontentloaded'";
const GOTO_TIMEOUT_WARNING = 'explicit navigation timeout';
const HTTPS_WARNING = 'ignoreHTTPSErrors';

function warningRequests(warnings, marker) {
  return (warnings || []).some((warning) => typeof warning === 'string' && warning.includes(marker));
}

function isApplicableQualityWarning(warning) {
  return typeof warning === 'string' && (
    warning.includes(VISIBILITY_WARNING) ||
    warning.includes(LINK_WARNING) ||
    warning.includes(GOTO_WAIT_WARNING) ||
    warning.includes(GOTO_TIMEOUT_WARNING) ||
    warning.includes(HTTPS_WARNING)
  );
}

function lastCodeLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) return lines[i];
  }
  return '';
}

function nextCodeLine(lines, start) {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim()) return lines[i];
  }
  return '';
}

function actionFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('await ') || trimmed.startsWith('await expect(')) return null;
  const body = trimmed.replace(/^await\s+/, '').replace(/;\s*$/, '');
  const helper = body.match(/^clickVisible(?:Element|Button)\((.*)\)$/);
  if (helper) return { locator: helper[1].trim(), click: true };
  const methods = ['dblclick', 'click', 'uncheck', 'check', 'hover', 'press', 'fill', 'tap'];
  for (const method of methods) {
    const token = `.${method}(`;
    const idx = body.lastIndexOf(token);
    if (idx <= 0) continue;
    return {
      locator: body.slice(0, idx).trim(),
      click: method === 'click' || method === 'dblclick'
    };
  }
  return null;
}

function hasVisibilityExpect(line, locator) {
  if (!line) return false;
  const compact = (value) => value.replace(/\s+/g, '');
  const current = compact(line);
  const target = compact(locator);
  return current.includes(compact(`expect(${target}).toBeVisible({timeout:15000})`))
    || current.includes(compact(`expect(${target}).toBeVisible({timeout:20000})`));
}

function addInteractionCorrections(spec, warnings) {
  const wantVisible = warningRequests(warnings, VISIBILITY_WARNING);
  const wantLink = warningRequests(warnings, LINK_WARNING);
  if (!wantVisible && !wantLink) return spec;
  const lines = spec.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const action = actionFromLine(line);
    const indent = (line.match(/^\s*/) || [''])[0];
    const usesRole = action && /getByRole\s*\(/.test(action.locator);
    if (wantVisible && usesRole && !hasVisibilityExpect(lastCodeLine(out), action.locator)) {
      out.push(`${indent}await expect(${action.locator}).toBeVisible({ timeout: 15000 });`);
    }
    out.push(line);
    const isLinkClick = wantLink && usesRole && action.click && /getByRole\s*\(\s*['"`]link['"`]/.test(action.locator);
    if (isLinkClick && !/toHaveURL\s*\(/.test(nextCodeLine(lines, i + 1))) {
      out.push(`${indent}await expect(page).toHaveURL(/.+/, { timeout: 15000 });`);
    }
  }
  return out.join('\n');
}

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
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth = Math.max(0, depth - 1); continue; }
    if (ch === ',' && depth === 0) {
      parts.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parsePageGoto(line) {
  const openMatch = line.match(/^(\s*)await\s+page\.goto\(/);
  if (!openMatch) return null;
  const open = openMatch[0].length;
  let depth = 1;
  let quote = null;
  let escaped = false;
  let i = open;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  return {
    indent: openMatch[1],
    args: line.slice(open, i),
    tail: line.slice(i + 1)
  };
}

function addGotoCorrections(spec, warnings) {
  const wantWait = warningRequests(warnings, GOTO_WAIT_WARNING);
  const wantTimeout = warningRequests(warnings, GOTO_TIMEOUT_WARNING);
  if (!wantWait && !wantTimeout) return spec;
  return spec.split('\n').map((line) => {
    const parsed = parsePageGoto(line);
    if (!parsed) return line;
    const args = splitTopLevelArgs(parsed.args);
    if (!args.length) return line;
    const additions = [];
    const options = args.length > 1 ? args[args.length - 1] : '';
    const hasOptions = options.startsWith('{') && options.endsWith('}');
    if (wantWait && !/waitUntil\s*:/.test(hasOptions ? options : '')) additions.push("waitUntil: 'domcontentloaded'");
    if (wantTimeout && !/timeout\s*:/.test(hasOptions ? options : '')) additions.push('timeout: 30000');
    if (!additions.length) return line;
    if (!hasOptions) {
      return `${parsed.indent}await page.goto(${args.join(', ')}, { ${additions.join(', ')} });`;
    }
    const inner = options.slice(1, -1).trim();
    const merged = inner ? `${inner}, ${additions.join(', ')}` : additions.join(', ');
    const urlArgs = args.slice(0, -1).join(', ');
    return `${parsed.indent}await page.goto(${urlArgs}, { ${merged} });`;
  }).join('\n');
}

function addHttpsCorrection(spec, warnings) {
  if (!warningRequests(warnings, HTTPS_WARNING)) return spec;
  if (/ignoreHTTPSErrors\s*:\s*true/.test(spec)) return spec;
  if (/ignoreHTTPSErrors\s*:\s*false/.test(spec)) {
    return spec.replace(/(ignoreHTTPSErrors\s*:\s*)false/, '$1true');
  }
  if (/test\.use\s*\(\s*\{/.test(spec)) {
    return spec.replace(/test\.use\s*\(\s*\{/, 'test.use({\n  ignoreHTTPSErrors: true,');
  }
  const block = 'test.use({\n  ignoreHTTPSErrors: true\n});\n';
  const importMatch = spec.match(/(import\s*\{[^}]+\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?|const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?[ \t]*\n?)/);
  if (!importMatch) return `${block}\n${spec}`;
  const insertAt = spec.indexOf(importMatch[1]) + importMatch[1].length;
  return `${spec.slice(0, insertAt)}\n${block}\n${spec.slice(insertAt).replace(/^\n+/, '')}`;
}

/**
 * Apply only the recommended corrections present in the latest Results.
 * Preview and Test recorded test each contribute their own warning list.
 * @param {string} specContent
 * @param {string[]} qualityWarnings
 * @returns {{ specContent: string, applied: string[], unchanged: { warning: string, reason: string }[] }}
 */
function applyQualityCorrections(specContent, qualityWarnings) {
  const requested = [];
  const seen = new Set();
  (Array.isArray(qualityWarnings) ? qualityWarnings : []).forEach((warning) => {
    if (typeof warning !== 'string' || !warning.trim() || seen.has(warning)) return;
    seen.add(warning);
    requested.push(warning);
  });
  const before = typeof specContent === 'string' ? specContent : '';
  let spec = before;
  spec = addInteractionCorrections(spec, requested);
  spec = addGotoCorrections(spec, requested);
  spec = addHttpsCorrection(spec, requested);
  if (spec !== before && /\bexpect\s*\(/.test(spec)) {
    const { ensureExpectImport } = require('./recordedSpecTemplate');
    spec = ensureExpectImport(spec);
  }
  const beforeWarnings = new Set(analyzeSpecQuality(before));
  const afterWarnings = new Set(analyzeSpecQuality(spec));
  const applied = [];
  const unchanged = [];
  requested.forEach((warning) => {
    if (beforeWarnings.has(warning) && !afterWarnings.has(warning)) {
      applied.push(warning);
      return;
    }
    if (!isApplicableQualityWarning(warning)) {
      unchanged.push({ warning, reason: 'manual' });
      return;
    }
    unchanged.push({ warning, reason: afterWarnings.has(warning) ? 'unmatched' : 'already' });
  });
  return { specContent: spec, applied, unchanged };
}

module.exports = {
  validateSpecContent,
  analyzeSpecQuality,
  applyQualityCorrections,
  isApplicableQualityWarning
};

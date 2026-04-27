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

module.exports = { validateSpecContent, analyzeSpecQuality };

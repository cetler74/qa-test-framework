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

module.exports = { validateSpecContent };

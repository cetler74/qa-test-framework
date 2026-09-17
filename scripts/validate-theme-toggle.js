const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const handlerStart = source.indexOf("themeToggle.addEventListener('click'");
const handlerEnd = source.indexOf('\n    });', handlerStart);

assert(handlerStart >= 0 && handlerEnd > handlerStart, 'Could not locate the theme toggle handler.');

const handler = source.slice(handlerStart, handlerEnd);
assert(handler.includes('localStorage.setItem'), 'Theme preference must remain persisted.');
assert(handler.includes('applyTheme(newTheme)'), 'Theme must be applied in place.');
assert(!handler.includes('location.reload'), 'Theme toggle must not reload the page.');

console.log('Theme toggle preserves the current page and applies the theme in place.');
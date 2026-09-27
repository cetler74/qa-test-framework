const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PAGES = 20;
const MAX_DEPTH = 3;
const MAX_SMOKES = 30;
const MAX_JOURNEYS = 8;
const MAX_CONTROLS_PER_PAGE = 80;
const MAX_TABS_PER_PAGE = 8;
const STORAGE_STATE_MAX_CHARS = 80 * 1024;
const STEP_MARKER = 'qa-discover-steps';

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_eid$|mc_cid$|igshid$|gbraid$|wbraid$)/i;
const DOWNLOAD_HREF = /\.(pdf|zip|csv|xlsx?|docx?|pptx?|png|jpe?g|gif|svg|webp|mp4|mp3|dmg|exe)(\?|#|$)/i;
const DESTRUCTIVE_PATTERNS = [
  /log\s*out/i,
  /sign\s*out/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /pagar agora/i,
  /\bpagar\b/i,
  /limpar tudo/i,
  /\bwipe\b/i,
  /unsubscribe/i,
  /\bdownload\b/i,
  /accept(?: all)? cookies/i,
  /reject(?: all)? cookies/i,
  /aceitar cookies/i,
  /rejeitar cookies/i
];

const STEP_TYPES = new Set(['open', 'reach', 'activate', 'fill', 'check']);
const CHECKS = new Set(['url', 'dialog', 'tab', 'results', 'outcome']);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function jsString(value) {
  return `'${String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ').slice(0, 300)}'`;
}

function normalizeDiscoverUrl(input, base) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || /^(mailto:|tel:|javascript:|data:)/i.test(trimmed)) return null;
  let url;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  const keys = [...url.searchParams.keys()].sort();
  const next = new URLSearchParams();
  keys.forEach((key) => {
    url.searchParams.getAll(key).forEach((value) => next.append(key, value));
  });
  url.search = next.toString() ? `?${next.toString()}` : '';
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.pathname = pathname;
  return url.toString();
}

function isSkippableHref(href) {
  if (!href || typeof href !== 'string') return true;
  const trimmed = href.trim();
  if (!trimmed) return true;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(trimmed)) return true;
  if (trimmed.startsWith('#')) return true;
  return DOWNLOAD_HREF.test(trimmed);
}

function isSameOrigin(url, originOrUrl) {
  try {
    return new URL(url).origin === new URL(originOrUrl).origin;
  } catch (_) {
    return false;
  }
}

function isDestructiveName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldEnqueue(href, baseUrl) {
  if (isSkippableHref(href)) return false;
  const next = normalizeDiscoverUrl(href, baseUrl);
  if (!next) return false;
  return isSameOrigin(next, baseUrl);
}

function createQueueState(startUrl, options = {}) {
  const origin = normalizeDiscoverUrl(startUrl);
  const maxPages = clampInt(options.maxPages, 1, MAX_PAGES, MAX_PAGES);
  const maxDepth = clampInt(options.maxDepth, 0, MAX_DEPTH, MAX_DEPTH);
  return {
    origin,
    maxPages,
    maxDepth,
    seen: new Set(origin ? [origin] : []),
    queue: origin ? [{ url: origin, depth: 0, status: 'queued', referrer: null }] : [],
    visited: []
  };
}

function enqueueLinks(state, fromUrl, fromDepth, hrefs) {
  const added = [];
  if (!state || !state.origin) return added;
  const list = Array.isArray(hrefs) ? hrefs : [];
  for (const href of list) {
    if (state.visited.length + state.queue.length >= state.maxPages) break;
    if (fromDepth >= state.maxDepth) break;
    if (!shouldEnqueue(href, state.origin)) continue;
    const next = normalizeDiscoverUrl(href, state.origin);
    if (!next || state.seen.has(next)) continue;
    state.seen.add(next);
    const item = { url: next, depth: fromDepth + 1, status: 'queued', referrer: fromUrl || null };
    state.queue.push(item);
    added.push(item);
  }
  return added;
}

/**
 * Pure BFS over a map of page URL -> outgoing hrefs.
 * Used by the crawl and by the offline validator.
 */
function expandQueue(startUrl, outgoingByUrl, options = {}) {
  const state = createQueueState(startUrl, options);
  const graph = outgoingByUrl && typeof outgoingByUrl === 'object' ? outgoingByUrl : {};
  while (state.queue.length && state.visited.length < state.maxPages) {
    const job = state.queue.shift();
    if (job.depth > state.maxDepth) continue;
    const visited = { url: job.url, depth: job.depth, status: 'visited', referrer: job.referrer };
    state.visited.push(visited);
    if (job.depth >= state.maxDepth) continue;
    enqueueLinks(state, job.url, job.depth, graph[job.url] || []);
  }
  return state.visited;
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function locatorFor(role, name) {
  return `getByRole(${jsString(role)}, { name: ${jsString(name)} })`;
}

function dedupeKey(item) {
  return `${item.role || ''}|${item.name || ''}|${item.pageUrl || ''}`;
}

function suggestSmokes(items, options = {}) {
  const maxSmokes = clampInt(options.maxSmokes, 1, MAX_SMOKES, MAX_SMOKES);
  const seen = new Set();
  const smokes = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.destructive || isDestructiveName(item.name)) continue;
    if (item.kind === 'field') continue;
    if (!item.pageUrl || !item.name || !item.role) continue;
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const steps = smokeSteps(item);
    const name = `Smoke: ${item.name}`.slice(0, 180);
    smokes.push({
      name,
      label: 'Smoke',
      base_url: item.pageUrl,
      spec_content: specFromSteps(steps, { name, storageStateUsed: !!options.storageStateUsed }),
      steps,
      pageUrl: item.pageUrl,
      role: item.role,
      controlName: item.name,
      kind: item.kind,
      destructive: false
    });
    if (smokes.length >= maxSmokes) break;
  }
  return smokes;
}

function smokeSteps(item) {
  const steps = [{ type: 'open', url: item.pageUrl }];
  (Array.isArray(item.reach) ? item.reach : []).forEach((reach) => {
    if (!reach || !reach.name) return;
    steps.push({
      type: 'reach',
      reachType: reach.type === 'menu' ? 'menu' : 'tab',
      name: reach.name
    });
  });
  steps.push({ type: 'activate', role: item.role, name: item.name });
  if (item.kind === 'tab') steps.push({ type: 'check', check: 'tab', name: item.name });
  else if (item.kind === 'link') steps.push({ type: 'check', check: 'url' });
  else steps.push({ type: 'check', check: 'outcome' });
  return steps;
}

function suggestJourneys(items, options = {}) {
  const maxJourneys = clampInt(options.maxJourneys, 1, MAX_JOURNEYS, MAX_JOURNEYS);
  const list = Array.isArray(items) ? items : [];
  const journeys = [];
  const login = findLogin(list);
  if (login) journeys.push(journeyFromSteps('Journey: Sign in', login.user.pageUrl, [
    { type: 'open', url: login.user.pageUrl },
    { type: 'fill', role: 'textbox', name: login.user.name, value: '${USERNAME}' },
    { type: 'fill', role: 'textbox', name: login.password.name, value: '${PASSWORD}' },
    { type: 'activate', role: login.submit.role || 'button', name: login.submit.name },
    { type: 'check', check: 'outcome' }
  ], options));

  const tabsByPage = new Map();
  list.forEach((item) => {
    if (!item || item.kind !== 'tab' || item.destructive || isDestructiveName(item.name) || !item.pageUrl || !item.name) return;
    if (!tabsByPage.has(item.pageUrl)) tabsByPage.set(item.pageUrl, []);
    const names = tabsByPage.get(item.pageUrl);
    if (!names.includes(item.name)) names.push(item.name);
  });
  for (const [pageUrl, names] of tabsByPage) {
    if (journeys.length >= maxJourneys) break;
    if (names.length < 1) continue;
    const steps = [{ type: 'open', url: pageUrl }];
    names.slice(0, MAX_TABS_PER_PAGE).forEach((name) => {
      steps.push({ type: 'activate', role: 'tab', name });
      steps.push({ type: 'check', check: 'tab', name });
    });
    let path = pageUrl;
    try { path = new URL(pageUrl).pathname || pageUrl; } catch (_) {}
    journeys.push(journeyFromSteps(`Journey: Tabs on ${path}`.slice(0, 180), pageUrl, steps, options));
  }

  if (journeys.length < maxJourneys) {
    const search = findSearch(list);
    if (search) {
      const steps = [
        { type: 'open', url: search.box.pageUrl },
        { type: 'fill', role: search.box.role || 'searchbox', name: search.box.name, value: 'a' }
      ];
      if (search.button) steps.push({ type: 'activate', role: search.button.role || 'button', name: search.button.name });
      steps.push({ type: 'check', check: 'results' });
      journeys.push(journeyFromSteps('Journey: Search', search.box.pageUrl, steps, options));
    }
  }

  if (journeys.length < maxJourneys) {
    const submit = list.find((item) => item && item.kind === 'submit' && !item.destructive && !isDestructiveName(item.name) && item.name && (!login || item !== login.submit));
    if (submit) {
      journeys.push(journeyFromSteps(`Journey: Submit ${submit.name}`.slice(0, 180), submit.pageUrl, [
        { type: 'open', url: submit.pageUrl },
        { type: 'activate', role: submit.role || 'button', name: submit.name },
        { type: 'check', check: 'outcome' }
      ], options));
    }
  }

  return journeys.slice(0, maxJourneys);
}

function journeyFromSteps(name, baseUrl, steps, options) {
  return {
    name,
    label: 'Journey',
    base_url: baseUrl,
    steps,
    spec_content: specFromSteps(steps, { name, storageStateUsed: !!(options && options.storageStateUsed) })
  };
}

function findLogin(items) {
  const password = items.find((item) => item && item.kind === 'field' && /password|palavra-passe|senha/i.test(item.name || ''));
  if (!password) return null;
  const user = items.find((item) => item && item !== password && item.kind === 'field' && item.pageUrl === password.pageUrl && /user|email|e-mail|login|utilizador/i.test(item.name || ''));
  const submit = items.find((item) => item && item.pageUrl === password.pageUrl && !item.destructive && !isDestructiveName(item.name) && (item.kind === 'submit' || item.kind === 'button') && /log\s*in|sign\s*in|entrar|submit|continuar/i.test(item.name || ''));
  if (!user || !submit) return null;
  return { user, password, submit };
}

function findSearch(items) {
  const box = items.find((item) => item && item.kind === 'field' && (item.role === 'searchbox' || /search|filter|pesquisar/i.test(item.name || '')));
  if (!box) return null;
  const button = items.find((item) => item && item.pageUrl === box.pageUrl && !item.destructive && !isDestructiveName(item.name) && (item.kind === 'button' || item.kind === 'submit') && /search|filter|pesquisar/i.test(item.name || ''));
  return { box, button: button || null };
}

function isStep(step) {
  if (!step || typeof step !== 'object') return false;
  if (!STEP_TYPES.has(step.type)) return false;
  if (step.type === 'open') return typeof step.url === 'string' && !!step.url;
  if (step.type === 'reach') return typeof step.name === 'string' && !!step.name;
  if (step.type === 'activate' || step.type === 'fill') return typeof step.role === 'string' && typeof step.name === 'string' && !!step.name;
  if (step.type === 'check') return CHECKS.has(step.check);
  return false;
}

function specFromSteps(steps, options = {}) {
  const list = (Array.isArray(steps) ? steps : []).filter(isStep);
  const name = cleanName(options.name) || 'Discovered flow';
  const header = options.storageStateUsed
    ? '// Later runs still need ${USERNAME} / ${PASSWORD} or a Codegen recording. This crawl signed in with details that are not saved on the test.\n'
    : '';
  const marker = `// ${STEP_MARKER}: ${JSON.stringify(list)}`;
  const lines = list.map(renderStep).filter(Boolean);
  return `const { test, expect } = require('@playwright/test');

${header}${marker}
test(${jsString(name)}, async ({ page }) => {
  const pageErrors = [];
  const serverErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  page.on('response', (res) => { if (res.status() >= 500) serverErrors.push(res.url()); });
  let urlBefore = '';
  let serverErrorsBefore = 0;
${lines.join('\n')}
  expect(pageErrors, 'the page should not throw').toEqual([]);
});
`;
}

function renderStep(step) {
  if (step.type === 'open') {
    return `  await page.goto(${jsString(step.url)}, { waitUntil: 'domcontentloaded', timeout: 60000 });`;
  }
  if (step.type === 'reach') {
    const role = step.reachType === 'menu' ? 'button' : 'tab';
    return `  await page.getByRole(${jsString(role)}, { name: ${jsString(step.name)} }).click();`;
  }
  if (step.type === 'fill') {
    return `  await page.getByRole(${jsString(step.role)}, { name: ${jsString(step.name)} }).fill(${jsString(step.value || '')});`;
  }
  if (step.type === 'activate') {
    const locator = `page.getByRole(${jsString(step.role)}, { name: ${jsString(step.name)} })`;
    return [
      '  urlBefore = page.url();',
      '  serverErrorsBefore = serverErrors.length;',
      `  await expect(${locator}).toBeVisible();`,
      `  await expect(${locator}).toBeEnabled();`,
      `  await ${locator}.click();`
    ].join('\n');
  }
  if (step.type === 'check') return renderCheck(step);
  return '';
}

function renderCheck(step) {
  const serverLine = "  expect(serverErrors.slice(serverErrorsBefore), 'the action should not produce a new server error').toEqual([]);";
  if (step.check === 'url') {
    return `  expect(page.url(), 'the page URL should change').not.toBe(urlBefore);\n${serverLine}`;
  }
  if (step.check === 'dialog') {
    return `  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog')).first()).toBeVisible();\n${serverLine}`;
  }
  if (step.check === 'tab') {
    return `  await expect(page.getByRole('tab', { name: ${jsString(step.name || '')}, selected: true })).toBeVisible();\n${serverLine}`;
  }
  if (step.check === 'results') {
    return `  await expect(page.getByRole('main').or(page.getByRole('list')).or(page.getByRole('table')).first()).toBeVisible();\n${serverLine}`;
  }
  return [
    '  const urlChanged = page.url() !== urlBefore;',
    "  const dialogVisible = await page.getByRole('dialog').count();",
    "  const tabSelected = await page.getByRole('tab', { selected: true }).count();",
    "  expect(urlChanged || dialogVisible > 0 || tabSelected > 0, 'the action should change the URL, open a dialog, or select a tab').toBeTruthy();",
    serverLine
  ].join('\n');
}

function stepsFromSpec(specContent) {
  if (typeof specContent !== 'string') return null;
  const marker = `// ${STEP_MARKER}: `;
  const start = specContent.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  if (specContent[jsonStart] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = jsonStart; i < specContent.length; i += 1) {
    const ch = specContent[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(specContent.slice(jsonStart, i + 1));
          if (!Array.isArray(parsed) || !parsed.length) return null;
          const steps = parsed.filter(isStep);
          return steps.length ? steps : null;
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function annotateInventory(raw, pageUrl, reach) {
  const name = cleanName(raw && raw.name);
  if (!name) return null;
  const kind = ['button', 'tab', 'link', 'submit', 'field'].includes(raw.kind) ? raw.kind : 'button';
  const role = cleanName(raw.role) || (kind === 'link' ? 'link' : kind === 'tab' ? 'tab' : kind === 'field' ? 'textbox' : 'button');
  return {
    pageUrl,
    role,
    name,
    locator: locatorFor(role, name),
    reach: Array.isArray(reach) ? reach.map((entry) => ({
      type: entry && entry.type === 'menu' ? 'menu' : 'tab',
      name: cleanName(entry && entry.name)
    })).filter((entry) => entry.name) : [],
    destructive: isDestructiveName(name),
    kind
  };
}

async function readPageInventory(page) {
  return page.evaluate(() => {
    function visible(el) {
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }
    function labelFor(el) {
      return (el.getAttribute('aria-label') || el.innerText || el.getAttribute('value') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    }
    const controls = [];
    const links = [];
    document.querySelectorAll('a[href]').forEach((el) => {
      const href = el.getAttribute('href');
      if (href) links.push(href);
      if (!visible(el)) return;
      controls.push({ role: 'link', kind: 'link', name: labelFor(el) });
    });
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      if (!visible(el)) return;
      const type = (el.getAttribute('type') || '').toLowerCase();
      const kind = type === 'submit' ? 'submit' : 'button';
      controls.push({ role: 'button', kind, name: labelFor(el) });
    });
    document.querySelectorAll('[role="tab"]').forEach((el) => {
      if (!visible(el)) return;
      controls.push({ role: 'tab', kind: 'tab', name: labelFor(el) });
    });
    document.querySelectorAll('input[type="search"], [role="searchbox"], input[type="email"], input[type="password"], input[type="text"], textarea').forEach((el) => {
      if (!visible(el)) return;
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role') || (type === 'search' ? 'searchbox' : 'textbox');
      const kindName = type === 'password' ? (labelFor(el) || 'Password') : labelFor(el);
      controls.push({ role, kind: 'field', name: kindName });
    });
    return { controls, links };
  });
}

function mergeControls(bucket, rawControls, pageUrl, reach) {
  rawControls.forEach((raw) => {
    if (bucket.length >= MAX_CONTROLS_PER_PAGE) return;
    const item = annotateInventory(raw, pageUrl, reach);
    if (!item) return;
    const key = `${item.kind}|${dedupeKey(item)}|${JSON.stringify(item.reach)}`;
    if (bucket.some((existing) => `${existing.kind}|${dedupeKey(existing)}|${JSON.stringify(existing.reach)}` === key)) return;
    if (item.kind !== 'field' && bucket.some((existing) => existing.kind !== 'field' && dedupeKey(existing) === dedupeKey(item) && !(existing.reach || []).length)) return;
    bucket.push(item);
  });
}

async function clickNamed(page, role, name) {
  const locator = page.getByRole(role, { name, exact: true });
  if (await locator.count()) {
    await locator.first().click({ timeout: 2000 });
    return;
  }
  await page.getByRole(role, { name }).first().click({ timeout: 2000 });
}

async function visitPage(page, job) {
  const pageErrors = [];
  const serverErrors = [];
  const onPageError = (err) => pageErrors.push(String((err && err.message) || err).slice(0, 300));
  const onResponse = (res) => {
    if (res.status() >= 500) serverErrors.push({ status: res.status(), url: res.url() });
  };
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) {
      return {
        page: {
          url: job.url,
          finalUrl: job.url,
          depth: job.depth,
          status: 'failed',
          referrer: job.referrer,
          title: '',
          serverErrors: serverErrors.slice(0, 20),
          pageErrors: [String(lastError.message || lastError).slice(0, 300)]
        },
        items: [],
        links: []
      };
    }
    await page.waitForTimeout(400);
    let title = '';
    let finalUrl = job.url;
    let initial = { controls: [], links: [] };
    try {
      title = await page.title();
      finalUrl = page.url();
      initial = await readPageInventory(page);
    } catch (err) {
      return {
        page: {
          url: job.url,
          finalUrl,
          depth: job.depth,
          status: 'failed',
          referrer: job.referrer,
          title: '',
          serverErrors: serverErrors.slice(0, 20),
          pageErrors: pageErrors.concat(String(err.message || err).slice(0, 300)).slice(0, 20)
        },
        items: [],
        links: []
      };
    }
    const items = [];
    mergeControls(items, initial.controls, finalUrl || job.url, []);
    const menu = items.find((item) => item.kind === 'button' && /^(menu|open menu|navigation)$/i.test(item.name) && !item.destructive);
    if (menu) {
      try {
        await clickNamed(page, 'button', menu.name);
        await page.waitForTimeout(200);
        const opened = await readPageInventory(page);
        mergeControls(items, opened.controls, finalUrl || job.url, [{ type: 'menu', name: menu.name }]);
      } catch (_) { /* menu did not open; keep the base inventory */ }
    }
    const tabNames = [];
    items.forEach((item) => {
      if (item.kind === 'tab' && item.name && !tabNames.includes(item.name)) tabNames.push(item.name);
    });
    for (const tabName of tabNames.slice(0, MAX_TABS_PER_PAGE)) {
      try {
        await clickNamed(page, 'tab', tabName);
        await page.waitForTimeout(200);
        const panel = await readPageInventory(page);
        mergeControls(items, panel.controls, finalUrl || job.url, [{ type: 'tab', name: tabName }]);
      } catch (_) { /* this tab did not activate; continue the inventory */ }
    }
    return {
      page: {
        url: job.url,
        finalUrl: finalUrl || job.url,
        depth: job.depth,
        status: 'visited',
        referrer: job.referrer,
        title: cleanName(title).slice(0, 180),
        serverErrors: serverErrors.slice(0, 20),
        pageErrors: pageErrors.slice(0, 20)
      },
      items,
      links: initial.links
    };
  } finally {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }
}

function parseStorageState(storageState) {
  if (storageState == null || storageState === '') return null;
  let value = storageState;
  if (typeof value === 'string') {
    if (value.length > STORAGE_STATE_MAX_CHARS) {
      const error = new Error('storageState is too large');
      error.status = 400;
      throw error;
    }
    try { value = JSON.parse(value); } catch (_) {
      const error = new Error('storageState must be JSON');
      error.status = 400;
      throw error;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('storageState must be a JSON object');
    error.status = 400;
    throw error;
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > STORAGE_STATE_MAX_CHARS) {
    const error = new Error('storageState is too large');
    error.status = 400;
    throw error;
  }
  return serialized;
}

function playwrightProxy(proxy) {
  if (!proxy || !(proxy.http || proxy.https)) return undefined;
  const server = proxy.https || proxy.http;
  const launch = { server };
  if (proxy.bypass && String(proxy.bypass).trim()) launch.bypass = String(proxy.bypass).trim();
  return launch;
}

function readDiscoverCredential(value, label) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    const error = new Error(`${label} must be text`);
    error.status = 400;
    throw error;
  }
  if (value.length > 200) {
    const error = new Error(`${label} is too long`);
    error.status = 400;
    throw error;
  }
  return value;
}

async function signInForDiscover(page, startUrl, username, password) {
  if (!username || !password) return { attempted: false, signedIn: false, message: '' };
  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (_) {
    return { attempted: true, signedIn: false, message: 'Could not open the start page to sign in. The crawl continued without a login.' };
  }
  await page.waitForTimeout(400);
  const passwordInput = page.locator('input[type="password"]:visible');
  if (!(await passwordInput.count())) {
    return { attempted: true, signedIn: false, message: 'No password field was found, so the crawl continued without signing in.' };
  }
  const userInput = page.locator('input[type="email"]:visible, input[type="text"]:visible, input[autocomplete="username"]:visible').first();
  if (!(await userInput.count())) {
    return { attempted: true, signedIn: false, message: 'No username field was found, so the crawl continued without signing in.' };
  }
  await userInput.fill(username);
  await passwordInput.first().fill(password);
  const urlBefore = page.url();
  const typedSubmit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
  const namedSubmit = page.getByRole('button', { name: /log\s*in|sign\s*in|entrar|submit|continuar/i }).first();
  try {
    if (await typedSubmit.count()) await typedSubmit.click({ timeout: 5000 });
    else if (await namedSubmit.count()) await namedSubmit.click({ timeout: 5000 });
    else await passwordInput.first().press('Enter');
  } catch (_) {
    await passwordInput.first().press('Enter').catch(() => {});
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const passwordStillVisible = await page.locator('input[type="password"]:visible').count().catch(() => 1);
  const signedIn = page.url() !== urlBefore || passwordStillVisible === 0;
  return {
    attempted: true,
    signedIn,
    finalUrl: page.url(),
    message: signedIn
      ? 'Signed in for this crawl. The password was not saved.'
      : 'Sign-in stayed on the login form. The crawl continued from the start URL.'
  };
}

async function discoverUi(options = {}) {
  if (options.storageStatePath) {
    const error = new Error('storageStatePath is not accepted');
    error.status = 400;
    throw error;
  }
  const startUrl = normalizeDiscoverUrl(options.url);
  if (!startUrl) {
    const error = new Error('A valid http(s) URL is required');
    error.status = 400;
    throw error;
  }
  const state = createQueueState(startUrl, options);
  const username = readDiscoverCredential(options.username, 'Username').trim();
  const password = readDiscoverCredential(options.password, 'Password');
  if ((username && !password) || (!username && password)) {
    const error = new Error('Enter both a username and a password, or leave both empty');
    error.status = 400;
    throw error;
  }
  const storageJson = parseStorageState(options.storageState);
  const storageStateUsed = !!storageJson || !!(username && password);
  let storageDir = null;
  let browser = null;
  try {
    const { chromium } = require('playwright');
    const playwrightConfig = require('../config/playwright');
    const launchOptions = { headless: true, args: playwrightConfig.launchArgs || [] };
    const proxy = playwrightProxy(options.proxy);
    if (proxy) launchOptions.proxy = proxy;
    browser = await chromium.launch(launchOptions);
    const contextOptions = {
      ignoreHTTPSErrors: true,
      userAgent: playwrightConfig.userAgent
    };
    if (storageJson) {
      storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-discover-'));
      const storageFile = path.join(storageDir, 'storage-state.json');
      fs.writeFileSync(storageFile, storageJson, 'utf8');
      contextOptions.storageState = storageFile;
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const login = await signInForDiscover(page, startUrl, username, password);
    if (login.signedIn && login.finalUrl) {
      const landed = normalizeDiscoverUrl(login.finalUrl);
      if (landed && isSameOrigin(landed, startUrl) && landed !== state.queue[0].url) {
        state.seen.add(landed);
        state.queue = [{ url: landed, depth: 0, status: 'queued', referrer: startUrl }];
      }
    }
    const items = [];
    while (state.queue.length && state.visited.length < state.maxPages) {
      const job = state.queue.shift();
      if (job.depth > state.maxDepth) continue;
      const result = await visitPage(page, job);
      state.visited.push(result.page);
      items.push(...result.items);
      if (result.page.status === 'visited') {
        enqueueLinks(state, job.url, job.depth, result.links);
      }
    }
    const pages = state.visited;
    await context.close();
    return {
      pages,
      items,
      suggestedSmokes: suggestSmokes(items, { storageStateUsed }),
      suggestedJourneys: suggestJourneys(items, { storageStateUsed }),
      login: {
        attempted: !!login.attempted,
        signedIn: !!login.signedIn,
        message: login.message || ''
      },
      caps: { maxPages: state.maxPages, maxDepth: state.maxDepth, maxSmokes: MAX_SMOKES, maxJourneys: MAX_JOURNEYS }
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (storageDir) {
      try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

module.exports = {
  MAX_PAGES,
  MAX_DEPTH,
  MAX_SMOKES,
  MAX_JOURNEYS,
  normalizeDiscoverUrl,
  isSkippableHref,
  isSameOrigin,
  isDestructiveName,
  shouldEnqueue,
  enqueueLinks,
  expandQueue,
  createQueueState,
  suggestSmokes,
  suggestJourneys,
  specFromSteps,
  stepsFromSpec,
  discoverUi,
  parseStorageState
};

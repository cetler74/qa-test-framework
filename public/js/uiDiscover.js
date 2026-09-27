(function() {
  const MAX_SMOKES = 30;
  const MAX_JOURNEYS = 8;
  let review = null;
  let journeyDrafts = [];
  let activeJourneyIndex = null;
  let editorSteps = null;
  let specTimer = null;

  function el(id) { return document.getElementById(id); }

  async function api(endpoint, options) {
    const config = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
    const response = await fetch('/api' + endpoint, config);
    const data = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(data.error || response.statusText || 'Request failed');
    return data;
  }

  function projectId() {
    const value = el('recorded-test-add-to-project') && el('recorded-test-add-to-project').value;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function setStatus(message) {
    const status = el('discover-status');
    if (status) status.textContent = message || '';
  }

  function itemKey(item) {
    return [item.role || '', item.name || '', item.pageUrl || ''].join('|');
  }

  function stepsForItem(item) {
    const steps = [{ type: 'open', url: item.pageUrl }];
    (item.reach || []).forEach(function(reach) {
      if (!reach || !reach.name) return;
      steps.push({ type: 'reach', reachType: reach.type === 'menu' ? 'menu' : 'tab', name: reach.name });
    });
    steps.push({ type: 'activate', role: item.role, name: item.name });
    if (item.kind === 'tab') steps.push({ type: 'check', check: 'tab', name: item.name });
    else if (item.kind === 'link') steps.push({ type: 'check', check: 'url' });
    else steps.push({ type: 'check', check: 'outcome' });
    return steps;
  }

  function discoverLabel(kind) {
    const typed = (el('recorded-test-label') && el('recorded-test-label').value || '').trim();
    const suffix = kind === 'Journey' ? 'Journey' : 'Smoke';
    if (!typed) return suffix;
    return (typed + ' · ' + suffix).slice(0, 120);
  }

  function checkedCount(root) {
    return root ? root.querySelectorAll('input[type="checkbox"]:checked').length : 0;
  }

  async function discover() {
    const id = projectId();
    if (!id) {
      setStatus('Select a project before discovering pages.');
      return;
    }
    const url = (el('recorded-test-codegen-url') && el('recorded-test-codegen-url').value || '').trim();
    if (!url) {
      setStatus('Enter a base URL to discover.');
      return;
    }
    const button = el('discover-ui-btn');
    if (button) button.disabled = true;
    setStatus('Crawling same-origin pages. This can take a minute.');
    const body = {
      url: url,
      projectId: id,
      maxPages: Number(el('discover-max-pages') && el('discover-max-pages').value),
      maxDepth: Number(el('discover-max-depth') && el('discover-max-depth').value)
    };
    const username = (el('discover-username') && el('discover-username').value || '').trim();
    const password = el('discover-password') ? el('discover-password').value : '';
    if ((username && !password) || (!username && password)) {
      setStatus('Enter both a username and a password, or leave both empty.');
      if (button) button.disabled = false;
      return;
    }
    if (username) body.username = username;
    if (password) body.password = password;
    const storageText = (el('discover-storage-state') && el('discover-storage-state').value || '').trim();
    if (storageText) {
      try { body.storageState = JSON.parse(storageText); }
      catch (_) {
        setStatus('Login storage state must be JSON.');
        if (button) button.disabled = false;
        return;
      }
    }
    try {
      review = await api('/playwright-recorded-tests/discover', { method: 'POST', body: body });
      journeyDrafts = (review.suggestedJourneys || []).map(function(journey, index) {
        return {
          index: index,
          name: journey.name,
          label: journey.label || 'Journey',
          base_url: journey.base_url,
          steps: journey.steps || [],
          spec_content: journey.spec_content,
          checked: true
        };
      });
      activeJourneyIndex = null;
      renderReview();
      const pageCount = (review.pages || []).length;
      const failed = (review.pages || []).filter(function(page) { return page.status === 'failed'; }).length;
      const loginNote = review.login && review.login.message ? review.login.message + ' ' : '';
      setStatus(loginNote + 'Found ' + pageCount + ' page' + (pageCount === 1 ? '' : 's') + (failed ? ' (' + failed + ' failed)' : '') + '. Review the list, then create the tests you want.');
      if (window.openRecordedSection) window.openRecordedSection('source');
    } catch (err) {
      setStatus(err.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderReview() {
    const root = el('discover-review');
    if (!root || !review) return;
    root.hidden = false;
    root.replaceChildren();
    const suggested = new Set((review.suggestedSmokes || []).map(function(smoke) {
      return [smoke.role || '', smoke.controlName || '', smoke.pageUrl || ''].join('|');
    }));
    const controls = [];
    const seenControls = new Set();
    (review.items || []).forEach(function(item) {
      if (!item || item.kind === 'field') return;
      const key = itemKey(item);
      if (seenControls.has(key)) return;
      seenControls.add(key);
      controls.push(item);
    });

    const smokeHead = document.createElement('div');
    smokeHead.className = 'recorded-test-discover-head';
    const smokeTitle = document.createElement('h3');
    smokeTitle.textContent = 'Smoke checklist';
    const smokeHint = document.createElement('p');
    smokeHint.textContent = 'Suggested smokes start checked. Destructive controls start unchecked. Cap ' + MAX_SMOKES + '.';
    smokeHead.append(smokeTitle, smokeHint);
    root.appendChild(smokeHead);

    const list = document.createElement('ul');
    list.className = 'discover-checklist';
    list.id = 'discover-smoke-list';
    controls.forEach(function(item) {
      const row = document.createElement('li');
      row.className = 'discover-check-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !item.destructive && suggested.has(itemKey(item));
      box.addEventListener('change', updateActionCounts);
      const name = document.createElement('span');
      name.textContent = item.name || '';
      const page = document.createElement('span');
      page.textContent = item.pageUrl || '';
      const role = document.createElement('span');
      role.className = 'discover-kind';
      role.textContent = (item.role || '') + (item.kind ? ' · ' + item.kind : '');
      row.append(box, name, page, role);
      if (item.destructive) {
        const badge = document.createElement('span');
        badge.className = 'discover-badge';
        badge.textContent = 'Destructive';
        row.appendChild(badge);
      }
      row.dataset.key = itemKey(item);
      list.appendChild(row);
    });
    root.appendChild(list);

    const smokeActions = document.createElement('div');
    smokeActions.className = 'action-bar';
    const smokeButton = document.createElement('button');
    smokeButton.type = 'button';
    smokeButton.className = 'btn btn-primary';
    smokeButton.id = 'discover-create-smokes';
    smokeButton.addEventListener('click', createSmokes);
    smokeActions.appendChild(smokeButton);
    root.appendChild(smokeActions);

    const journeyHead = document.createElement('div');
    journeyHead.className = 'recorded-test-discover-head';
    const journeyTitle = document.createElement('h3');
    journeyTitle.textContent = 'Journeys';
    const journeyHint = document.createElement('p');
    journeyHint.textContent = 'Edit a journey as linked steps before saving. Cap ' + MAX_JOURNEYS + '.';
    journeyHead.append(journeyTitle, journeyHint);
    root.appendChild(journeyHead);

    const journeys = document.createElement('ul');
    journeys.className = 'discover-journey-list';
    journeys.id = 'discover-journey-list';
    journeyDrafts.forEach(function(journey, index) {
      const row = document.createElement('li');
      row.className = 'discover-journey-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = journey.checked !== false;
      box.addEventListener('change', function() {
        journey.checked = box.checked;
        updateActionCounts();
      });
      const name = document.createElement('span');
      name.textContent = journey.name;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-secondary';
      edit.textContent = 'Edit';
      edit.addEventListener('click', function() { editJourney(index); });
      row.append(box, name, edit);
      journeys.appendChild(row);
    });
    root.appendChild(journeys);

    const journeyActions = document.createElement('div');
    journeyActions.className = 'action-bar';
    const journeyButton = document.createElement('button');
    journeyButton.type = 'button';
    journeyButton.className = 'btn btn-primary';
    journeyButton.id = 'discover-create-journeys';
    journeyButton.addEventListener('click', createJourneys);
    journeyActions.appendChild(journeyButton);
    root.appendChild(journeyActions);
    updateActionCounts();
  }

  function updateActionCounts() {
    const smokes = checkedCount(el('discover-smoke-list'));
    const journeys = journeyDrafts.filter(function(journey) { return journey.checked !== false; }).length;
    const smokeButton = el('discover-create-smokes');
    const journeyButton = el('discover-create-journeys');
    if (smokeButton) smokeButton.textContent = 'Create selected smokes (' + smokes + '/' + MAX_SMOKES + ')';
    if (journeyButton) journeyButton.textContent = 'Create selected journeys (' + journeys + '/' + MAX_JOURNEYS + ')';
  }

  function selectedItems() {
    const selected = [];
    const rows = el('discover-smoke-list') ? el('discover-smoke-list').querySelectorAll('.discover-check-row') : [];
    const byKey = new Map((review.items || []).filter(function(item) { return item.kind !== 'field'; }).map(function(item) {
      return [itemKey(item), item];
    }));
    rows.forEach(function(row) {
      const box = row.querySelector('input[type="checkbox"]');
      if (!box || !box.checked) return;
      const item = byKey.get(row.dataset.key);
      if (item) selected.push(item);
    });
    return selected;
  }

  async function specForSteps(steps, name) {
    const result = await api('/playwright-recorded-tests/discover/spec', {
      method: 'POST',
      body: { steps: steps, name: name }
    });
    return result.spec_content;
  }

  async function createSmokes() {
    const id = projectId();
    if (!id) { setStatus('Select a project before creating tests.'); return; }
    const items = selectedItems();
    if (!items.length) { setStatus('Select at least one smoke.'); return; }
    if (items.length > MAX_SMOKES) { setStatus('Select at most ' + MAX_SMOKES + ' smokes.'); return; }
    const suggestions = new Map((review.suggestedSmokes || []).map(function(smoke) {
      return [[smoke.role || '', smoke.controlName || '', smoke.pageUrl || ''].join('|'), smoke];
    }));
    setStatus('Creating smoke tests…');
    try {
      const tests = [];
      for (const item of items) {
        const suggestion = suggestions.get(itemKey(item));
        const name = suggestion ? suggestion.name : ('Smoke: ' + item.name).slice(0, 180);
        const spec = suggestion ? suggestion.spec_content : await specForSteps(stepsForItem(item), name);
        tests.push({ name: name, label: discoverLabel('Smoke'), spec_content: spec, base_url: item.pageUrl });
      }
      const result = await api('/playwright-recorded-tests/discover/commit', {
        method: 'POST',
        body: { projectId: id, tests: tests }
      });
      if (window.recordedTestEditor) window.recordedTestEditor.refreshLists();
      setStatus('Created ' + result.created.length + ' smoke test' + (result.created.length === 1 ? '' : 's') + ' in this project.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function createJourneys() {
    const id = projectId();
    if (!id) { setStatus('Select a project before creating tests.'); return; }
    if (activeJourneyIndex != null) await flushStepsToSpec();
    const selected = journeyDrafts.filter(function(journey) { return journey.checked !== false; });
    if (!selected.length) { setStatus('Select at least one journey.'); return; }
    if (selected.length > MAX_JOURNEYS) { setStatus('Select at most ' + MAX_JOURNEYS + ' journeys.'); return; }
    setStatus('Creating journey tests…');
    try {
      const tests = [];
      for (const journey of selected) {
        const spec = await specForSteps(journey.steps, journey.name);
        tests.push({ name: journey.name, label: discoverLabel('Journey'), spec_content: spec, base_url: journey.base_url });
      }
      const result = await api('/playwright-recorded-tests/discover/commit', {
        method: 'POST',
        body: { projectId: id, tests: tests }
      });
      if (window.recordedTestEditor) window.recordedTestEditor.refreshLists();
      setStatus('Created ' + result.created.length + ' journey test' + (result.created.length === 1 ? '' : 's') + ' in this project.');
    } catch (err) {
      setStatus(err.message);
    }
  }

  function editJourney(index) {
    const journey = journeyDrafts[index];
    if (!journey) return;
    activeJourneyIndex = index;
    editorSteps = journey.steps.map(function(step) { return Object.assign({}, step); });
    const name = el('recorded-test-name');
    if (name) name.value = journey.name;
    const url = el('recorded-test-codegen-url');
    if (url && journey.base_url) url.value = journey.base_url;
    renderSteps();
    flushStepsToSpec();
  }

  function showStepEditor(show) {
    const list = el('recorded-step-list');
    const empty = el('recorded-step-empty');
    if (list) list.hidden = !show;
    if (empty) empty.hidden = !!show;
    if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries();
  }

  function renderSteps() {
    const list = el('recorded-step-list');
    if (!list || !editorSteps) { showStepEditor(false); return; }
    showStepEditor(true);
    list.replaceChildren();
    editorSteps.forEach(function(step, index) {
      const item = document.createElement('li');
      item.className = 'recorded-step-block';
      const head = document.createElement('div');
      head.className = 'recorded-step-block-head';
      const title = document.createElement('strong');
      title.textContent = stepLabel(step);
      const actions = document.createElement('div');
      actions.className = 'recorded-step-block-actions';
      actions.append(
        stepButton('Up', function() { moveStep(index, -1); }),
        stepButton('Down', function() { moveStep(index, 1); }),
        stepButton('Remove', function() { editorSteps.splice(index, 1); renderSteps(); flushStepsToSpec(); })
      );
      head.append(title, actions);
      item.appendChild(head);
      item.appendChild(fieldsFor(step));
      list.appendChild(item);
    });
    if (window.refreshRecordedSectionSummaries) window.refreshRecordedSectionSummaries();
  }

  function stepLabel(step) {
    if (step.type === 'open') return 'Open page';
    if (step.type === 'reach') return 'Reach';
    if (step.type === 'activate') return 'Activate';
    if (step.type === 'fill') return 'Fill';
    return 'Check';
  }

  function stepButton(text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  function field(labelText, value, onInput) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('input', function() { onInput(input.value); });
    label.appendChild(input);
    return label;
  }

  function selectField(labelText, value, options, onChange) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const select = document.createElement('select');
    options.forEach(function(option) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      if (option.value === value) node.selected = true;
      select.appendChild(node);
    });
    select.addEventListener('change', function() { onChange(select.value); });
    label.appendChild(select);
    return label;
  }

  function fieldsFor(step) {
    const wrap = document.createElement('div');
    if (step.type === 'open') {
      wrap.appendChild(field('URL', step.url, function(value) { step.url = value; scheduleFlush(); }));
    } else if (step.type === 'reach') {
      wrap.appendChild(selectField('Reach', step.reachType || 'tab', [
        { value: 'tab', label: 'Tab' },
        { value: 'menu', label: 'Menu' }
      ], function(value) { step.reachType = value; scheduleFlush(); }));
      wrap.appendChild(field('Name', step.name, function(value) { step.name = value; scheduleFlush(); }));
    } else if (step.type === 'activate' || step.type === 'fill') {
      wrap.appendChild(field('Role', step.role, function(value) { step.role = value; scheduleFlush(); }));
      wrap.appendChild(field('Accessible name', step.name, function(value) { step.name = value; scheduleFlush(); }));
      if (step.type === 'fill') wrap.appendChild(field('Value', step.value, function(value) { step.value = value; scheduleFlush(); }));
    } else {
      wrap.appendChild(selectField('Check', step.check || 'outcome', [
        { value: 'url', label: 'URL changed' },
        { value: 'dialog', label: 'Dialog or panel visible' },
        { value: 'tab', label: 'Tab selected' },
        { value: 'results', label: 'Results visible' },
        { value: 'outcome', label: 'URL, dialog, or tab' }
      ], function(value) { step.check = value; renderSteps(); scheduleFlush(); }));
      if (step.check === 'tab') wrap.appendChild(field('Tab name', step.name, function(value) { step.name = value; scheduleFlush(); }));
    }
    return wrap;
  }

  function moveStep(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= editorSteps.length) return;
    const current = editorSteps[index];
    editorSteps[index] = editorSteps[next];
    editorSteps[next] = current;
    renderSteps();
    flushStepsToSpec();
  }

  function scheduleFlush() {
    clearTimeout(specTimer);
    specTimer = setTimeout(flushStepsToSpec, 250);
  }

  async function flushStepsToSpec() {
    if (!editorSteps || !editorSteps.length || !window.recordedTestEditor) return;
    if (activeJourneyIndex != null && journeyDrafts[activeJourneyIndex]) {
      journeyDrafts[activeJourneyIndex].steps = editorSteps.map(function(step) { return Object.assign({}, step); });
    }
    const name = (el('recorded-test-name') && el('recorded-test-name').value || '').trim() || 'Discovered flow';
    try {
      const spec = await specForSteps(editorSteps, name);
      window.recordedTestEditor.setSpec(spec, { fromDiscover: true });
      if (activeJourneyIndex != null && journeyDrafts[activeJourneyIndex]) {
        journeyDrafts[activeJourneyIndex].spec_content = spec;
      }
    } catch (err) {
      setStatus(err.message);
    }
  }

  function addStep() {
    if (!editorSteps) editorSteps = [];
    const type = (el('recorded-step-add-type') && el('recorded-step-add-type').value) || 'open';
    const url = (el('recorded-test-codegen-url') && el('recorded-test-codegen-url').value || '').trim() || 'https://example.com';
    if (type === 'reach') editorSteps.push({ type: 'reach', reachType: 'tab', name: 'Details' });
    else if (type === 'activate') editorSteps.push({ type: 'activate', role: 'button', name: 'Continue' });
    else if (type === 'check') editorSteps.push({ type: 'check', check: 'outcome' });
    else editorSteps.push({ type: 'open', url: url });
    renderSteps();
    flushStepsToSpec();
  }

  async function previewSteps() {
    const name = el('recorded-test-name');
    if (name && !name.value.trim()) {
      name.value = activeJourneyIndex != null && journeyDrafts[activeJourneyIndex]
        ? journeyDrafts[activeJourneyIndex].name
        : 'Discovered flow';
    }
    if (window.recordedTestEditor) await window.recordedTestEditor.validateDraft('preview');
  }

  async function onSpecLoaded(spec) {
    if (activeJourneyIndex != null) return;
    clearTimeout(specTimer);
    specTimer = setTimeout(function() { loadSteps(spec); }, 300);
  }

  async function loadSteps(spec) {
    if (!spec || !String(spec).trim()) {
      editorSteps = null;
      showStepEditor(false);
      return;
    }
    try {
      const result = await api('/playwright-recorded-tests/discover/steps', {
        method: 'POST',
        body: { spec_content: spec }
      });
      if (!result.steps) {
        editorSteps = null;
        showStepEditor(false);
        return;
      }
      editorSteps = result.steps;
      renderSteps();
    } catch (_) {
      showStepEditor(false);
    }
  }

  function bind() {
    const discoverButton = el('discover-ui-btn');
    const addButton = el('recorded-step-add');
    const previewButton = el('recorded-step-preview');
    if (discoverButton) discoverButton.addEventListener('click', discover);
    if (addButton) addButton.addEventListener('click', addStep);
    if (previewButton) previewButton.addEventListener('click', previewSteps);
    ['discover-username', 'discover-password'].forEach(function(id) {
      const input = el(id);
      if (!input) return;
      input.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        discover();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.UiDiscover = { onSpecLoaded: onSpecLoaded };
})();

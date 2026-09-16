const { test, expect } = require('@playwright/test');

async function showProjectPage(page) {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const loginView = document.getElementById('login-view');
    const app = document.getElementById('app-container');
    if (loginView) loginView.style.display = 'none';
    if (app) app.style.display = 'flex';
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.getElementById('project-detail-view')?.classList.add('active');
  });
  await page.locator('#project-detail-view').waitFor({ state: 'visible' });
}

test.describe('project page workspace', () => {
  test('reflects descendant selection on collapsed test groups', async ({ page }) => {
    await page.goto('/?projectTab=overview');
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <input type="checkbox" class="group-checkbox" data-group-id="test-group-fixture">
        <div id="test-group-fixture" style="display:none">
          <input type="checkbox" class="test-checkbox">
          <input type="checkbox" class="test-checkbox">
        </div>
      `);
      document.querySelectorAll('#test-group-fixture .test-checkbox').forEach((checkbox) => { checkbox.checked = true; });
      window.syncTestGroupCheckboxes();
    });

    const groupCheckbox = page.locator('.group-checkbox[data-group-id="test-group-fixture"]');
    await expect(groupCheckbox).toBeChecked();

    await page.evaluate(() => {
      document.querySelector('#test-group-fixture .test-checkbox').checked = false;
      window.syncTestGroupCheckboxes();
    });
    await expect(groupCheckbox).not.toBeChecked();
    expect(await groupCheckbox.evaluate((checkbox) => checkbox.indeterminate)).toBe(true);
  });

  test('uses edited run variables instead of stored environment values', async ({ page }) => {
    await page.goto('/?projectTab=overview');

    const merged = await page.evaluate(() => window.mergeRunEnvironmentVariables(
      { id: 7, name: 'UAT', phoneNumber: 'stored', endpoint: 'https://stored.example' },
      { phoneNumber: '+351967165925' },
      { phoneNumber: 'duplicate-stored-value' }
    ));

    expect(merged).toEqual({
      phoneNumber: '+351967165925',
      endpoint: 'https://stored.example'
    });
  });

  test('supports keyboard tabs, URL restoration, and mobile containment', async ({ page }) => {
    await page.goto('/?projectTab=overview');
    await showProjectPage(page);

    const tabs = page.getByRole('tablist', { name: 'Project sections' });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

    const testsTab = tabs.getByRole('tab', { name: 'Tests' });
    await testsTab.click();
    await expect(page).toHaveURL(/projectTab=tests/);
    await expect(page.getByRole('tabpanel', { name: 'Tests' })).toBeVisible();

    await testsTab.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/projectTab=runs/);

    await page.reload();
    await showProjectPage(page);
    await expect(tabs.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Runs' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await tabs.getByRole('tab', { name: 'Overview' }).click();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator('.project-overview-kpis')).toHaveCSS('grid-template-columns', /\d+(\.\d+)?px \d+(\.\d+)?px/);
  });

  test('keeps long folder names readable and searchable', async ({ page }) => {
    await page.goto('/?projectTab=tests');
    await showProjectPage(page);
    await page.evaluate(() => {
      window.currentProject = { id: 12, name: 'Project', status: 'active' };
      window.currentProjectTests = [
        { id: 1, name: 'Reachability succeeds', is_active: true, test_type: 'api', effective_folder_path: 'Managed Connectivity/Release 2026/Very Long Reachability Validation Folder', stats: { last_status: 'failed' } },
        { id: 2, name: 'Authentication succeeds', is_active: true, test_type: 'api', effective_folder_path: 'Managed Connectivity/Release 2026/Authentication', stats: { last_status: 'not_run' } },
        { id: 3, name: 'Authentication rejects invalid token', is_active: true, test_type: 'api', effective_folder_path: 'Managed Connectivity/Release 2026/Authentication', stats: { last_status: 'failed' } }
      ];
      window.renderProjectTestsTable(12);
    });

    const folderTree = page.getByRole('complementary', { name: 'Test folders' });
    await expect(folderTree.getByText('Very Long Reachability Validation Folder')).toBeVisible();
    await expect(folderTree.getByText('Managed Connectivity / Release 2026').first()).toBeVisible();
    await expect(folderTree.getByText('1 failed').first()).toBeVisible();
    await expect(folderTree.getByText('1 not run')).toBeVisible();

    await folderTree.getByRole('searchbox', { name: 'Find a folder' }).fill('authentication');
    await expect(folderTree.getByRole('button', { name: /Authentication/ })).toBeVisible();
    await expect(folderTree.getByRole('button', { name: /Very Long Reachability/ })).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test('preserves the test position after a catalogue refresh', async ({ page }) => {
    const tests = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      name: `Catalogue test ${String(index + 1).padStart(2, '0')}`,
      is_active: true,
      test_type: 'api',
      effective_folder_path: 'Release validation',
      stats: { last_status: 'failed' }
    }));
    await page.route('**/api/projects/12/tests/catalogue', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tests.map((item) => item.id === 60
        ? { ...item, stats: { last_status: 'passed' } }
        : item))
    }));
    await page.goto('/?projectTab=tests');
    await showProjectPage(page);
    await page.evaluate((catalogueTests) => {
      window.currentProject = { id: 12, name: 'Project', status: 'active' };
      window.currentProjectTests = catalogueTests;
      window.renderProjectTestsTable(12);
    }, tests);

    const anchorRow = page.locator('#project-tests-table tr[data-project-test-id="60"]');
    await anchorRow.scrollIntoViewIfNeeded();
    const beforeTop = await anchorRow.evaluate((row) => row.getBoundingClientRect().top);

    await page.evaluate(() => window.loadProjectTests(12, {
      preservePosition: true,
      anchorTestId: 60
    }));

    const afterTop = await anchorRow.evaluate((row) => row.getBoundingClientRect().top);
    expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2);
    await expect(anchorRow.getByText('passed')).toBeVisible();
  });

  test('keeps run identities and exposes run and asset actions on Overview', async ({ page }) => {
    await page.goto('/?projectTab=overview');
    await page.evaluate(() => new Promise((resolve, reject) => {
      const stylesheet = document.querySelector('link[href^="/css/styles.css"]');
      if (!stylesheet) {
        reject(new Error('Application stylesheet not found'));
        return;
      }
      stylesheet.addEventListener('load', resolve, { once: true });
      stylesheet.addEventListener('error', reject, { once: true });
      stylesheet.href = `/css/styles.css?e2e=${Date.now()}`;
    }));
    await showProjectPage(page);
    await page.evaluate(() => {
      window.currentProject = { id: 12, name: 'Project', status: 'active' };
      window.projectTestSelection = { projectId: 12, ids: new Set() };
      window.showProjectRunLauncher(12);
    });

    const overviewActions = page.locator('#project-overview-actions');
    await expect(overviewActions.locator('[data-project-run-action]')).toHaveCount(4);
    await expect(overviewActions.locator('[data-project-asset-action]')).toHaveCount(3);
    await expect(overviewActions.locator('[data-project-run-action] svg')).toHaveCount(4);
    await expect(overviewActions.locator('[data-project-asset-action] svg')).toHaveCount(3);
    expect(await overviewActions.evaluate((section) => section === section.parentElement.lastElementChild)).toBe(true);

    const launcher = page.locator('.project-run-launcher');
    await expect(launcher.locator('.project-run-option')).toHaveCount(5);
    await expect(launcher.locator('.project-run-option svg')).toHaveCount(5);
    await expect(launcher.locator('[data-run-kind="selected"]')).toBeDisabled();

    const expectedColors = {
      api: 'rgb(13, 148, 136)',
      ui: 'rgb(99, 102, 241)',
      fuzz: 'rgb(234, 88, 12)',
      soap: 'rgb(139, 92, 246)'
    };
    for (const [kind, color] of Object.entries(expectedColors)) {
      await expect(launcher.locator(`[data-run-kind="${kind}"]`)).toHaveCSS('background-color', color);
      await expect(overviewActions.locator(`[data-project-run-action="${kind}"]`)).toHaveCSS('background-color', color);
    }
  });

  test('matches the project Overview summary layout', async ({ page }) => {
    await page.goto('/?projectTab=overview');
    await showProjectPage(page);
    await page.evaluate(() => {
      const project = { id: 12, name: 'SmartAPI R2.3', status: 'ongoing', visibility: 'private', owner: { username: 'admin' }, updated_at: '2026-08-13T09:10:00Z' };
      window.currentProject = project;
      window.currentProjectCoverageSummary = {
        computed: {
          totalTests: 218,
          coveredNow: 43,
          coveragePct: 20,
          passed: 17,
          failed: 26,
          partial: 0,
          notRun: 175,
          folders: [
            { folder_path: null, total_tests: 16, last_status_counts: { passed: 1, failed: 7 } },
            { folder_path: 'Device reachability', total_tests: 48, last_status_counts: { passed: 4, failed: 5 } },
            { folder_path: 'Location verification', total_tests: 36, last_status_counts: { passed: 8, failed: 4 } },
            { folder_path: 'Number verification', total_tests: 42, last_status_counts: { passed: 5, failed: 2 } },
            { folder_path: 'Authentication', total_tests: 30, last_status_counts: { passed: 2, failed: 1 } },
            { folder_path: 'Provisioning', total_tests: 46, last_status_counts: { passed: 3, failed: 1 } }
          ]
        }
      };
      window.currentProjectRuns = {
        projectId: 12,
        runs: [
          { id: 23, runType: 'api', name: 'Release R2.3 regression', status: 'failed', total_tests: 48, passed_tests: 44, failed_tests: 4, run_by_username: 'admin', created_at: '2026-08-13T09:10:00Z', duration_ms: 188000 },
          { id: 24, runType: 'ui', name: 'Critical user journeys', status: 'passed', total_tests: 6, passed_tests: 6, failed_tests: 0, run_by_username: 'admin', created_at: '2026-08-12T08:00:00Z', duration_ms: 134000 }
        ]
      };
      window.currentProjectSchedules = { projectId: 12, schedules: [{ id: 1, enabled: true, next_run_at: '2026-09-08T08:00:00Z', flow: { name: 'Daily regression' } }] };
      window.renderProjectHeading(project, window.currentProjectRuns.runs);
      window.renderProjectOverview(12);
    });

    await expect(page.locator('.project-detail-breadcrumb')).toContainText('Projects / SmartAPI R2.3');
    await expect(page.locator('.project-detail-title-line')).toContainText('SmartAPI R2.3 On going');
    await expect(page.locator('#project-detail-heading-meta')).toContainText('Owned by admin · Private project · Last activity');
    await expect(page.locator('.project-overview-kpi')).toHaveCount(5);
    await expect(page.locator('.project-overview-kpi.coverage strong')).toHaveText('20%');
    await expect(page.locator('.project-overview-kpi.passed strong')).toHaveCSS('color', 'rgb(16, 185, 129)');
    await expect(page.locator('.project-overview-kpi.failed strong')).toHaveCSS('color', 'rgb(239, 68, 68)');

    await expect(page.locator('.project-overview-run')).toHaveCount(2);
    await expect(page.locator('.project-overview-run').first()).toContainText('API');
    await expect(page.locator('.project-overview-run').first()).toContainText('48 tests · run by admin');
    await expect(page.locator('.project-overview-run').first()).toContainText('4 failed');
    await expect(page.locator('.project-overview-run').first()).toContainText('3m 08s');
    await expect(page.locator('.project-overview-coverage-row')).toHaveCount(5);
    await expect(page.locator('#project-overview-area-coverage')).toContainText('Other areas');
    await expect(page.locator('.project-overview-coverage-track .passed')).toHaveCount(5);
    await expect(page.locator('.project-overview-coverage-track .failed')).toHaveCount(5);
    const firstCoverageRow = page.locator('.project-overview-coverage-row').first();
    const firstCoverageTooltip = firstCoverageRow.locator('[role="tooltip"]');
    await expect(firstCoverageTooltip).toContainText('4 passed');
    await expect(firstCoverageTooltip).toContainText('5 failed');
    await expect(firstCoverageTooltip).toContainText('39 not run');
    await expect(firstCoverageTooltip).toHaveCSS('opacity', '0');
    await firstCoverageRow.hover();
    await expect(firstCoverageTooltip).toHaveCSS('opacity', '1');
    await expect(page.locator('#project-overview-schedule')).toContainText('Daily regression');

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test('searches, selects, reruns, and deletes project runs', async ({ page }) => {
    const runs = [
      { id: 11, runType: 'api', name: 'Release smoke', status: 'passed', passed_tests: 5, failed_tests: 0, can_rerun: true, created_at: '2026-08-13T09:10:00Z' },
      { id: 12, runType: 'ui', name: 'Legacy checkout', status: 'failed', passed_tests: 2, failed_tests: 1, can_rerun: false, rerun_unavailable_reason: 'Quick Resubmit is unavailable for legacy runs.', created_at: '2026-08-12T09:10:00Z' },
      { id: 13, runType: 'fuzz', name: 'Active fuzz', status: 'running', passed_tests: 0, failed_tests: 0, can_rerun: false, rerun_unavailable_reason: 'Running tests cannot be rerun.', created_at: '2026-08-11T09:10:00Z' }
    ];
    let rerunRequested = false;
    let deletePayload = null;
    await page.route('**/api/test-runs?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) }));
    await page.route('**/api/runs/api/11/rerun', (route) => {
      rerunRequested = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ run: { id: 14, name: 'Release smoke re-run: 1', runType: 'api', status: 'running', rerun_number: 1 } }) });
    });
    await page.route('**/api/runs', async (route) => {
      deletePayload = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: [{ runType: 'ui', id: 12 }], skipped: [], message: '1 run deleted.' }) });
    });

    await page.goto('/?projectTab=runs');
    await showProjectPage(page);
    await page.evaluate(() => {
      window.currentProject = { id: 12, name: 'Project', status: 'active' };
      return window.loadProjectRuns(12);
    });

    const table = page.getByRole('table', { name: 'Project test runs' });
    await expect(table.locator('.project-run-row:not(.project-run-row-header)')).toHaveCount(3);
    await expect(table.getByRole('button', { name: 'Quick Resubmit' })).toHaveCount(3);
    await expect(table.getByRole('button', { name: 'Quick Resubmit' }).nth(1)).toBeDisabled();
    await expect(table.getByRole('checkbox', { name: 'Select Active fuzz' })).toBeDisabled();

    await page.getByRole('searchbox', { name: 'Search project runs' }).fill('legacy');
    await expect(table.locator('.project-run-row:not(.project-run-row-header)')).toHaveCount(1);
    await table.getByRole('checkbox', { name: 'Select all visible runs' }).check();
    await expect(page.locator('#project-runs-selection-count')).toHaveText('1 selected');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await expect.poll(() => deletePayload).toEqual({ runs: [{ id: 12, runType: 'ui' }] });

    await page.getByRole('searchbox', { name: 'Search project runs' }).fill('release');
    await table.getByRole('button', { name: 'Quick Resubmit' }).click();
    await expect.poll(() => rerunRequested).toBe(true);
    await expect(page.locator('#project-runs-feedback')).toContainText('Release smoke re-run: 1 started.');
  });
});
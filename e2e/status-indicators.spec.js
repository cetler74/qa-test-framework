const { test, expect } = require('@playwright/test');

async function showView(page, viewId) {
  await page.waitForTimeout(300);
  await page.evaluate((id) => {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }, viewId);
}

test.describe('shared status and run type indicators', () => {
  test('right-aligns a consistently sized project status', async ({ page }) => {
    await page.route('**/api/projects', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 15, name: 'A long production readiness project', description: 'Release verification', status: 'ongoing', visibility: 'private', owner: { username: 'admin' }, apiSpecs: [] }])
    }));
    await page.route('**/api/playwright-recorded-tests', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/');
    await showView(page, 'projects-view');
    await page.evaluate(() => window.loadProjects());

    const row = page.locator('.projects-list-row');
    const status = row.locator('.projects-row-status .status-badge');
    await expect(status).toHaveText('On going');
    await expect(status).toHaveCSS('width', '120px');
    await expect(status).toHaveCSS('height', '28px');
    const positions = await row.evaluate((element) => {
      const title = element.querySelector('.projects-row-main').getBoundingClientRect();
      const badge = element.querySelector('.projects-row-status').getBoundingClientRect();
      return { titleRight: title.right, badgeLeft: badge.left };
    });
    expect(positions.badgeLeft).toBeGreaterThan(positions.titleRight);
  });

  test('keeps global run statuses and types uniform on desktop and mobile', async ({ page }) => {
    await page.goto('/');
    await showView(page, 'test-runs-view');
    await page.evaluate(() => window.renderTestRunsList([
      { id: 1, runType: 'iterations', name: 'Iteration verification', status: 'passed', passed_tests: 9, failed_tests: 0, total_tests: 9, created_at: '2026-09-14T11:51:40Z', project: { name: 'Project' } },
      { id: 2, runType: 'rate_limit', name: 'Rate limit verification with a deliberately long title', status: 'partial_failed', passed_tests: 147, failed_tests: 3, total_tests: 150, created_at: '2026-09-14T11:51:40Z', project: { name: 'Project' } }
    ]));

    const statuses = page.locator('.test-run-list-item .status-badge');
    await expect(statuses).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(statuses.nth(index)).toHaveCSS('width', '120px');
      await expect(statuses.nth(index)).toHaveCSS('height', '28px');
      await expect(statuses.nth(index)).toHaveCSS('white-space', 'nowrap');
    }
    await expect(page.locator('.run-type-badge').first()).toHaveCSS('width', '48px');
    await expect(page.locator('.run-type-badge').first()).toHaveCSS('height', '28px');
    await expect(page.locator('.test-run-list-results').first()).toContainText('9 passed, 0 failed of 9 total');

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(statuses.nth(1)).toBeVisible();
  });
});

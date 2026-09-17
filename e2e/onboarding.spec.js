const { test, expect } = require('@playwright/test');

async function showProjectPage(page) {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.getElementById('project-detail-view').classList.add('active');
    window.currentProject = { id: 12, name: 'Tutorial project', status: 'ongoing' };
    window.currentProjectCoverageSummary = { computed: { totalTests: 0, coveredNow: 0, coveragePct: 0, passed: 0, failed: 0, partial: 0, notRun: 0, folders: [] } };
    window.currentProjectRuns = { projectId: 12, runs: [] };
    window.currentProjectSchedules = { projectId: 12, schedules: [] };
    window.renderProjectHeading(window.currentProject, []);
    window.renderProjectOverview(12);
  });
  await page.locator('#project-detail-view').waitFor({ state: 'visible' });
}

test.describe('guided help', () => {
  test('opens contextual help and guides project setup without running actions', async ({ page }) => {
    const onboardingRequests = [];
    await page.route('**/api/user/onboarding/**', async (route) => {
      onboardingRequests.push({ method: route.request().method(), body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tour_key: 'project-setup', tour_version: '1', status: 'offered', replay_count: 1 })
      });
    });
    await page.goto('/?projectTab=overview');
    await showProjectPage(page);

    await page.getByRole('button', { name: 'Open help for this project section' }).click();
    await expect(page.locator('#help-drawer')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#help-drawer-title')).toHaveText('Project overview');

    await page.getByRole('button', { name: 'Start project setup tutorial' }).click();
    await expect(page.locator('#tour-layer')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#tour-title')).toHaveText('Your project workspace');
    await expect(page.locator('#tour-progress')).toHaveText('1 of 7');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('tab', { name: 'Assets' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tour-title')).toHaveText('Upload a Postman collection');
    await expect(page.locator('#tour-body')).toContainText('API test scripts');
    await expect(page.locator('#tour-body')).toContainText('pm.test');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#tour-title')).toHaveText('Add other API assets');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#tour-title')).toHaveText('Generate and publish JWKS');
    await expect(page.locator('#tour-body')).toContainText('external developer portal');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#tour-title')).toHaveText('Link recorded UI tests');
    await expect(page.locator('#tour-progress')).toHaveText('5 of 7');
    await expect(page.locator('#tour-body')).not.toContainText('not available right now');
    await expect(page.locator('#tour-spotlight')).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tour-title')).toHaveText('Configure environments');
    await expect(page.locator('#tour-progress')).toHaveText('6 of 7');
    await expect(page.locator('#tour-body')).not.toContainText('not available right now');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('#tour-title')).toHaveText('Run and review');
    await expect(page.locator('#tour-progress')).toHaveText('7 of 7');
    await expect(page.locator('#tour-body')).not.toContainText('not available right now');

    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.locator('#tour-layer')).toHaveAttribute('aria-hidden', 'true');
    expect(onboardingRequests.some((request) => request.method === 'POST')).toBe(true);
    expect(onboardingRequests.some((request) => request.method === 'PUT' && request.body.status === 'skipped')).toBe(true);
  });

  test('opens global help for the active primary view', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.getElementById('login-view').style.display = 'none';
      document.getElementById('app-container').style.display = 'flex';
      document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
      document.getElementById('projects-view').classList.add('active');
    });

    await page.getByRole('button', { name: 'Open help' }).click();
    await expect(page.locator('#help-drawer-title')).toHaveText('Projects');
    await expect(page.locator('#help-drawer-points')).toContainText('Create workspaces');
    await expect(page.locator('#help-start-tutorial')).toHaveText('Choose a project to start tutorial');
    await page.locator('#help-start-tutorial').click();
    await expect(page.locator('#help-drawer')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#projects-view')).toHaveClass(/active/);
    await expect(page.locator('#modal-title')).toHaveText('Choose a project');
    await expect(page.locator('#modal-body')).toContainText('Open a project');
  });
});

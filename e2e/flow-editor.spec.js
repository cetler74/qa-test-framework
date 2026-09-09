const { test, expect } = require('@playwright/test');

test('creates a flow and configures ordered API and UI runs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?projectTab=automation');
  await page.evaluate(() => {
    const loginView = document.getElementById('login-view');
    const app = document.getElementById('app-container');
    if (loginView) loginView.style.display = 'none';
    if (app) app.style.display = 'flex';
    const responses = {
      '/projects/12/flows': { id: 91, name: 'Regression flow', description: null },
      '/user/environments': [{ id: 5, name: 'QA', accountToken: 'environment-token', base_url: 'https://qa-api.example' }],
      '/flows/91': { id: 91, name: 'Regression flow', description: null, flowTasks: [] },
      '/projects/12/collections': [{
        id: 3,
        name: 'Accounts API',
        collection_json: {
          variable: [{ key: 'accountToken', value: '' }],
          item: [
            { name: 'Create account', request: { method: 'POST', url: '{{base_url}}/accounts' } },
            { name: 'Read account', request: { method: 'GET', url: '{{base_url}}/accounts/1' } }
          ]
        }
      }],
      '/projects/12/recorded-tests': [
        { id: 7, name: 'Sign in', base_url: 'https://ui.example', variable_names: ['username'] },
        { id: 8, name: 'Open account', base_url: 'https://ui.example', variable_names: ['username'] }
      ]
    };
    window.__flowRequests = [];
    window.apiRequest = async (url, options = {}) => {
      window.__flowRequests.push({ url, options });
      if (options.method === 'PUT') return { ...responses['/flows/91'], flowTasks: options.body.flowTasks };
      return responses[url] || [];
    };
    window.viewProject = () => {};
    window.showCreateFlowModal(12);
  });

  await page.locator('#flow-name').fill('Regression flow');
  await page.locator('#create-flow-form').getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#edit-flow-form')).toBeVisible();
  await expect(page.locator('#modal-overlay .modal')).toHaveClass(/flow-editor-modal/);
  await expect(page.locator('.flow-editor-header-actions').getByRole('button', { name: 'Save Flow' })).toBeVisible();
  await expect(page.locator('#flow-editor-empty-state')).toBeVisible();
  const desktopColumns = await page.locator('.flow-editor-workspace').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(desktopColumns).toBe(2);

  await page.locator('#flow-add-api-run').click();
  await expect(page.locator('#flow-editor-active')).toBeVisible();
  await expect(page.locator('#flow-task-candidates')).toContainText('{{base_url}}/accounts');
  await page.getByText('Create account', { exact: false }).click();
  await page.getByText('Read account', { exact: false }).click();
  await expect(page.locator('#flow-selected-count')).toHaveText('2 selected');
  await page.locator('#flow-task-search').fill('Read account');
  await expect(page.locator('#flow-task-candidates .flow-editor-candidate')).toHaveCount(1);
  await page.locator('#flow-deselect-all-tests').click();
  await expect(page.locator('#flow-selected-count')).toHaveText('1 selected');
  await page.locator('#flow-select-all-tests').click();
  await expect(page.locator('#flow-selected-count')).toHaveText('2 selected');
  await page.getByLabel('Delay after Read account in seconds').fill('2');
  await page.locator('#flow-api-environment').selectOption('5');
  await page.locator('[data-flow-variable="accountToken"]').fill('saved-token');
  await page.locator('#flow-api-delay').fill('1.5');
  await page.locator('#flow-task-config-apply').click();
  await expect(page.locator('#flow-editor-empty-state')).toBeVisible();

  await page.locator('#flow-add-ui-run').click();
  await page.locator('#flow-task-candidates').getByText('Sign in', { exact: true }).click();
  await page.locator('#flow-task-candidates').getByText('Open account', { exact: true }).click();
  await page.locator('[data-flow-variable="username"]').fill('flow-user');
  await page.locator('#flow-ui-browser').selectOption('firefox');
  await page.locator('#flow-ui-timeout').fill('45');
  await page.locator('#flow-ui-video').selectOption('retain-on-failure');
  await page.locator('#flow-task-config-apply').click();

  await expect(page.locator('.flow-task-item')).toHaveCount(2);
  await expect(page.locator('.flow-task-item').first()).toContainText('QA');
  await expect(page.locator('.flow-task-item').nth(1)).toContainText('firefox browser');
  await page.locator('.flow-task-item').first().getByRole('button', { name: 'Configure' }).click();
  await expect(page.locator('#flow-api-environment')).toHaveValue('5');
  await expect(page.locator('[data-flow-variable="accountToken"]')).toHaveValue('saved-token');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    columns: getComputedStyle(document.querySelector('.flow-editor-workspace')).gridTemplateColumns.split(' ').length,
    modalWidth: document.querySelector('.flow-editor-modal').getBoundingClientRect().width
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);
  expect(mobileLayout.columns).toBe(1);
  expect(mobileLayout.modalWidth).toBeLessThanOrEqual(390);
  await expect(page.locator('#flow-task-candidates')).toBeVisible();
  await expect(page.locator('#flow-task-config-apply')).toBeVisible();
  await page.locator('#flow-task-config-cancel').click();
  await expect(page.locator('#flow-editor-empty-state')).toBeVisible();
  await expect(page.locator('.flow-editor-header-actions').getByRole('button', { name: 'Save Flow' })).toBeVisible();
  await page.locator('.flow-editor-header-actions').getByRole('button', { name: 'Save Flow' }).click();

  const payload = await page.evaluate(() => window.__flowRequests.find((request) => request.options.method === 'PUT')?.options.body);
  expect(payload.flowTasks).toHaveLength(2);
  expect(payload.flowTasks[0].task_ref.selectedTestsOrdered.map((test) => test.name)).toEqual(['Create account', 'Read account']);
  expect(payload.flowTasks[0].task_ref.environmentId).toBe(5);
  expect(payload.flowTasks[0].task_ref.environmentName).toBe('QA');
  expect(payload.flowTasks[0].task_ref.envVars).toEqual({ accountToken: 'saved-token', base_url: 'https://qa-api.example' });
  expect(payload.flowTasks[0].task_ref.delayBetweenTests).toBe(1.5);
  expect(payload.flowTasks[0].task_ref.testDelays).toEqual({ 3: { 1: 2 } });
  expect(payload.flowTasks[1].task_ref.selectedTestIds).toEqual([7, 8]);
  expect(payload.flowTasks[1].task_ref.uiVariables).toEqual({ username: 'flow-user' });
  expect(payload.flowTasks[1].task_ref.browserName).toBe('firefox');
  expect(payload.flowTasks[1].task_ref.timeoutMs).toBe(45000);
  expect(payload.flowTasks[1].task_ref.video).toBe('retain-on-failure');
});
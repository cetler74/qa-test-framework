const { test, expect } = require('@playwright/test');

test('Run Tests bulk selection is scoped to the active modal', async ({ page }) => {
  await page.goto('/?projectTab=tests');
  await page.evaluate(() => {
    const loginView = document.getElementById('login-view');
    const app = document.getElementById('app-container');
    if (loginView) loginView.style.display = 'none';
    if (app) app.style.display = 'flex';

    document.body.insertAdjacentHTML('afterbegin', `
      <div id="hidden-ui-selection-controls" style="display:none">
        <button id="select-all-tests">Select all</button>
        <button id="deselect-all-tests">Deselect all</button>
        <input type="checkbox" class="test-checkbox" checked>
      </div>
    `);

    document.getElementById('run-tests-btn').setAttribute('data-project-id', '12');
    window.currentProject = null;
    window.apiRequest = async (url) => {
      if (url === '/projects/12/collections') {
        return [{
          id: 3,
          name: 'Accounts API',
          collection_json: {
            item: [
              { name: 'Create account', request: { method: 'POST', url: 'https://api.example/accounts' } },
              { name: 'Read account', request: { method: 'GET', url: 'https://api.example/accounts/1' } }
            ]
          }
        }];
      }
      return [];
    };
    window.showRunTestsModal();
  });

  await expect(page.locator('#run-tests-form')).toBeVisible();
  await page.locator('#run-mode-select').selectOption('rate_limit');
  const rateLimitCount = page.locator('#rate-limit-count');
  await rateLimitCount.fill('60');
  await expect(rateLimitCount).toHaveValue('60');
  await expect(rateLimitCount).not.toHaveAttribute('max');

  await page.locator('#run-tests-form #collection-select').selectOption('3');
  const modalTests = page.locator('#run-tests-form #test-selection-container .test-checkbox');
  await expect(modalTests).toHaveCount(2);

  await page.locator('#run-tests-form #select-all-tests').click();
  await expect(modalTests.nth(0)).toBeChecked();
  await expect(modalTests.nth(1)).toBeChecked();
  await expect(page.locator('#run-tests-form #selected-tests-count')).toHaveText('2 selected');
  await expect(page.locator('#hidden-ui-selection-controls .test-checkbox')).toBeChecked();

  await page.locator('#run-tests-form #deselect-all-tests').click();
  await expect(modalTests.nth(0)).not.toBeChecked();
  await expect(modalTests.nth(1)).not.toBeChecked();
  await expect(page.locator('#run-tests-form #selected-tests-order')).toBeHidden();
  await expect(page.locator('#hidden-ui-selection-controls .test-checkbox')).toBeChecked();
});
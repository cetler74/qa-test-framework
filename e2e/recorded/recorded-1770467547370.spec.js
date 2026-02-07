import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.meo.pt/empresas');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByLabel('Navegação principal').getByRole('menuitem', { name: 'Connect' }).click();
});
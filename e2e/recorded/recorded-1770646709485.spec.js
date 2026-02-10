import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await expect(page.getByRole('button', { name: 'CONCORDO' })).toBeVisible();
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await expect(page.getByRole('link', { name: 'Device Identifier Device' })).toBeVisible();
  await page.getByRole('link', { name: 'Device Identifier Device' }).click();
  await expect(page.getByText('Funcionalidades Retrieve')).toBeVisible();
});
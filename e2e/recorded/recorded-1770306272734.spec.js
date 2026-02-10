import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('checkbox', { name: 'Quality on Demand' }).check();
  await expect(page.getByRole('link', { name: 'Quality on Demand Quality on' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quality on Demand QoS' })).toBeVisible();
});
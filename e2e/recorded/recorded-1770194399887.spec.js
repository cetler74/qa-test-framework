import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('link', { name: 'Device Location Location Verification Verificar a localização geográfica de um' }).click();
  await expect(page.getByText('Produção', { exact: true })).toBeVisible();
  await page.goto('https://www.meo.pt/');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
});
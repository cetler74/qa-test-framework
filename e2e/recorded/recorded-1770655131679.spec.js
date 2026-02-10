import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('link', { name: 'Device Location Location Retrieval Obter a localização geográfica atual de um' }).click();
  await expect(page.getByText('Visão geral da API CAMARA Location Retrieval A API padronizada CAMARA Location')).toBeVisible();
});
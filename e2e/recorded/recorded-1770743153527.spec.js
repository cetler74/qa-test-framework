import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await expect(page.getByRole('link', { name: 'Device Location Location Verification Verificar a localização geográfica de um' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Device Location Location Retrieval Obter a localização geográfica atual de um' })).toBeVisible();
  await page.getByRole('link', { name: 'Device Location Location Verification Verificar a localização geográfica de um' }).click();
  await expect(page.getByText('Visão geral Visão geral da')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Especificação' })).toBeVisible();
  await page.getByRole('link', { name: 'Especificação' }).click();
  await expect(page.locator('section').nth(3)).toBeVisible();
  await expect(page.locator('hgroup')).toContainText('Device location verification API 0.2.0 OAS 3.0');
  await expect(page.locator('portal-api')).toContainText('Utilização');
  await page.getByRole('link', { name: 'Utilização' }).click();
  await expect(page.locator('section').filter({ hasText: 'Fluxo de autorização A API' }).nth(3)).toBeVisible();
});
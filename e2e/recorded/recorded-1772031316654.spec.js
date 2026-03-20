import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await expect(page.getByRole('link', { name: 'Device Location Location Verification Verificar a localização geográfica de um' })).toBeVisible();
  await page.getByRole('link', { name: 'Device Location Location Verification Verificar a localização geográfica de um' }).click();
  await page.getByRole('link', { name: 'Utilização' }).click();
  await page.getByRole('link', { name: 'Como invocar a API' }).click();
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).fill('fffd');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).click();
  await page.getByRole('textbox', { name: 'Palavra-passe' }).fill('fff');
});
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).fill('carlos.e.larramba@meo.ptc');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).click();
  await page.getByRole('textbox', { name: 'Palavra-passe' }).fill('wvwvrw');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Nome de utilizador ou palavra')).toBeVisible();
});
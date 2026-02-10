import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).fill('carlos.e.larramba@meo.pt');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).click();
  await page.getByRole('textbox', { name: 'Palavra-passe' }).fill('1Mnext"!347405cl74');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'As minhas aplicações' })).toBeVisible();
});
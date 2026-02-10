import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('button', { name: 'Iniciar sessão' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).fill('svddsvsdvd');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).click();
  await page.getByRole('textbox', { name: 'Nome de utilizador' }).fill('svddsvsdvds');
  await page.getByRole('textbox', { name: 'Palavra-passe' }).fill('sdv');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('#input-error-username')).toContainText('Nome de utilizador ou palavra-passe inválida.');
});
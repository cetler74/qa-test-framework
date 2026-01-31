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
  await page.getByRole('link', { name: 'As minhas aplicações' }).click();
  await page.getByRole('button', { name: 'Criar aplicação' }).click();
  await page.getByRole('textbox', { name: 'Nome da aplicação' }).click();
  await page.getByRole('textbox', { name: 'Nome da aplicação' }).fill('Token testes');
  await page.getByRole('textbox', { name: 'Descrição' }).click();
  await page.locator('#lgc-form-field-1 stl-text-input').click();
  await page.getByRole('textbox', { name: 'Descrição' }).fill('testes');
  await page.locator('#lgc-form-field-2 stl-text-input').click();
  await page.getByRole('textbox', { name: 'Nome da credencial' }).fill('token testes');
  await page.locator('button').filter({ hasText: 'Nunca' }).click();
  await page.getByRole('option', { name: '7 dias' }).click();
  await page.getByRole('checkbox', { name: 'Selecionar tudo' }).check();
  await page.getByRole('button', { name: 'Criar' }).click();
});
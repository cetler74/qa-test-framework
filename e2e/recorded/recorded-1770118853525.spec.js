import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.meo.pt/');
  await page.getByText('MAIS OPÇÕESCONCORDO').click();
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('menuitem', { name: 'Ajuda', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ѯ Apoio e Contactos' }).click();
  await page.getByRole('menuitem', { name: 'Ѯ Apoio e Contactos' }).click();
  await page.getByRole('textbox', { name: 'Pesquisar' }).click();
  await page.getByRole('textbox', { name: 'Pesquisar' }).fill('vwrbvwbvwev');
  await page.locator('.bs-webchat-backdrop-base').click();
  await expect(page.getByRole('heading', { name: 'Olá, como podemos ajudar?' })).toBeVisible();
});
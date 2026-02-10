import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://5gapisprint.meoempresas.pt/apis');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.goto('https://www.meo.pt/');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('menuitem', { name: 'Ѯ Apoio e Contactos' }).click();
  await page.getByRole('textbox', { name: 'Pesquisar' }).click();
  await page.getByRole('textbox', { name: 'Pesquisar' }).fill('eerrrrrr');
  await page.getByRole('img', { name: 'Pesquisar' }).click();
  await expect(page.getByRole('heading', { name: 'Resultados de pesquisa para' })).toBeVisible();
});
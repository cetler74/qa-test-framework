import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.google.com/');
  await page.getByRole('button', { name: 'Aceitar tudo' }).click();
  await page.getByRole('combobox', { name: 'Pesq.' }).click();
  await page.getByRole('combobox', { name: 'Pesq.' }).fill('casas');
  await page.locator('iframe[name="a-8wpajuq9mdkt"]').contentFrame().getByRole('checkbox', { name: 'I\'m not a robot' }).click();
});
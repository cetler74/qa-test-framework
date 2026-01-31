import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.meo.pt/');
  await page.getByRole('button', { name: 'CONCORDO' }).click();
  await page.getByRole('menuitem', { name: 'ҩ Em destaque na TV' }).click();
  await expect(page.getByText('Estreia 2 fev.Especial Crime')).toBeVisible();
});
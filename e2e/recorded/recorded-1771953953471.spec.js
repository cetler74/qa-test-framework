import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://smsexpressteste.cloud.meoempresas.pt/smsexpress/');
  await expect(page.getByText('Envie mensagens escritas em')).toBeVisible();
  await page.getByText('Contacte o seu Gestor de').click();
  await page.getByRole('textbox', { name: 'Username' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill('carlos');
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('12dqdqw');
  await page.getByRole('button', { name: 'Entrar' }).click();
});
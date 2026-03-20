import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://smsexpressteste.app.ptlocal/smsexpress/');
  await page.getByRole('textbox', { name: 'Username' }).click();
});
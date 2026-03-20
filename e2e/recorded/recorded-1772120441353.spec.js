import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://bop-meo.uat.m2m.telecom.pt/auth/realms/management.meo/protocol/openid-connect/auth?scope=openid&response_type=code&redirect_uri=https%3A%2F%2Fbop-meo.uat.m2m.telecom.pt%2Fbop%2Fauthentication%2FLogin.action&client_id=portal');
  await page.getByRole('textbox', { name: 'Login' }).click();
});
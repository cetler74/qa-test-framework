import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.uat.camara.prv.alpt.alticelabs.cloud/apis');
});
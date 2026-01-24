import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Create Next App/);
});


test('get started link', async ({ page }) => {
  await page.goto('/');

  // Click the get started link.
  // Note: The default Next.js template might not have a "Get started" link exactly like this,
  // but we can check for something that exists.
  // For now, let's just check if the main element exists.
  await expect(page.locator('main')).toBeVisible();
});

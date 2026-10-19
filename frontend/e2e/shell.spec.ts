import { expect, test } from '@playwright/test';

// A phone-width screen: the masthead title stays clear of the signed-in user, and the
// fake-backend banner wraps inside the viewport.
test.use({ viewport: { width: 390, height: 844 } });

test('the masthead and the fake-backend banner fit a phone-width screen', async ({ page }) => {
  await page.goto('/clusters');
  const banner = page.getByText('Fake backend:');
  await expect(banner).toBeVisible();
  await expect(page.getByTestId('masthead-user')).toContainText('provider admin');

  const title = await page.getByRole('heading', { name: 'Cloud Provider Admin Console' }).boundingBox();
  const user = await page.getByTestId('masthead-user').boundingBox();
  const bar = await banner.boundingBox();
  expect(title && user && bar).toBeTruthy();
  // At least the spacer--sm gap (8px) between them.
  expect(title!.x + title!.width + 8).toBeLessThanOrEqual(user!.x);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(390);
});

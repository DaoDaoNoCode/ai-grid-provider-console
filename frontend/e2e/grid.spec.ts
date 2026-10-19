import { expect, test } from '@playwright/test';

// The fixture AI Grid sites with coordinates (mock/fixtures-poc/managedclusters.json). The map
// can show more pins once other specs enroll another cluster, so the spec checks these by name.
const PINS = ['San Francisco', 'New York', 'Brussels'];

test('shows the fixture pins on the bundled land outline, and a pin opens its details', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/ai-grid');
  const map = page.getByLabel('AI Grid map of clusters');
  // Leaflet briefly duplicates tooltips after load, so these locators take the first match.
  for (const pin of PINS) {
    await expect(map.getByText(pin, { exact: true }).first()).toBeVisible();
  }
  // The outline's paths share the overlay pane with the pins but aren't interactive.
  await expect(
    map.locator('.leaflet-overlay-pane path.fleet-map-land:not(.leaflet-interactive)').first(),
  ).toBeAttached();
  await expect(page.getByText(/basemap/i)).toHaveCount(0);
  const origin = new URL(baseURL!).origin;
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin)).toEqual([]);

  await map.locator('path.leaflet-interactive').first().click({ force: true });
  await expect(page.getByText('Site and cluster')).toBeVisible();
  await expect(page.getByText('Models at this location')).toBeVisible();
  await expect(map.getByText(/ · .* · Ready/).first()).toBeVisible();
});

test('monitoring switches to 24h and opens each tab', async ({ page }) => {
  await page.goto('/monitoring');
  const day = page.getByRole('button', { name: 'Last 24h' });
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Cluster' }).click();
  await expect(page.getByRole('tab', { name: 'Cluster' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Models' }).click();
  await expect(page.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Select model deployment')).toBeVisible();
  await page.getByRole('tab', { name: 'Usage' }).click();
  await expect(page.getByRole('tab', { name: 'Usage' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('table', { name: 'Organization usage' })).toBeVisible();
});

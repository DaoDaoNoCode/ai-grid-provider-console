import { expect, test } from '@playwright/test';

// Fixture organization and model (mock/fixtures-poc/tenants.json, models.json).
const ORGANIZATION = 'acme-robotics';
const MODEL = 'Granite 3.3 8B Instruct';

test('creates, views, edits and deletes a subscription', async ({ page }) => {
  const unique = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const group = `${unique}-team`;
  await page.goto('/subscriptions');
  await page.getByRole('link', { name: 'Create subscription' }).click();

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(unique);
  await page.getByRole('combobox', { name: 'Organization' }).click();
  await page.getByRole('option', { name: ORGANIZATION }).click();
  await page.getByRole('combobox', { name: 'Enter groups' }).fill(group);
  await page.getByRole('option', { name: `Add group "${group}"` }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add models' }).click();
  const addModels = page.getByRole('dialog');
  await addModels.getByRole('checkbox', { name: `Select ${MODEL}` }).check();
  await addModels.getByRole('button', { name: 'Add models' }).click();
  await page.getByRole('button', { name: 'Add token limit' }).click();
  const limits = page.getByRole('dialog', { name: 'Edit token limits' });
  await limits.getByRole('spinbutton', { name: 'Tokens' }).fill('5000');
  await limits.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Create subscription' }).click();
  await expect(page.getByText('Subscription created')).toBeVisible();

  // The MaaS controller's phases: no phase (shown as Unknown) until the first reconcile,
  // Degraded until the TokenRateLimitPolicy is accepted (2 s on the PoC preset's clock), then
  // Active, which the label shows as Ready. The list doesn't poll, so reload until it reads Ready.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: unique, exact: true }) });
  const label = row.getByTestId('phase-label');
  await expect(label).toHaveText(/Unknown|Degraded/);
  await expect(async () => {
    await page.reload();
    await expect(label).toHaveText('Ready');
  }).toPass();

  // The view page opens directly and survives a reload.
  await page.goto(`/subscriptions/view/${unique}`);
  await expect(page.getByRole('heading', { name: unique })).toBeVisible();
  await expect(page.getByText(ORGANIZATION).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: unique })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'subscription models' })).toContainText('5,000');
  await expect(page.getByTestId('subscription-priority')).toHaveText('0');

  // Edit the priority.
  await page.getByRole('button', { name: `Actions for ${unique}` }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page).toHaveURL(new RegExp(`/subscriptions/edit/${unique}$`));
  await page.getByRole('spinbutton', { name: 'Priority' }).fill('42');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Subscription updated')).toBeVisible();

  // Delete from the list with the typed confirmation.
  await expect(row).toContainText('42');
  await row.getByRole('button', { name: `Actions for ${unique}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByLabel(/^Type .* to confirm/).fill(unique);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

// The fixture cluster that is not yet an AI Grid member (mock/fixtures-poc/managedclusters.json).
const ENROLLABLE = 'site4';

// The fake keeps its state in memory and the site is fixed, so a rerun against a reused
// server finds it already enrolled: the spec adapts instead of requiring a fresh server.
test.describe.configure({ mode: 'serial' });

test('adds an enrollable cluster to the AI Grid and keeps it after a reload', async ({ page }) => {
  await page.goto('/clusters');
  const row = page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: ENROLLABLE, exact: true }) });
  await expect(row).toBeVisible();

  // The menu appears once /user has answered; a member offers only removal.
  await page.getByRole('button', { name: `Actions for ${ENROLLABLE}` }).click();
  const add = page.getByRole('menuitem', { name: 'Add to AI Grid' });
  await expect(add.or(page.getByRole('menuitem', { name: 'Remove from AI Grid' }))).toBeVisible();
  if (await add.isVisible()) {
    await add.click();
    // The location is prefilled from the cluster's label; the role has to be chosen.
    const modal = page.getByTestId('cluster-membership-modal');
    await expect(modal.getByRole('textbox', { name: 'Location' })).toHaveValue(ENROLLABLE);
    await modal.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: /Combined/ }).click();
    await modal.getByRole('button', { name: 'Add to AI Grid' }).click();
    await expect(page.getByText(`${ENROLLABLE} added to AI Grid`)).toBeVisible();
  } else {
    await page.keyboard.press('Escape');
  }
  // A member's name links to its AI Grid drawer.
  await expect(row.getByRole('link', { name: ENROLLABLE, exact: true })).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: ENROLLABLE, exact: true }) });
  await expect(reloaded.getByRole('link', { name: ENROLLABLE, exact: true })).toHaveAttribute(
    'href',
    `/ai-grid?cluster=${ENROLLABLE}`,
  );
});

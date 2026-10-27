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
  await page.reload();
  const reloaded = page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: ENROLLABLE, exact: true }) });
  await expect(reloaded).toContainText(/Provisioning|Provisioned/);

  // The name opens the cluster's details page, with what the hub reports about it.
  await reloaded.getByRole('link', { name: ENROLLABLE, exact: true }).click();
  await expect(page).toHaveURL(`/clusters/${ENROLLABLE}`);
  await expect(page.getByRole('heading', { level: 1, name: ENROLLABLE })).toBeVisible();
  await expect(page.getByTestId('cluster-membership')).toContainText(/Provisioning|Provisioned/);
  await expect(page.getByLabel('Cluster', { exact: true })).toContainText('v1.35.6');
  await expect(page.getByTestId('cluster-gpus')).toHaveText('16');
  await expect(page.getByTestId('cluster-status')).toContainText('Ready');
  await expect(page.getByRole('link', { name: 'OpenShift console' })).toHaveAttribute('target', '_blank');
});

// UX review: at 1280 px the table was wider than the page and its actions column ended past the
// window's edge. The actions column sticks to the table's right edge, so a window too narrow for
// every column scrolls the table under it, and on a phone the table stacks.
for (const { name, width } of [
  { name: 'beside the navigation', width: 1210 },
  { name: 'on a phone', width: 390 },
]) {
  test(`keeps each row's actions in view ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/clusters');
    const table = page.getByTestId('clusters-table');
    const actions = page.getByRole('button', { name: `Actions for ${ENROLLABLE}` });
    await expect(actions).toBeVisible();
    // Scroll the table's container to its end, as far as it goes.
    await table.evaluate((t) => {
      t.parentElement!.scrollLeft = t.parentElement!.scrollWidth;
    });
    const box = await actions.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    // The page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await actions.click();
    await expect(
      page
        .getByRole('menuitem', { name: 'Add to AI Grid' })
        .or(page.getByRole('menuitem', { name: 'Remove from AI Grid' })),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

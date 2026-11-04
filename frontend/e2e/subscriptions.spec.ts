import { expect, test } from '@playwright/test';
import { create, fromJsonString, toJsonString } from '@bufbuild/protobuf';
import { ModelsListResponseSchema } from '../src/gen/ai_grid/v1/models_service_pb';
import { ModelClusterStatusSchema, ModelState, ModelStatusSchema } from '../src/gen/ai_grid/v1/model_type_pb';
import { createModel, tryBackend, writeConfirmed } from './backend';

// On the backend's own fakes (playwright.config.ts, "backend fakes"): the pages read and write the
// backend's Subscriptions API over Connect. The organization is the PoC's in the backend's fake
// Keycloak (fixtures/poc/organizations.json). The Git catalog starts empty, so the spec commits a
// model of its own first and takes it out again (e2e/backend.ts).
const ORGANIZATION = 'acme-robotics';

test('creates, views, edits and deletes a subscription', async ({ page }) => {
  const unique = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const group = `${unique}-team`;
  const modelId = `${unique}-model`;
  const MODEL = `E2E model ${unique}`;
  await createModel(page.request, modelId, MODEL);
  // The fake hub doesn't report deployments for newly created models. Supply the read-only
  // rollout report at the Connect boundary; subscription writes still reach the real backend.
  await page.route('**/ai_grid.v1.Models/List*', async (route) => {
    const response = await route.fetch();
    const answer = fromJsonString(ModelsListResponseSchema, await response.text());
    const model = answer.items.find((item) => item.id === modelId);
    if (model) {
      model.status ??= create(ModelStatusSchema);
      model.status.state = ModelState.PARTIALLY_READY;
      model.status.clusters = [
        create(ModelClusterStatusSchema, { cluster: 'site1', state: ModelState.READY }),
        create(ModelClusterStatusSchema, { cluster: 'site2', state: ModelState.STARTING, message: 'Starting model' }),
      ];
    }
    await route.fulfill({ response, body: toJsonString(ModelsListResponseSchema, answer) });
  });
  try {
    await page.goto('/subscriptions');
    await page.getByRole('link', { name: 'Create subscription' }).click();

    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(unique);
    await page.getByRole('combobox', { name: 'Organization' }).click();
    await page.getByRole('option', { name: ORGANIZATION }).click();
    await page.getByRole('combobox', { name: 'Groups' }).fill(group);
    await page.getByRole('option', { name: `Add group "${group}"` }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Add models' }).click();
    const addModels = page.getByRole('dialog', { name: 'Add models', exact: true });
    await addModels.getByRole('checkbox', { name: `Select ${MODEL}` }).check();
    const statusTrigger = addModels.getByRole('button', { name: `Partially ready for ${MODEL}`, exact: true });
    await statusTrigger.click();
    const statusDialog = page.getByRole('dialog', { name: `${MODEL} status`, exact: true });
    await expect(statusDialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(statusDialog).toContainText('site2');
    await page.keyboard.press('Escape');
    await expect(addModels).toBeVisible();
    await expect(statusTrigger).toBeFocused();
    await expect(addModels.getByRole('checkbox', { name: `Select ${MODEL}` })).toBeChecked();
    await addModels.getByRole('button', { name: 'Add models' }).click();
    await page.getByRole('button', { name: `Partially ready for ${MODEL}`, exact: true }).click();
    await expect(statusDialog).toBeVisible();
    await statusDialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(unique);
    await page.getByRole('button', { name: 'Add token limit' }).click();
    const limits = page.getByRole('dialog', { name: 'Edit token limits' });
    await limits.getByRole('spinbutton', { name: 'Tokens' }).fill('5000');
    await limits.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Create subscription' }).click();
    await expect(writeConfirmed(page, `Subscription ${unique} saved to Git`)).toBeVisible();

    // The phase is the backend's: Pending while an ingress cluster hasn't reported the subscription,
    // which no fake cluster does for a new one (withSubscriptionPhase,
    // internal/servers/subscriptions_git.go). The console's own fake played the MaaS controller's
    // Unknown, Degraded and Active instead; git mode reports none of those for it.
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: unique, exact: true }) });
    await expect(row.getByTestId('phase-label')).toHaveText('Pending');

    // The view page opens directly and survives a reload.
    await page.goto(`/subscriptions/view/${unique}`);
    await expect(page.getByRole('heading', { level: 1, name: unique, exact: true })).toBeVisible();
    await expect(page.getByText(ORGANIZATION).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: unique, exact: true })).toBeVisible();
    await expect(page.getByRole('grid', { name: 'subscription models' })).toContainText('5,000');
    await expect(page.getByTestId('subscription-priority')).toHaveText('0');

    // Edit the priority.
    await page.getByRole('button', { name: `Actions for ${unique}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/subscriptions/edit/${unique}$`));
    await page.getByRole('spinbutton', { name: 'Priority' }).fill('42');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(writeConfirmed(page, `Changes to subscription ${unique} saved to Git`)).toBeVisible();

    // Delete from the list with the typed confirmation.
    await expect(row).toContainText('42');
    await row.getByRole('button', { name: `Actions for ${unique}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByLabel(/^Type .* to confirm/).fill(unique);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
  } finally {
    // Whatever step failed, the catalog is left as it was: the subscription, if it is still there
    // (zero skips the version check), then the model.
    await tryBackend(page.request, 'Subscriptions/Delete', { id: unique });
    await tryBackend(page.request, 'Models/Delete', { id: modelId });
  }
});

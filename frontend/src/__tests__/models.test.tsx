// Ported from krisv/ai-grid-cloud-provider-poc src/app/__tests__/deployments.test.tsx at 62319b8.
// The PoC drives its Git-backed API; here the same cases run on MockConsoleService, and the
// BFF and fake backend rules are covered by bff/internal/api and bff/internal/fakebackend tests.
// Rulings and scope:
// - The Git file assertions (deployment, MaaSModelRef, Placement, ManifestWorkReplicaSet) become
//   assertions on the saved model; the console's backend owns those resources.
// - The new model in the subscription model picker is covered by subscriptions.test.tsx, which
//   picks models from the same list.
// - "persists deployment management in mock storage…" keeps only its location and stale-version
//   assertions (A5, D3); a referenced model is the blocked-delete case.
// - "explains a 200 response from an outdated backend" tests a PoC-only legacy payload and is
//   not ported.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import getModels from '../../../mock/examples/get-models.json';
import { ServiceError } from '../api/ConsoleService';
import { consolePlacement } from '../api/adapters';
import { HttpConsoleService } from '../api/HttpConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';
import type { CreateModelRequest } from '../api/types';
import { renderAt } from './render';

const input: CreateModelRequest = {
  name: 'widget',
  displayName: 'Widget',
  modelUri: 'hf://org/widget',
  modelName: 'org/widget',
  runtimeImage: 'registry.example/runtime:test',
  replicas: 1,
  cpu: '2',
  memory: '4Gi',
  gpuCount: 0,
  locations: ['site1', 'site2'],
  runtimeArgs: [],
};

const viewer = { username: 'viewer', groups: [], isProviderAdmin: false };

type User = ReturnType<typeof userEvent.setup>;

/** Names the deployment, replacing the name the wizard starts from the model's. */
const nameDeployment = async (user: User, name: string) => {
  const field = await screen.findByTestId('model-name-desc-name');
  await user.clear(field);
  await user.type(field, name);
};

/** Fills the source and deployment steps and moves on to Locations. */
const fillModel = async (user: User) => {
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'Widget');
  await user.type(screen.getByRole('textbox', { name: /Runtime image/ }), 'registry.example/runtime:test');
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

/** The mock's locations, as the wizard names them: the site, then the location key. */
const site1 = 'San Francisco (site1)';
const site2 = 'New York (site2)';
const site3 = 'Brussels (site3)';

it('walks the deployment wizard, selects locations, saves the model and removes it', async () => {
  const service = new MockConsoleService();
  const user = userEvent.setup();
  renderAt('/models', service);
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Deploy model' }));
  expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled();
  await fillModel(user);
  expect(screen.queryByLabelText('Publish as MaaS')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  const reviewNav = within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', {
    name: /Review/,
  });
  expect(reviewNav).toBeVisible();
  expect(reviewNav).toBeDisabled();
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.click(screen.getByRole('option', { name: site2 }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const review = screen.getByTestId('model-review');
  expect(review).toHaveTextContent(`${site1}, ${site2}`);
  // Empty optional fields are left out of the review.
  expect(review).not.toHaveTextContent('Additional runtime arguments');
  await user.click(await screen.findByRole('button', { name: 'Deploy' }));

  const table = await screen.findByTestId('model-deployments-table');
  expect(table).toHaveTextContent('Widget');
  expect(await screen.findByText('Model deployed')).toBeVisible();
  // The first location, and the rest behind "+1 more".
  const locationsCell = screen.getByTestId('model-locations-widget');
  expect(locationsCell).toHaveTextContent(site1);
  await user.click(within(locationsCell).getByText('+1 more'));
  expect(await screen.findByText('Locations (2)')).toBeVisible();
  expect(screen.getAllByText(site2).length).toBeGreaterThan(0);
  const saved = (await service.listModels()).find((m) => m.name === 'widget');
  expect(saved).toMatchObject({
    namespace: 'ai-grid-models',
    modelUri: 'hf://org/widget',
    modelName: 'org/widget',
    modelRef: { kind: 'LLMInferenceService', name: 'widget' },
    locations: ['site1', 'site2'],
  });

  await user.click(screen.getByTestId('model-actions-widget'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  expect(dialog).toHaveTextContent('Delete model deployment?');
  // The backend also refuses while an authorization policy references the model.
  expect(dialog).toHaveTextContent('Remove references from subscriptions and authorization policies first.');
  expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
  await user.type(within(dialog).getByTestId('delete-modal-input'), 'Widget');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByTestId('model-actions-widget')).not.toBeInTheDocument());
  expect((await service.listModels()).some((m) => m.name === 'widget')).toBe(false);
}, 20000);

it('keeps the confirmation dialog and model when a subscription blocks deletion', async () => {
  const service = new MockConsoleService();
  const result = await service.createModel(input);
  await service.createSubscription({
    name: 'widget-users',
    owner: { groups: [{ name: 'widget-users' }] },
    modelRefs: [{ name: 'widget', tokenRateLimits: [{ limit: 1000, window: '1h' }] }],
    priority: 0,
    tokenMetadata: { organizationId: '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c' },
    createAuthPolicy: true,
  });
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-widget'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  // The dialog names the subscriptions that still use the model.
  const references = await screen.findByTestId('model-references');
  expect(within(references).getByRole('link', { name: 'widget-users' })).toHaveAttribute(
    'href',
    '/subscriptions/view/widget-users',
  );
  await user.type(screen.getByTestId('delete-modal-input'), 'Widget');
  await user.click(within(screen.getByTestId('delete-deployment-modal')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByTestId('delete-model-error-message-alert')).toHaveTextContent('Remove this model');
  expect(screen.getByTestId('delete-deployment-modal')).toBeVisible();
  expect((await service.listModels()).find((m) => m.name === 'widget')?.resourceVersion).toBe(result.resourceVersion);
});

it('offers Ready, provisioned locations and protects models from stale versions', async () => {
  const service = new MockConsoleService();
  expect(await service.listLocations()).toEqual(['site1', 'site2', 'site3']);
  const before = (await service.listModels()).length;
  await expect(service.createModel({ ...input, locations: ['site4'] })).rejects.toMatchObject({
    status: 422,
    fieldErrors: { locations: 'Select locations from the available location catalog.' },
  });
  const result = await service.createModel(input);
  expect((await service.listModels()).find((m) => m.name === 'widget')?.locations).toEqual(['site1', 'site2']);
  expect(await service.listModels()).toHaveLength(before + 1);
  await expect(service.createModel(input)).rejects.toMatchObject({
    status: 409,
    message: 'A model with this resource name already exists.',
  });
  await expect(service.deleteModel('ai-grid-models', 'widget', `${result.resourceVersion}0`)).rejects.toMatchObject({
    status: 409,
    message: 'This model changed. Reload it before deleting.',
  });
  await service.deleteModel('ai-grid-models', 'widget', result.resourceVersion);
  expect(await service.listModels()).toHaveLength(before);
  expect((await service.listModels()).some((m) => m.name === 'widget')).toBe(false);
});

it('keeps the wizard usable after a location failure and retries', async () => {
  const service = new MockConsoleService();
  const list = service.listLocations.bind(service);
  // Fails when the wizard opens and again when the Locations step reloads; Retry succeeds.
  let failures = 2;
  service.listLocations = async () => {
    if (failures-- > 0) throw new ServiceError(503, 'Location catalog unavailable.');
    return list();
  };
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  expect(await screen.findByText('Location catalog unavailable.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('hf://org/widget')).toBeVisible();
  expect(screen.getByText(site1)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
});

it('loads the locations again when the Locations step opens', async () => {
  const service = new MockConsoleService();
  const list = service.listLocations.bind(service);
  // When the wizard opens only site1 is available; by the Locations step all three are.
  let calls = 0;
  service.listLocations = async () => (calls++ === 0 ? ['site1'] : list());
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  expect(await screen.findByRole('option', { name: site3 })).toBeVisible();
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([site1, site2, site3]);
});

it('keeps a chosen location the reload no longer offers, and says to remove it', async () => {
  const service = new MockConsoleService();
  const list = service.listLocations.bind(service);
  // site2 drops out after the first visit to the Locations step.
  let calls = 0;
  service.listLocations = async () => (calls++ < 2 ? list() : ['site1', 'site3']);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.click(screen.getByRole('option', { name: site2 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(`${site2} is no longer available. Remove it to continue.`)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: `Remove ${site2}` }));
  expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  // An exact match: the review lists site1 alone.
  expect(within(screen.getByTestId('model-review')).getByText(site1)).toBeVisible();
});

it('keeps Next disabled until the Locations reload answers', async () => {
  const service = new MockConsoleService();
  const list = service.listLocations.bind(service);
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  // The reload on entering the step waits for the test.
  service.listLocations = async () => {
    if (calls++ === 1) await held;
    return list();
  };
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await act(async () => release());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
});

it('keeps chosen locations visible when the reload offers none', async () => {
  const service = new MockConsoleService();
  const list = service.listLocations.bind(service);
  let calls = 0;
  service.listLocations = async () => (calls++ < 2 ? list() : []);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(`${site1} is no longer available. Remove it to continue.`)).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Locations' })).toHaveAttribute('aria-invalid', 'true');
  await user.click(screen.getByRole('button', { name: `Remove ${site1}` }));
  expect(await screen.findByText('No locations available')).toBeVisible();
});

it('keeps input when saving fails', async () => {
  const service = new MockConsoleService();
  await service.createModel(input);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site3 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Deploy' }));
  expect(await screen.findByText('A model with this resource name already exists.')).toBeVisible();
  expect(screen.getByText('Unable to deploy model')).toBeVisible();
  expect(screen.getByText('hf://org/widget')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
  expect((await service.listModels()).find((m) => m.name === 'widget')?.locations).toEqual(['site1', 'site2']);
});

it('hides write actions from a viewer', async () => {
  const service = new MockConsoleService(viewer);
  renderAt('/models', service);
  await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('viewer'));
  const table = await screen.findByTestId('model-deployments-table');
  expect(table).toHaveTextContent('Granite 3.3 8B Instruct');
  expect(screen.queryByRole('link', { name: 'Deploy model' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('model-actions-granite-3-8b')).not.toBeInTheDocument();
});

it('shows the not-available state when the backend has no models yet', async () => {
  const service = new MockConsoleService();
  service.listModels = async () => {
    throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
  };
  renderAt('/models', service);
  expect(await screen.findByText('Models are not available on this backend yet')).toBeVisible();
  expect(screen.queryByTestId('model-deployments-table')).not.toBeInTheDocument();
});

it('shows one pagination, in the toolbar, for a single page', async () => {
  renderAt('/models', new MockConsoleService());
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  expect(screen.getAllByRole('navigation', { name: /pagination/i })).toHaveLength(1);
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A MockConsoleService whose model calls go through HttpConsoleService to PR 12's model JSON
 * (mock/examples/get-models.json), as the BFF answers under PR 12's fixtures.
 */
const serviceOnModelJson = (fetchFn: ReturnType<typeof vi.fn>) => {
  const service = new MockConsoleService();
  const http = new HttpConsoleService(fetchFn as unknown as typeof fetch);
  service.listModels = () => http.listModels();
  service.listLocations = () => http.listLocations();
  service.createModel = (value) => http.createModel(value);
  service.deleteModel = (namespace, name, version) => http.deleteModel(namespace, name, version);
  service.updateModel = (namespace, name, update, version) => http.updateModel(namespace, name, update, version);
  return service;
};

const modelJsonFetch = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/locations')) return jsonResponse(200, { data: ['paris'] });
    return jsonResponse(200, { data: getModels.body.data });
  });

it('lists PR 12 models with their locations', async () => {
  renderAt('/models', serviceOnModelJson(modelJsonFetch()));
  const table = await screen.findByTestId('model-deployments-table');
  expect(table).toHaveTextContent('Granite 8B Instruct');
  expect(table).toHaveTextContent('Tiny LLM (CPU)');
  expect(screen.getByTestId('model-locations-granite-8b-instruct')).toHaveTextContent(/^paris$/);
  // No locations reads as a dash, with nothing to open.
  const none = screen.getByTestId('model-locations-tiny-llm');
  expect(none).toHaveTextContent('—');
  expect(within(none).queryByRole('button')).not.toBeInTheDocument();
});

it('shows the phase', async () => {
  const user = userEvent.setup();
  renderAt('/models', serviceOnModelJson(modelJsonFetch()));
  const row = async (name: string) =>
    (await screen.findByTestId(`model-locations-${name}`)).closest('tr') as HTMLElement;
  expect(within(await row('granite-8b-instruct')).getByTestId('model-phase')).toHaveTextContent('Ready');
  expect(within(await row('codellama-13b')).getByTestId('model-phase')).toHaveTextContent('Pending');
  const failed = within(await row('llama-3-70b')).getByTestId('model-phase');
  expect(failed).toHaveTextContent('Failed');
  expect(screen.queryByText(/Git/)).not.toBeInTheDocument();
  await user.click(within(failed).getByRole('button', { name: 'Failed' }));
  // A sentence and the next step; the controller's own words fold away under Details.
  expect(await screen.findByText('Deployment failed')).toBeVisible();
  expect(screen.getByText('A runtime template this model needs isn’t installed on the hub.')).toBeVisible();
  const raw = screen.getByText(/v3-6-0-kserve-config-llm-template-tpu" not found/);
  expect(raw).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Details' }));
  expect(raw).toBeVisible();
  expect(raw).toHaveTextContent(/^ConfigNotFound: /);
});

it('offers only eligible locations', async () => {
  const fetchFn = modelJsonFetch();
  const user = userEvent.setup();
  renderAt('/models/deploy', serviceOnModelJson(fetchFn));
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['paris']);
  expect(fetchFn).toHaveBeenCalledWith('/api/v1/locations', expect.objectContaining({ method: 'GET' }));
});

it('deletes by namespace and name with If-Match', async () => {
  const fetchFn = modelJsonFetch();
  const user = userEvent.setup();
  renderAt('/models', serviceOnModelJson(fetchFn));
  await user.click(await screen.findByTestId('model-actions-granite-8b-instruct'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await user.type(screen.getByTestId('delete-modal-input'), 'Granite 8B Instruct');
  await user.click(within(screen.getByTestId('delete-deployment-modal')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByTestId('delete-deployment-modal')).not.toBeInTheDocument());
  const call = fetchFn.mock.calls.find(([, init]) => init?.method === 'DELETE');
  expect(call?.[0]).toBe('/api/v1/models/ai-grid-models/granite-8b-instruct');
  expect(call?.[1]?.headers).toMatchObject({ 'If-Match': '"48760230"' });
});

it("shows the Model URI rule's message once the user leaves an invalid URI", async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.type(uri, 'https:///123.com');
  expect(screen.queryByText('Enter a model URI using hf, oci, s3 or pvc.')).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByText('Enter a model URI using hf, oci, s3 or pvc.')).toBeVisible();
  expect(uri).toHaveAttribute('aria-invalid', 'true');
  expect(uri).toHaveAccessibleDescription(/^Enter a model URI using hf, oci, s3 or pvc\./);
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.clear(uri);
  await user.type(uri, 'hf://org/widget');
  expect(screen.queryByText('Enter a model URI using hf, oci, s3 or pvc.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it('says a required field is required once the user leaves it empty', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  const name = screen.getByRole('textbox', { name: /^Model name/ });
  await user.type(name, 'org/widget');
  await user.clear(name);
  await user.tab();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getAllByText('Required.')).toHaveLength(1);
  expect(uri).not.toHaveAttribute('aria-invalid', 'true');
});

it('says why the deployment step cannot continue when the CPU is invalid', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'Widget');
  await user.type(screen.getByRole('textbox', { name: /Runtime image/ }), 'registry.example/runtime:test');
  const cpu = screen.getByRole('textbox', { name: /^CPU/ });
  await user.clear(cpu);
  await user.type(cpu, '2 cores');
  await user.tab();
  expect(screen.getByText('Enter positive CPU cores or millicores, for example 2 or 500m.')).toBeVisible();
  expect(cpu).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('shows the Locations error only after the user clears a selection', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await fillModel(user);
  const combobox = await screen.findByRole('combobox', { name: 'Locations' });
  expect(screen.queryByText('Select at least one location.')).not.toBeInTheDocument();
  await user.click(combobox);
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  expect(screen.getByText('Select at least one location.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it("takes only the fake backend's URI schemes and sends the URI trimmed", async () => {
  const service = new MockConsoleService();
  const create = vi.spyOn(service, 'createModel');
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.type(uri, 'https://models.example.com/widget');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.clear(uri);
  await user.type(uri, ' hf://org/widget ');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'Widget');
  await user.type(screen.getByRole('textbox', { name: /Runtime image/ }), 'registry.example/runtime:test');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Deploy' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0].modelUri).toBe('hf://org/widget');
}, 20000);

describe('a failed background poll', () => {
  // Only the 30-second polls are faked; user-event and findBy keep real timeouts.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps the list and shows the error above it', async () => {
    const service = new MockConsoleService();
    renderAt('/models', service);
    expect(await screen.findByTestId('model-deployments-table')).toHaveTextContent('Granite 3.3 8B Instruct');
    const failed = vi.spyOn(service, 'listModels').mockRejectedValue(new ServiceError(503, 'Service unavailable.'));
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await waitFor(() => expect(failed).toHaveBeenCalled());
    expect(await screen.findByText('Error loading models')).toBeVisible();
    expect(screen.getByTestId('model-deployments-table')).toHaveTextContent('Granite 3.3 8B Instruct');
  });
});

describe('a background poll during the delete dialog', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('deletes the version the user confirmed, not one a poll loaded while the dialog was open', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/models', service);
    await user.click(await screen.findByTestId('model-actions-granite-research'));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByTestId('delete-deployment-modal');
    await user.type(within(dialog).getByTestId('delete-modal-input'), 'Granite research endpoint');
    service.models[2] = { ...service.models[2], resourceVersion: `${service.models[2].resourceVersion}1` };
    const poll = vi.spyOn(service, 'listModels');
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await waitFor(() => expect(poll).toHaveBeenCalled());
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('This model changed. Reload it before deleting.')).toBeVisible();
    expect(service.models.some((m) => m.name === 'granite-research')).toBe(true);
  });
});

it('reloads the model after a stale delete, so a retry succeeds', async () => {
  // granite-research is in no seed subscription or policy, so nothing else blocks its delete.
  const service = new MockConsoleService();
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-granite-research'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  await user.type(within(dialog).getByTestId('delete-modal-input'), 'Granite research endpoint');
  service.models[2] = { ...service.models[2], resourceVersion: `${service.models[2].resourceVersion}1` };
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('This model changed. Reload it before deleting.')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByTestId('delete-deployment-modal')).not.toBeInTheDocument());
  expect(service.models.some((m) => m.name === 'granite-research')).toBe(false);
});

it('takes a display name longer than a resource name', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'W'.repeat(70));
  await user.type(screen.getByRole('textbox', { name: /Runtime image/ }), 'registry.example/runtime:test');
  expect(screen.getByText('w'.repeat(63))).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it('starts the deployment name from the model name, and keeps a name the user typed', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  expect(await screen.findByRole('button', { name: 'Back' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('model-name-desc-name')).toHaveValue('widget');
  await nameDeployment(user, 'My widget');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByTestId('model-name-desc-name')).toHaveValue('My widget');
});

it('folds the runtime arguments away under Advanced settings, with no dead controls', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const args = await screen.findByTestId('runtime-args-textarea');
  expect(args).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
  expect(args).toBeVisible();
  expect(screen.queryByRole('button', { name: 'View predefined arguments' })).not.toBeInTheDocument();
});

it('asks before Cancel discards the wizard input', async () => {
  const service = new MockConsoleService();
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  // Nothing typed yet: Cancel leaves at once.
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Deploy model' }));
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  const discard = await screen.findByTestId('discard-changes-modal');
  await user.click(within(discard).getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('textbox', { name: /Model URI/ })).toHaveValue('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(within(await screen.findByTestId('discard-changes-modal')).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
});

it('opens a model page with its configuration, locations by site, and a failure explained', async () => {
  const user = userEvent.setup();
  renderAt('/models', serviceOnModelJson(modelJsonFetch()));
  await user.click(await screen.findByRole('link', { name: 'Llama 3 70B' }));
  expect(await screen.findByRole('heading', { name: 'Llama 3 70B' })).toBeVisible();
  const alert = screen.getByTestId('model-status-alert');
  expect(alert).toHaveTextContent('Deployment failed');
  expect(alert).toHaveTextContent('Install the template on the hub, or deploy the model with another runtime.');
  expect(screen.getByText('hf://example-org/llama-3-70b')).toBeVisible();
  expect(screen.getByText('The placement hasn’t chosen any locations yet.')).toBeVisible();
});

it('deletes a model from its page and returns to the list', async () => {
  const service = new MockConsoleService();
  const user = userEvent.setup();
  renderAt('/models/ai-grid-models/granite-research', service);
  await user.click(await screen.findByTestId('model-actions'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  await user.type(within(dialog).getByTestId('delete-modal-input'), 'Granite research endpoint');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Model deployment deleted')).toBeVisible();
  expect(await screen.findByTestId('model-deployments-table')).not.toHaveTextContent('Granite research endpoint');
});

it('says when a model page has no model', async () => {
  renderAt('/models/ai-grid-models/nope', new MockConsoleService());
  expect(await screen.findByText('Model deployment not found')).toBeVisible();
});

it('takes only whole numbers in the number fields, so the shown and sent counts agree', async () => {
  const service = new MockConsoleService();
  const create = vi.spyOn(service, 'createModel');
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByRole('textbox', { name: /Runtime image/ }), 'registry.example/runtime:test');
  const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
  // 1e1 and 1.5 would show as 1 but parse as 10 and 1.5: they're refused.
  fireEvent.change(replicas, { target: { value: '1e1' } });
  expect(replicas).toHaveValue(1);
  fireEvent.change(replicas, { target: { value: '1.5' } });
  expect(replicas).toHaveValue(1);
  fireEvent.change(replicas, { target: { value: '3' } });
  expect(replicas).toHaveValue(3);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
  await user.click(screen.getByRole('option', { name: site1 }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByTestId('model-review')).toHaveTextContent('Replicas3');
  await user.click(screen.getByRole('button', { name: 'Deploy' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0].replicas).toBe(3);
});

it('keeps an emptied Replicas or GPUs field empty and says it is required', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
  await user.type(screen.getByRole('textbox', { name: /^Model name/ }), 'org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  for (const name of ['Replicas', 'GPUs']) {
    const field = screen.getByRole('spinbutton', { name });
    expect(field).toHaveAccessibleDescription(name === 'Replicas' ? 'Between 1 and 99.' : 'Between 0 and 64.');
    await user.clear(field);
    await user.tab();
    // NumberInput would turn the empty field into 0 on blur.
    expect(field).toHaveValue(null);
    // PatternFly adds ": error status;" for screen readers.
    expect(field).toHaveAccessibleDescription(/^Required\./);
  }
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it("names only the subscriptions that use this model, reading no namespace as the console's", async () => {
  const service = new MockConsoleService();
  await service.createModel(input);
  const widget = service.models.find((m) => m.name === 'widget')!;
  service.models.push({ ...widget, namespace: 'team-models', resourceVersion: '1' });
  await service.createSubscription({
    name: 'widget-users',
    owner: { groups: [{ name: 'widget-users' }] },
    modelRefs: [{ name: 'widget', tokenRateLimits: [{ limit: 1000, window: '1h' }] }],
    priority: 0,
    tokenMetadata: { organizationId: '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c' },
    createAuthPolicy: true,
  });
  const user = userEvent.setup();
  const team = renderAt('/models/team-models/widget', service);
  await user.click(await screen.findByTestId('model-actions'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(await screen.findByTestId('delete-deployment-modal')).toBeVisible();
  // Let the subscriptions and config load before checking nothing is named.
  await act(async () => {});
  expect(screen.queryByTestId('model-references')).not.toBeInTheDocument();
  team.unmount();
  renderAt('/models/ai-grid-models/widget', service);
  await user.click(await screen.findByTestId('model-actions'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(await screen.findByTestId('model-references')).toHaveTextContent('widget-users');
});

describe('editing a model deployment', () => {
  /** Opens a step from the wizard's navigation: every step is open from the start when editing. */
  const openStep = async (user: User, name: 'Source' | 'Deployment' | 'Locations' | 'Review') =>
    user.click(within(await screen.findByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name }));

  it('reuses the deploy wizard: fixed fields read-only, every step open, and only the changes sent', async () => {
    const service = new MockConsoleService();
    const update = vi.spyOn(service, 'updateModel');
    const user = userEvent.setup();
    renderAt('/models/ai-grid-models/granite-3-8b', service);
    await user.click(await screen.findByRole('button', { name: 'Actions for Granite 3.3 8B Instruct' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { name: 'Edit Granite 3.3 8B Instruct' })).toBeVisible();
    // Source: the model a deployment serves can't change.
    expect(screen.getByRole('textbox', { name: 'Model URI' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveAttribute('readonly');
    // Nothing changed yet, so Review can't save.
    await openStep(user, 'Review');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await openStep(user, 'Deployment');
    // The resource name and resources are fixed once deployed.
    expect(screen.queryByTestId('model-name-desc-name')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'CPU' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Memory' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'GPUs' })).toHaveAttribute('readonly');
    const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.type(replicas, '3');

    await openStep(user, 'Locations');
    await user.click(await screen.findByRole('combobox', { name: 'Locations' }));
    await user.click(screen.getByRole('option', { name: site2 }));
    await user.keyboard('{Escape}');

    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Model deployment updated')).toBeVisible();
    expect(update).toHaveBeenCalledWith(
      'ai-grid-models',
      'granite-3-8b',
      { replicas: 3, placement: consolePlacement(['site1', 'site2']) },
      '1',
    );
    // Back on the model's page, with the new values.
    expect(await screen.findByRole('heading', { name: 'Granite 3.3 8B Instruct' })).toBeVisible();
    expect(within(screen.getByTestId('model-locations')).getByText(site2)).toBeVisible();
  });

  it('sends the display name, description and runtime arguments in their whole maps', async () => {
    const service = new MockConsoleService();
    service.models[0].annotations = { ...service.models[0].annotations, team: 'research' };
    service.models[0].env = [{ name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' }];
    const update = vi.spyOn(service, 'updateModel');
    const user = userEvent.setup();
    renderAt(`/models/ai-grid-models/${service.models[0].name}/edit`, service);
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.type(description, 'Updated description');
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.type(screen.getByRole('textbox', { name: 'Additional runtime arguments' }), '--enforce-eager');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [, , sent] = update.mock.calls[0];
    // Other annotations and env vars go back as loaded.
    expect(sent.annotations).toEqual({
      'openshift.io/display-name': 'Granite 3.3 8B Instruct',
      'openshift.io/description': 'Updated description',
      team: 'research',
    });
    expect(sent.env).toEqual([
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
    ]);
    expect(Object.keys(sent).sort()).toEqual(['annotations', 'env']);
  });

  it('shows a placement written outside the console read-only and leaves it alone', async () => {
    const service = new MockConsoleService();
    service.models[0].placementSpec = { clusterSets: ['global'], matchLabels: { 'ai-grid/enabled': 'true' } };
    const update = vi.spyOn(service, 'updateModel');
    const user = userEvent.setup();
    renderAt(`/models/ai-grid-models/${service.models[0].name}/edit`, service);
    await openStep(user, 'Locations');
    expect(await screen.findByRole('textbox', { name: 'Locations' })).toHaveAttribute('readonly');
    expect(screen.getByText(/selects clusters by more than location/)).toBeVisible();
    await openStep(user, 'Deployment');
    const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.type(replicas, '2');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2]).toEqual({ replicas: 2 });
  });

  it('says the deployment changed when the version it opened is stale', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt(`/models/ai-grid-models/${service.models[0].name}/edit`, service);
    await openStep(user, 'Deployment');
    const replicas = await screen.findByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.type(replicas, '4');
    // Another tab saves first.
    service.models[0].resourceVersion = '9';
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'This model deployment changed since you opened it. Reload the page to edit the current version.',
      ),
    ).toBeVisible();
  });

  it('saves an unrelated change while a kept location is not offered, or the locations fail to load', async () => {
    const service = new MockConsoleService();
    const update = vi.spyOn(service, 'updateModel');
    // site1, where the model runs, is no longer offered, and the next load fails.
    let calls = 0;
    service.listLocations = async () => {
      if (calls++ === 0) return ['site2'];
      throw new ServiceError(503, 'Location catalog unavailable.');
    };
    const user = userEvent.setup();
    renderAt('/models/ai-grid-models/granite-3-8b/edit', service);
    await openStep(user, 'Locations');
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.type(description, 'Still on site1');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2]).not.toHaveProperty('placement');
  });

  it.each([
    ['no stored count', undefined],
    ['a count outside the deploy wizard’s limits', 0],
  ])('leaves the replicas alone when the model has %s', async (_, replicas) => {
    const service = new MockConsoleService();
    service.models[0].replicas = replicas;
    const update = vi.spyOn(service, 'updateModel');
    const user = userEvent.setup();
    renderAt(`/models/ai-grid-models/${service.models[0].name}/edit`, service);
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.type(description, ' (edited)');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2]).not.toHaveProperty('replicas');
  });

  it('shows an autoscaled model’s replicas as Autoscaled, on its step and in Review', async () => {
    const service = new MockConsoleService();
    service.models[0].autoscaled = true;
    service.models[0].replicas = undefined;
    const user = userEvent.setup();
    renderAt(`/models/ai-grid-models/${service.models[0].name}/edit`, service);
    await openStep(user, 'Deployment');
    expect(await screen.findByRole('textbox', { name: 'Replicas' })).toHaveValue('Autoscaled');
    await openStep(user, 'Review');
    expect(within(screen.getByTestId('model-review')).getByText('Autoscaled')).toBeVisible();
  });

  it('sends the edit through the BFF, keeping other annotations and env, and keeps input on a 422', async () => {
    const fetchFn = modelJsonFetch();
    const json = getModels.body.data.find((m) => m.name === 'tiny-llm')!;
    fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return jsonResponse(422, { error: { code: '422', message: 'spec.main.image: Invalid value' } });
      }
      if (url.endsWith('/locations')) return jsonResponse(200, { data: ['paris'] });
      return jsonResponse(200, { data: getModels.body.data });
    });
    const user = userEvent.setup();
    renderAt('/models/ai-grid-models/tiny-llm/edit', serviceOnModelJson(fetchFn));
    await openStep(user, 'Deployment');
    await user.clear(await screen.findByRole('textbox', { name: 'Description' }));
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.type(screen.getByRole('textbox', { name: 'Additional runtime arguments' }), '--enforce-eager');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('spec.main.image: Invalid value')).toBeVisible();
    const patch = fetchFn.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toBe('/api/v1/models/ai-grid-models/tiny-llm');
    expect(patch?.[1]?.headers).toMatchObject({ 'If-Match': `"${json.resourceVersion}"` });
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      // The description is cleared; the display name and the other variable stay as loaded.
      annotations: { 'openshift.io/display-name': 'Tiny LLM (CPU)' },
      env: [
        { name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' },
        { name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
      ],
    });
    // The input is still there to fix and save again.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await openStep(user, 'Deployment');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
  });

  it('offers Edit from the list, next to the details and Delete', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/models', service);
    await user.click(await screen.findByRole('button', { name: 'Actions for Granite 3.3 8B Instruct' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['View details', 'Edit', 'Delete']);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit Granite 3.3 8B Instruct' })).toBeVisible();
  });
});

it('shows the loading spinner until the models arrive, then the list in its place', async () => {
  const service = new MockConsoleService();
  const list = service.listModels.bind(service);
  let release: () => void = () => undefined;
  service.listModels = () =>
    new Promise((resolve, reject) => {
      release = () => void list().then(resolve, reject);
    });
  renderAt('/models', service);
  const spinner = await screen.findByRole('progressbar', { name: 'Loading models' });
  // The spinner fills the content section on its own; the table isn't there yet.
  expect(spinner.closest('.pf-v6-c-page__main-section')).toHaveClass('pf-m-fill');
  expect(screen.queryByRole('grid', { name: 'Model deployments' })).not.toBeInTheDocument();
  act(() => release());
  expect(await screen.findByRole('grid', { name: 'Model deployments' })).toBeVisible();
  expect(screen.queryByRole('progressbar', { name: 'Loading models' })).not.toBeInTheDocument();
});

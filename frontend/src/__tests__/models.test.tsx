// Ported from krisv/ai-grid-cloud-provider-poc src/app/__tests__/deployments.test.tsx at 62319b8.
// The pages read and write the backend's Models API over Connect; here it is the in-memory fake in
// connectModels.ts (modelsOf), in the generated messages, with the backend's rules the pages show.
// The backend's own rules are its tests' (internal/servers in ai-grid-provider-backend).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import { Code, ConnectError } from '@connectrpc/connect';
import { focusManager } from '@tanstack/react-query';
import { ServiceError } from '../api/ConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';
import configExample from '../../../mock/examples/get-config.json';
import { ModelPhase } from '../gen/ai_grid/v1/model_type_pb';
import { modelObject, modelsOf, subscriptionUsing } from './connectModels';
import { deferred, renderAt, findVisible } from './render';
// The routes load these pages lazily; loaded here, their import does not run inside a test's findBy.
import '../pages/models/ModelDetailsPage';
import '../pages/models/ModelEditPage';
import '../pages/models/ModelWizard';
import '../pages/models/ModelsPage';
import { TestApp } from './TestApp';

/** A user the console couldn't load: the pages show, but without write actions. A viewer
 * (isProviderAdmin false) sees no pages at all (App.test.tsx). */
const unknownUser = () => {
  const service = new MockConsoleService();
  service.getUser = () => Promise.reject(new ServiceError(500, 'unavailable'));
  return service;
};

const unavailable = () => {
  throw new ConnectError('Service unavailable.', Code.Unavailable);
};

type User = ReturnType<typeof userEvent.setup>;

/** Names the deployment, replacing the name the wizard starts from the model's. */
const nameDeployment = async (user: User, name: string) => {
  const field = await screen.findByTestId('model-name-desc-name');
  await user.clear(field);
  await user.paste(name);
};

/** Selects the Deployment step's hardware, NVIDIA GPU until another is selected. */
const selectHardware = async (user: User, label: string) => user.click(screen.getByRole('radio', { name: label }));

/** Replaces the runtime image, which CPU only fills in. */
const setImage = async (user: User, image: string) => {
  const field = screen.getByRole('textbox', { name: /Runtime image/ });
  await user.clear(field);
  if (image) await user.paste(image);
};

/** Fills the source and deployment steps, on CPU only with an image of its own, and moves on to Clusters. */
const fillModel = async (user: User) => {
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'Widget');
  await selectHardware(user, 'CPU only');
  await user.click(screen.getByRole('textbox', { name: /Runtime image/ }));
  await setImage(user, 'registry.example/runtime:test');
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

/** Picks these clusters on the Clusters step, opens Review and, unless told not to, deploys. */
const pickAndDeploy = async (user: User, names: string[], { submit = true } = {}) => {
  await user.click(await screen.findByRole('combobox', { name: 'Clusters' }));
  for (const name of names) await user.click(screen.getByRole('option', { name: optionName(name) }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const review = await screen.findByTestId('model-review');
  if (submit) await user.click(screen.getByRole('button', { name: 'Deploy' }));
  return review;
};

/** The mock's clusters, as a model's page names them: the site, then the cluster. */
const site1 = 'San Francisco (site1)';
const site2 = 'New York (site2)';
const site3 = 'Brussels (site3)';
/** The same clusters as the Deploy wizard offers them: by cluster name. */
const cluster1 = 'site1';
const cluster2 = 'site2';
const cluster3 = 'site3';
/** A Clusters option by its cluster name: its accessible name goes on with the site and region. */
const optionName = (cluster: string) => new RegExp(`^${cluster}( |$)`);

/** A model "widget" the backend has, at version 1, on site1. */
const widget = (service: MockConsoleService) => {
  const models = modelsOf(service);
  models.models.push(
    modelObject({
      id: 'widget',
      metadata: { name: 'widget', version: 1, annotations: { 'openshift.io/display-name': 'Widget' } },
      spec: {
        model: { uri: 'hf://org/widget', name: '' },
        replicas: 1,
        main: { image: 'registry.example/runtime:test', requests: { cpu: '2', memory: '4Gi' } },
        placement: { labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: ['site1'] }] } },
      },
      status: { reason: 'SavedToGit', placement: { selectedClusters: ['site1'], locations: ['site1'] } },
    }),
  );
  return models;
};

const rowOf = async (id: string) => (await screen.findByTestId(`model-locations-${id}`)).closest('tr') as HTMLElement;

it('walks the deployment wizard, selects clusters and creates the model', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const create = vi.spyOn(models, 'create');
  const user = userEvent.setup();
  renderAt('/models', service);
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Deploy model' }));
  expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled();
  await fillModel(user);
  const reviewNav = within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', {
    name: /Review/,
  });
  expect(reviewNav).toBeDisabled();
  const review = await pickAndDeploy(user, [cluster1, cluster2], { submit: false });
  expect(review).toHaveTextContent(`${cluster1}, ${cluster2}`);
  // Empty optional fields are left out of the review, and the served name is the resource name.
  expect(review).not.toHaveTextContent('Additional runtime arguments');
  expect(review).toHaveTextContent('Model nameWidget');
  expect(review).toHaveTextContent('Model name in requestswidget');
  expect(within(review).getAllByText('Model name in requests')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Deploy' }));

  expect(await screen.findByText('Model Widget saved to Git')).toBeVisible();
  // The confirmation comes with the answer; the list shows the model once its refetch is in.
  expect(within(await screen.findByTestId('model-locations-widget')).getByText(site1)).toBeVisible();
  expect(screen.getByTestId('model-deployments-table')).toHaveTextContent('Widget');
  // What Models/Create took: the wizard's fields, CPU only's resources and environment, no presets,
  // and the inference scheduler with a managed route, which the backend's defaults leave off.
  const [request] = create.mock.calls[0];
  expect(request.object).toMatchObject({
    id: 'widget',
    metadata: { name: 'widget', annotations: { 'openshift.io/display-name': 'Widget' } },
    spec: {
      model: { uri: 'hf://org/widget', name: '' },
      replicas: 1,
      baseRefs: [],
      main: {
        image: 'registry.example/runtime:test',
        requests: { cpu: '4', memory: '8Gi' },
        limits: {},
        env: [
          { name: 'OMP_NUM_THREADS', value: '4' },
          { name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
        ],
      },
      placement: { labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: ['site1', 'site2'] }] } },
    },
  });
  expect(request.object?.spec?.router).toMatchObject({ scheduler: true, managedRoute: true, gatewayRefs: [] });
  expect(request.object?.spec?.rollout).toBeUndefined();
});

it('removes a model after its name is typed', async () => {
  const service = new MockConsoleService();
  const models = widget(service);
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-widget'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  expect(dialog).toHaveTextContent('Delete model?');
  expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
  await user.click(within(dialog).getByTestId('delete-modal-input'));
  await user.paste('Widget');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Model Widget deleted from Git')).toBeVisible();
  await waitFor(() => expect(screen.queryByTestId('model-actions-widget')).not.toBeInTheDocument());
  expect(models.models.some((m) => m.id === 'widget')).toBe(false);
});

it('leaves the deploy form out of history once the model is deployed, so Back skips it', async () => {
  let navigate: NavigateFunction = () => undefined;
  const CaptureNavigate = () => {
    navigate = useNavigate();
    return null;
  };
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/clusters', '/models/deploy']} initialIndex={1}>
      <CaptureNavigate />
      <TestApp service={new MockConsoleService()} />
    </MemoryRouter>,
  );
  await fillModel(user);
  await pickAndDeploy(user, [cluster1]);
  expect(await screen.findByText('Model Widget saved to Git')).toBeVisible();
  await act(async () => navigate(-1));
  expect(await screen.findByRole('heading', { level: 1, name: 'Clusters' })).toBeVisible();
});

it('names the subscriptions that use the model and disables Delete, joined by model_id', async () => {
  const service = new MockConsoleService();
  const models = widget(service);
  models.subscriptions = [
    subscriptionUsing('widget-users', ['widget'], 'Widget users'),
    subscriptionUsing('others', ['granite-3-8b']),
  ];
  const listSubscriptions = vi.spyOn(models, 'listSubscriptions');
  const remove = vi.spyOn(models, 'delete');
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-widget'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const references = await screen.findByTestId('model-references');
  expect(
    within(references)
      .getAllByRole('link')
      .map((l) => l.textContent),
  ).toEqual(['Widget users']);
  expect(within(references).getByRole('link', { name: 'Widget users' })).toHaveAttribute(
    'href',
    '/subscriptions/view/widget-users',
  );
  // The backend evaluates the join (SubscriptionModelRef.model_id) and the filter.
  expect(listSubscriptions.mock.calls[0][0].filter).toBe('this.spec.model_refs.exists(r, r.model_id == "widget")');
  await user.type(screen.getByTestId('delete-modal-input'), 'Widget{Enter}');
  const button = within(screen.getByTestId('delete-deployment-modal')).getByRole('button', { name: 'Delete' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await user.click(button);
  await user.hover(button);
  expect(await screen.findByText('Remove this model from its subscriptions first.')).toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
});

it('leaves Delete to the backend when the subscriptions fail to load, and keeps the dialog when it refuses', async () => {
  const service = new MockConsoleService();
  const models = widget(service);
  models.subscriptions = [subscriptionUsing('widget-users', ['widget'])];
  vi.spyOn(models, 'listSubscriptions').mockImplementation(unavailable);
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-widget'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await user.click(await screen.findByTestId('delete-modal-input'));
  await user.paste('Widget');
  await user.click(within(screen.getByTestId('delete-deployment-modal')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByTestId('delete-model-error-message-alert')).toHaveTextContent(
    'Model "widget" is referenced by Subscription "widget-users"',
  );
  expect(screen.getByTestId('delete-deployment-modal')).toBeVisible();
  expect(models.models.some((m) => m.id === 'widget')).toBe(true);
});

it('keeps the wizard usable after a cluster-list failure and retries', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = models.placementClusters;
  // Fails when the wizard opens and again when the Locations step reloads; Retry succeeds.
  let failures = 2;
  models.placementClusters = async () => {
    if (failures-- > 0) throw new ConnectError('Location catalog unavailable.', Code.FailedPrecondition);
    return list();
  };
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  expect(await screen.findByText('Location catalog unavailable.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await pickAndDeploy(user, [cluster1], { submit: false });
  expect(screen.getByText('hf://org/widget')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
});

it('loads the placement clusters again when the Clusters step opens', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = models.placementClusters;
  // When the wizard opens only site1 is offered; by the Clusters step all three are.
  let calls = 0;
  models.placementClusters = async () => (calls++ === 0 ? ['site1'] : list());
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Clusters' }));
  await findVisible('option', optionName(cluster3));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    `${cluster1}San Francisco · us-west`,
    `${cluster2}New York · us-east`,
    `${cluster3}Brussels · europe-west`,
  ]);
});

it('keeps a chosen cluster the reload no longer offers, and says to remove it', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = models.placementClusters;
  // site2 drops out after the first visit to the Clusters step.
  let calls = 0;
  models.placementClusters = async () => (calls++ < 2 ? list() : ['site1', 'site3']);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await pickAndDeploy(user, [cluster1, cluster2], { submit: false });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(`${cluster2} is no longer available. Remove it to continue.`)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: `Remove ${cluster2}` }));
  expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(within(await screen.findByTestId('model-review')).getByText(cluster1)).toBeVisible();
});

it('keeps Next disabled until the Clusters reload answers', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = models.placementClusters;
  const held = deferred<void>();
  let calls = 0;
  // The reload on entering the step waits for the test.
  models.placementClusters = async () => {
    if (calls++ === 1) await held.promise;
    return list();
  };
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await user.click(await screen.findByRole('combobox', { name: 'Clusters' }));
  await user.click(screen.getByRole('option', { name: optionName(cluster1) }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await act(async () => held.resolve());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
});

it('keeps chosen clusters visible when the reload offers none', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = models.placementClusters;
  let calls = 0;
  models.placementClusters = async () => (calls++ < 2 ? list() : []);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await pickAndDeploy(user, [cluster1], { submit: false });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(`${cluster1} is no longer available. Remove it to continue.`)).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Clusters' })).toHaveAttribute('aria-invalid', 'true');
  await user.click(screen.getByRole('button', { name: `Remove ${cluster1}` }));
  expect(await screen.findByText('No clusters available')).toBeVisible();
});

it('counts the AI Grid members the Clusters step leaves out', async () => {
  const hint = /AI Grid clusters? (is|are) not listed/;
  const service = new MockConsoleService();
  const models = modelsOf(service);
  models.placementClusters = async () => ['site1', 'site2'];
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await screen.findByRole('combobox', { name: 'Clusters' });
  expect(await screen.findByText(hint)).toHaveTextContent('1 AI Grid cluster is not listed');
  models.placementClusters = async () => ['site1', 'site2', 'site3'];
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('combobox', { name: 'Clusters' });
  await waitFor(() => expect(screen.queryByText(hint)).not.toBeInTheDocument());
});

it("keeps input when saving fails, with the backend's message", async () => {
  const service = new MockConsoleService();
  widget(service);
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await fillModel(user);
  await pickAndDeploy(user, [cluster3]);
  expect(await screen.findByText('Model "widget" already exists')).toBeVisible();
  expect(screen.getByText('Unable to deploy model')).toBeVisible();
  expect(screen.getByText('hf://org/widget')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deploy' })).toBeEnabled();
});

it('hides write actions until it knows the user is a provider admin', async () => {
  const service = unknownUser();
  renderAt('/models', service);
  await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('Unable to load user'));
  const table = await screen.findByTestId('model-deployments-table');
  expect(table).toHaveTextContent('Granite 3.3 8B Instruct');
  expect(screen.queryByRole('link', { name: 'Deploy model' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('model-actions-granite-3-8b')).not.toBeInTheDocument();
});

it('shows the not-available state when the backend has no Models/List', async () => {
  const service = new MockConsoleService();
  vi.spyOn(modelsOf(service), 'list').mockImplementation(() => {
    throw new ConnectError('no such method', Code.Unimplemented);
  });
  renderAt('/models', service);
  expect(await screen.findByText('Models are not available on this AI Grid backend')).toBeVisible();
  expect(screen.queryByTestId('model-deployments-table')).not.toBeInTheDocument();
});

it('shows one pagination, in the toolbar, for a single page', async () => {
  renderAt('/models', new MockConsoleService());
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  expect(screen.getAllByRole('navigation', { name: /pagination/i })).toHaveLength(1);
});

describe('the phase', () => {
  /** The service with one model per phase the backend reports. */
  const phases = () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const at = (id: string, phase: ModelPhase, reason: string, message = '') =>
      modelObject({
        id,
        metadata: { name: id, version: 1 },
        spec: { model: { uri: `hf://x/${id}`, name: id } },
        status: { phase, reason, message },
      });
    models.models = [
      at('ready', ModelPhase.READY, 'Ready'),
      at('pending', ModelPhase.PENDING, 'NotReady', 'Not ready on site1'),
      at(
        'failed',
        ModelPhase.FAILED,
        'ConfigNotFound',
        'LLMInferenceServiceConfig "v3-6-0-kserve-config-llm-template-tpu" not found',
      ),
      at('partial', ModelPhase.PARTIALLY_AVAILABLE, 'PartiallyAvailable', 'Not ready on site2; ready on site1'),
      at('saved', ModelPhase.UNSPECIFIED, 'SavedToGit'),
      at('unknown', ModelPhase.UNSPECIFIED, 'Something'),
    ];
    return service;
  };

  it('words each phase, in outline labels that open nothing, the message in a tooltip', async () => {
    const user = userEvent.setup();
    renderAt('/models', phases());
    const phase = async (id: string) => within(await rowOf(id)).getByTestId('model-phase');
    expect(await phase('ready')).toHaveTextContent(/^Ready$/);
    expect(await phase('pending')).toHaveTextContent(/^Pending$/);
    expect(await phase('failed')).toHaveTextContent(/^Failed$/);
    expect(await phase('partial')).toHaveTextContent(/^Partially available$/);
    expect(await phase('saved')).toHaveTextContent(/^Saved to Git$/);
    // An unspecified phase without SavedToGit isn't Pending: the console doesn't know.
    expect(await phase('unknown')).toHaveTextContent(/^Unknown$/);
    for (const id of ['ready', 'partial', 'saved']) {
      const label = (await phase(id)).querySelector('.pf-v6-c-label');
      expect(label).toHaveClass('pf-m-outline');
      expect(within(await phase(id)).queryByRole('button')).not.toBeInTheDocument();
    }
    await user.hover(within(await phase('partial')).getByText('Partially available'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Not ready on site2; ready on site1');
  });

  it("explains a failure on the model's page, the backend's own words folded away", async () => {
    const user = userEvent.setup();
    renderAt('/models/failed', phases());
    const alert = await screen.findByTestId('model-status-alert');
    expect(alert).toHaveTextContent('Deployment failed');
    expect(alert).toHaveTextContent('Install the template on the hub, or deploy the model with another runtime.');
    const raw = screen.getByText(/v3-6-0-kserve-config-llm-template-tpu" not found/);
    expect(raw).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(raw).toHaveTextContent(/^ConfigNotFound: /);
  });

  it('shows no alert for Saved to Git: the label says it all', async () => {
    renderAt('/models/saved', phases());
    expect(await screen.findByTestId('model-phase')).toHaveTextContent(/^Saved to Git$/);
    expect(screen.queryByTestId('model-status-alert')).not.toBeInTheDocument();
  });

  it('warns about a partially available model on its page', async () => {
    renderAt('/models/partial', phases());
    expect(await screen.findByTestId('model-status-alert')).toHaveTextContent('Not ready on site2; ready on site1');
  });
});

it("shows the Model URI rule's message once the user leaves an invalid URI", async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  await user.click(uri);
  await user.paste('https:///123.com');
  expect(screen.queryByText('Enter a model URI using hf, oci, s3 or pvc.')).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByText('Enter a model URI using hf, oci, s3 or pvc.')).toBeVisible();
  expect(uri).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.clear(uri);
  await user.paste('hf://org/widget');
  expect(screen.queryByText('Enter a model URI using hf, oci, s3 or pvc.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it('says a required field is required once the user leaves it empty, and asks for no served name', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  // A model is served as its id, the name users send: there is no name to choose for it.
  expect(screen.queryByRole('textbox', { name: /^Model name/ })).not.toBeInTheDocument();
  await user.click(uri);
  await user.paste('hf://org/widget');
  await user.clear(uri);
  await user.tab();
  expect(uri).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getAllByText('Required.')).toHaveLength(1);
});

it('says why the deployment step cannot continue when the CPU is invalid', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const cpu = screen.getByRole('textbox', { name: /^CPU/ });
  await user.clear(cpu);
  await user.paste('2 cores');
  await user.tab();
  expect(screen.getByText('Enter positive CPU cores or millicores, for example 2 or 500m.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('shows the Clusters error only after the user clears a selection', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await fillModel(user);
  const combobox = await screen.findByRole('combobox', { name: 'Clusters' });
  expect(screen.queryByText('Select at least one cluster.')).not.toBeInTheDocument();
  await user.click(combobox);
  await user.click(screen.getByRole('option', { name: optionName(cluster1) }));
  await user.click(screen.getByRole('option', { name: optionName(cluster1) }));
  await user.keyboard('{Escape}');
  expect(screen.getByText('Select at least one cluster.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('sends the URI trimmed and refuses other schemes', async () => {
  const service = new MockConsoleService();
  const create = vi.spyOn(modelsOf(service), 'create');
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  const uri = await screen.findByRole('textbox', { name: /Model URI/ });
  await user.click(uri);
  await user.paste('https://models.example.com/widget');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  await user.clear(uri);
  await user.paste(' hf://org/widget ');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await pickAndDeploy(user, [cluster1]);
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0].object?.spec?.model?.uri).toBe('hf://org/widget');
});

it.each(['/models/granite-research', '/models/granite-research/edit'])(
  'offers Retry when a model fails to load: %s',
  async (path) => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const get = vi.spyOn(models, 'get').mockImplementationOnce(unavailable);
    const user = userEvent.setup();
    renderAt(path, service);
    expect(await screen.findByRole('heading', { name: 'Unable to load model' })).toBeVisible();
    get.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Granite research endpoint/ })).toBeVisible();
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  },
);

describe('a background poll', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("keeps a model's page under a warning when it fails, so stale data doesn't look current", async () => {
    const service = new MockConsoleService();
    renderAt('/models/granite-research', service);
    expect(await screen.findByRole('heading', { level: 1, name: 'Granite research endpoint' })).toBeVisible();
    vi.spyOn(modelsOf(service), 'get').mockImplementation(unavailable);
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(await screen.findByTestId('stale-data-alert')).toHaveTextContent('Showing the last loaded model');
    expect(screen.getByRole('heading', { level: 1, name: 'Granite research endpoint' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Deployment' })).toBeVisible();
  });

  it('keeps the list and shows the error above it', async () => {
    const service = new MockConsoleService();
    renderAt('/models', service);
    expect(await screen.findByTestId('model-deployments-table')).toHaveTextContent('Granite 3.3 8B Instruct');
    vi.spyOn(modelsOf(service), 'list').mockImplementation(unavailable);
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(await screen.findByText('Showing the last loaded models')).toBeVisible();
    expect(screen.getByTestId('model-deployments-table')).toHaveTextContent('Granite 3.3 8B Instruct');
  });

  it('deletes the version the user confirmed, not one a poll loaded while the dialog was open', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/models', service);
    await user.click(await screen.findByTestId('model-actions-granite-research'));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByTestId('delete-deployment-modal');
    await user.click(within(dialog).getByTestId('delete-modal-input'));
    await user.paste('Granite research endpoint');
    models.find('granite-research').metadata!.version = 2;
    const poll = vi.spyOn(models, 'list');
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(poll).toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/the model changed since it was read; reload and retry/)).toBeVisible();
    expect(models.models.some((m) => m.id === 'granite-research')).toBe(true);
  });

  it("keeps an open cluster's status current, and closes it when the cluster goes", async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const granite = models.find('granite-3-8b');
    granite.status!.clusters[0].phase = ModelPhase.PENDING;
    granite.status!.clusters[0].reason = 'NoReport';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/models', service);
    await user.click(within(await rowOf('granite-3-8b')).getByRole('button', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: `Pending at ${site1}` }));
    const modal = await screen.findByTestId('cluster-status-modal');
    expect(within(modal).getByRole('heading', { name: /status/ })).toHaveTextContent('Pending');
    granite.status!.clusters[0].phase = ModelPhase.READY;
    await act(() => vi.advanceTimersByTimeAsync(30000));
    await waitFor(() => expect(within(modal).getByRole('heading', { name: /status/ })).toHaveTextContent('Ready'));
    granite.status!.clusters = [];
    await act(() => vi.advanceTimersByTimeAsync(30000));
    await waitFor(() => expect(screen.queryByTestId('cluster-status-modal')).not.toBeInTheDocument());
  });
});

it('reloads the model after a stale delete, so a retry succeeds', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-granite-research'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  await user.click(within(dialog).getByTestId('delete-modal-input'));
  await user.paste('Granite research endpoint');
  models.find('granite-research').metadata!.version = 2;
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText(/the model changed since it was read/)).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByTestId('delete-deployment-modal')).not.toBeInTheDocument());
  expect(models.models.some((m) => m.id === 'granite-research')).toBe(false);
});

it('keeps the delete dialog busy until the reloaded model is in, and says when the reload fails', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByTestId('model-actions-granite-research'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  await user.click(within(dialog).getByTestId('delete-modal-input'));
  await user.paste('Granite research endpoint');
  models.find('granite-research').metadata!.version = 2;
  const remove = vi.spyOn(models, 'delete');
  const reload = deferred<void>();
  const get = models.get;
  const reloadSpy = vi.spyOn(models, 'get').mockImplementationOnce(async (req, ctx) => {
    await reload.promise;
    return get(req, ctx);
  });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  // The reload is still out: Delete stays busy, so no retry with the stale version.
  expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeDisabled();
  await user.type(within(dialog).getByTestId('delete-modal-input'), '{Enter}');
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => reload.resolve());
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled());

  // A second stale delete whose reload fails says so.
  models.find('granite-research').metadata!.version = 3;
  reloadSpy.mockImplementationOnce(unavailable);
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await within(dialog).findByText(/Unable to reload the latest version/)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
});

it('takes a display name longer than a resource name', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await nameDeployment(user, 'W'.repeat(70));
  expect(screen.getByText('w'.repeat(63))).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

it('starts the deployment name from the model URI, and keeps a name the user typed', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  expect(await screen.findByRole('button', { name: 'Back' })).toBeDisabled();
  await user.click(screen.getByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
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
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const args = await screen.findByTestId('runtime-args-textarea');
  expect(args).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
  expect(args).toBeVisible();
  expect(screen.queryByRole('button', { name: 'View predefined arguments' })).not.toBeInTheDocument();
});

it('asks before Cancel discards the wizard input', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  // Nothing typed yet: Cancel leaves at once.
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
  await user.click(screen.getByRole('link', { name: 'Deploy model' }));
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  const discard = await screen.findByTestId('discard-changes-modal');
  await user.click(within(discard).getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('textbox', { name: /Model URI/ })).toHaveValue('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(within(await screen.findByTestId('discard-changes-modal')).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByTestId('model-deployments-table')).toBeVisible();
});

it("opens a model page with its configuration, its endpoint and each cluster's status", async () => {
  const service = new MockConsoleService();
  modelsOf(service).find('granite-3-8b').status!.url = 'https://granite.example.com/v1';
  const user = userEvent.setup();
  renderAt('/models', service);
  await user.click(await screen.findByRole('link', { name: 'Granite 3.3 8B Instruct' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Granite 3.3 8B Instruct' })).toBeVisible();
  expect(screen.getByText('hf://example-org/granite-3-8b')).toBeVisible();
  expect(screen.getByText('https://granite.example.com/v1')).toBeVisible();
  // Deployed on OpenShift AI's CPU preset, before the console stopped sending presets.
  expect(screen.getByText('v3-6-0-kserve-config-llm-template-cpu')).toBeVisible();
  const locations = screen.getByTestId('model-locations');
  expect(within(locations).getByTestId('model-clusters-granite-3-8b')).toBeVisible();
  expect(within(locations).getByRole('link', { name: 'View on the AI Grid map' })).toHaveAttribute(
    'href',
    '/ai-grid?model=granite-3-8b',
  );
  await user.click(await within(locations).findByRole('button', { name: `Ready at ${site1}` }));
  const modal = await screen.findByTestId('cluster-status-modal');
  expect(modal).toHaveTextContent('LLMInferenceService ready');
  expect(modal).toHaveTextContent('Ready');
});

it('says a model without locations has none', async () => {
  renderAt('/models/llama-3-70b', new MockConsoleService());
  expect(await screen.findByText("No AI Grid cluster matches this model's placement.")).toBeVisible();
});

it('deletes a model from its page and returns to the list', async () => {
  const user = userEvent.setup();
  renderAt('/models/granite-research', new MockConsoleService());
  await user.click(await screen.findByTestId('model-actions'));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByTestId('delete-deployment-modal');
  await user.click(within(dialog).getByTestId('delete-modal-input'));
  await user.paste('Granite research endpoint');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Model Granite research endpoint deleted from Git')).toBeVisible();
  expect(await screen.findByTestId('model-deployments-table')).not.toHaveTextContent('Granite research endpoint');
});

it('says when a model page has no model', async () => {
  renderAt('/models/nope', new MockConsoleService());
  expect(await screen.findByText('Model not found')).toBeVisible();
});

it('loads only the one model on its page and its edit page', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const list = vi.spyOn(models, 'list');
  const get = vi.spyOn(models, 'get');
  const page = renderAt('/models/granite-3-8b', service);
  expect(await screen.findByRole('heading', { level: 1, name: 'Granite 3.3 8B Instruct' })).toBeVisible();
  page.unmount();
  renderAt('/models/granite-3-8b/edit', service);
  expect(await screen.findByRole('navigation', { name: 'Wizard steps' })).toBeVisible();
  expect(get.mock.calls.map(([req]) => req.id)).toEqual(['granite-3-8b', 'granite-3-8b']);
  expect(list).not.toHaveBeenCalled();
});

it('takes only whole numbers in the number fields, so the shown and sent counts agree', async () => {
  const service = new MockConsoleService();
  const create = vi.spyOn(modelsOf(service), 'create');
  const user = userEvent.setup();
  renderAt('/models/deploy', service);
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
  // 1e1 and 1.5 would show as 1 but parse as 10 and 1.5: they're refused.
  fireEvent.change(replicas, { target: { value: '1e1' } });
  expect(replicas).toHaveValue(1);
  fireEvent.change(replicas, { target: { value: '1.5' } });
  expect(replicas).toHaveValue(1);
  fireEvent.change(replicas, { target: { value: '3' } });
  expect(replicas).toHaveValue(3);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const review = await pickAndDeploy(user, [cluster1], { submit: false });
  expect(review).toHaveTextContent('Replicas3');
  await user.click(screen.getByRole('button', { name: 'Deploy' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0].object?.spec?.replicas).toBe(3);
});

it('keeps an emptied Replicas or GPUs field empty and says it is required', async () => {
  const user = userEvent.setup();
  renderAt('/models/deploy', new MockConsoleService());
  await user.click(await screen.findByRole('textbox', { name: /Model URI/ }));
  await user.paste('hf://org/widget');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  for (const name of ['Replicas', 'GPUs']) {
    const field = screen.getByRole('spinbutton', { name });
    await user.clear(field);
    await user.tab();
    expect(field).toHaveValue(null);
    expect(field).toHaveAccessibleDescription(/^Required\./);
  }
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

describe('the hardware', () => {
  const cpuImage =
    'registry.redhat.io/rhaii/vllm-cpu-rhel9@sha256:0ec0f5ff9a5ff263f58db0cfb19e3d7eef24b94c2d8629fe5145f5a8747e28c9';
  const defaultImageHelp = "Leave empty to use the cluster's default vLLM image for NVIDIA GPUs.";

  /** Fills the source step, opens Deployment, and returns the Models/Create spy. */
  const openDeployment = async (user: User, service = new MockConsoleService()) => {
    const create = vi.spyOn(modelsOf(service), 'create');
    renderAt('/models/deploy', service);
    await user.type(await screen.findByRole('textbox', { name: /Model URI/ }), 'hf://org/widget');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    return create;
  };

  const toReview = async (user: User, submit = true) => {
    await user.click(screen.getByRole('button', { name: 'Next' }));
    return pickAndDeploy(user, [cluster1], { submit });
  };

  const field = (name: string | RegExp) => screen.getByRole('textbox', { name });

  it('is the BFF’s built-in list when the chart sets none', () => {
    expect(new MockConsoleService().config.models).toEqual(configExample.body.data.models);
  });

  it('starts on NVIDIA GPU and deploys it with no image, no presets, and one GPU', async () => {
    const user = userEvent.setup();
    const create = await openDeployment(user);
    expect(screen.getByRole('radio', { name: 'NVIDIA GPU' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'CPU only' })).not.toBeChecked();
    expect(screen.getByText('For x86_64 clusters without GPUs.')).toBeVisible();
    expect(field(/Runtime image/)).toHaveValue('');
    expect(field(/Runtime image/)).toHaveAccessibleDescription(defaultImageHelp);
    expect(field(/^CPU/)).toHaveValue('2');
    expect(field(/^Memory/)).toHaveValue('16Gi');
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(1);
    const review = await toReview(user, false);
    expect(review).toHaveTextContent('HardwareNVIDIA GPU');
    expect(review).toHaveTextContent("Runtime imageDefault (the cluster's vLLM image for NVIDIA GPUs)");
    expect(review).toHaveTextContent('GPUs1');
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const spec = create.mock.calls[0][0].object?.spec;
    expect(spec?.baseRefs).toEqual([]);
    expect(spec?.main?.image).toBe('');
    // The request only: the backend saves it as the limit too (ModelContainer.requests).
    expect(spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' });
    expect(spec?.main?.limits).toEqual({});
    expect(spec?.main?.env).toEqual([]);
  });

  it('fills in CPU only’s image and resources, and sends its environment with the runtime arguments', async () => {
    const user = userEvent.setup();
    const create = await openDeployment(user);
    await selectHardware(user, 'CPU only');
    expect(screen.queryByRole('spinbutton', { name: 'GPUs' })).not.toBeInTheDocument();
    expect(field(/Runtime image/)).toHaveValue(cpuImage);
    expect(field(/Runtime image/)).toHaveAccessibleDescription(
      'Set by the selected hardware. Replace it to use another vLLM image.',
    );
    expect(field(/^CPU/)).toHaveValue('4');
    expect(field(/^Memory/)).toHaveValue('8Gi');
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.click(screen.getByRole('textbox', { name: 'Additional runtime arguments' }));
    await user.paste('--max-model-len 4096');
    const review = await toReview(user, false);
    expect(review).toHaveTextContent('HardwareCPU only');
    expect(review).toHaveTextContent(`Runtime image${cpuImage}`);
    expect(within(review).queryByText('GPUs')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const spec = create.mock.calls[0][0].object?.spec;
    expect(spec?.baseRefs).toEqual([]);
    expect(spec?.main?.image).toBe(cpuImage);
    expect(spec?.main?.requests).toEqual({ cpu: '4', memory: '8Gi' });
    expect(spec?.main?.env.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: 'OMP_NUM_THREADS', value: '4' },
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len 4096' },
    ]);
  });

  it('gives each hardware its own image, and keeps the CPU, memory, and GPUs the user edited', async () => {
    const user = userEvent.setup();
    await openDeployment(user);
    const cpu = field(/^CPU/);
    await user.clear(cpu);
    await user.paste('3');
    const memory = field(/^Memory/);
    await user.clear(memory);
    await user.paste('12Gi');
    const gpus = screen.getByRole('spinbutton', { name: 'GPUs' });
    await user.clear(gpus);
    await user.type(gpus, '2');
    // An image typed for NVIDIA GPU is not CPU only's: selecting other hardware replaces it.
    await user.click(field(/Runtime image/));
    await user.paste('registry.example/vllm-cuda:mine');
    await selectHardware(user, 'CPU only');
    expect(field(/Runtime image/)).toHaveValue(cpuImage);
    expect(field(/Runtime image/)).toHaveAccessibleDescription(
      'Set by the selected hardware. Replace it to use another vLLM image.',
    );
    expect(field(/^CPU/)).toHaveValue('3');
    expect(field(/^Memory/)).toHaveValue('12Gi');
    await setImage(user, 'registry.example/vllm-cpu:mine');
    await selectHardware(user, 'NVIDIA GPU');
    expect(field(/Runtime image/)).toHaveValue('');
    expect(field(/^CPU/)).toHaveValue('3');
    expect(field(/^Memory/)).toHaveValue('12Gi');
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(2);
  });

  it('names the accelerator field after the accelerator, and requests it by its resource', async () => {
    const user = userEvent.setup();
    const service = new MockConsoleService();
    service.config = {
      ...service.config,
      models: {
        hardware: [
          {
            id: 'amd-gpu',
            label: 'AMD GPU',
            accelerator: 'amd.com/gpu',
            defaults: { accelerators: 2, cpu: '4', memory: '32Gi' },
          },
          { id: 'gaudi', label: 'Intel Gaudi', accelerator: 'habana.ai/gaudi', image: 'registry.example/vllm-gaudi:1' },
        ],
      },
    };
    const create = await openDeployment(user, service);
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(2);
    // The cluster's default image is for NVIDIA GPUs: other hardware needs an image of its own.
    expect(field(/Runtime image/)).toBeRequired();
    expect(field(/Runtime image/)).toHaveAccessibleDescription('Enter a vLLM image for this hardware.');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(field(/Runtime image/));
    await user.tab();
    expect(field(/Runtime image/)).toHaveAccessibleDescription(/Required\./);
    await selectHardware(user, 'Intel Gaudi');
    expect(screen.getByRole('spinbutton', { name: 'Accelerators' })).toHaveValue(1);
    expect(field(/^Memory/)).toHaveValue('4Gi');
    await selectHardware(user, 'AMD GPU');
    await user.click(field(/Runtime image/));
    await user.paste('registry.example/vllm-rocm:1');
    await toReview(user);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].object?.spec?.main?.requests).toEqual({
      cpu: '4',
      memory: '32Gi',
      'amd.com/gpu': '2',
    });
  });

  it('refuses fewer than one GPU', async () => {
    const user = userEvent.setup();
    await openDeployment(user);
    const gpus = screen.getByRole('spinbutton', { name: 'GPUs' });
    await user.clear(gpus);
    await user.type(gpus, '0');
    await user.tab();
    expect(gpus).toHaveAccessibleDescription(/Enter a number from 1 to 64\./);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('refuses an image with spaces, and takes an emptied one', async () => {
    const user = userEvent.setup();
    await openDeployment(user);
    await user.type(field(/Runtime image/), 'bad image');
    await user.tab();
    expect(field(/Runtime image/)).toHaveAccessibleDescription(/Enter a container image without spaces\./);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await setImage(user, '');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(field(/Runtime image/)).not.toBeRequired();
  });

  it('requires an image for CPU only: the cluster’s default is for NVIDIA GPUs', async () => {
    const user = userEvent.setup();
    await openDeployment(user);
    await selectHardware(user, 'CPU only');
    expect(field(/Runtime image/)).toBeRequired();
    await setImage(user, '');
    await user.tab();
    expect(field(/Runtime image/)).toHaveAccessibleDescription(/Required\./);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('says on CPU that long-context models need --max-model-len', async () => {
    const user = userEvent.setup();
    await openDeployment(user);
    const hint = 'For long-context models on CPU, set --max-model-len in Advanced settings.';
    expect(field(/^Memory/)).not.toHaveAccessibleDescription(new RegExp(hint));
    await selectHardware(user, 'CPU only');
    expect(field(/^Memory/)).toHaveAccessibleDescription(`For example, 4Gi or 512Mi. ${hint}`);
  });

  it('waits for the console’s settings, and offers Retry when they fail to load', async () => {
    const user = userEvent.setup();
    const service = new MockConsoleService();
    const getConfig = service.getConfig;
    service.getConfig = () => Promise.reject(new ServiceError(503, 'The console server is unavailable.'));
    await openDeployment(user, service);
    const alert = await screen.findByText('Unable to load hardware');
    expect(alert).toBeVisible();
    expect(screen.getByText('The console server is unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    service.getConfig = getConfig;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('radio', { name: 'NVIDIA GPU' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  describe('a hint on Review when the chosen clusters don’t suit the hardware', () => {
    const withGpus = (gpuCapacity: number) => {
      const service = new MockConsoleService();
      service.clusters = service.clusters.map((c) => (c.name === cluster1 ? { ...c, gpuCapacity } : c));
      return service;
    };

    it('says a cluster without NVIDIA GPUs can’t run NVIDIA GPU', async () => {
      const user = userEvent.setup();
      await openDeployment(user, withGpus(0));
      await toReview(user, false);
      expect(await screen.findByTestId('model-hardware-mismatch')).toHaveTextContent(
        "site1 reports no NVIDIA GPUs, so the model can't run there",
      );
    });

    it('says CPU only leaves a GPU cluster’s GPUs unused', async () => {
      const user = userEvent.setup();
      // The mock's member clusters each report 16 GPUs.
      await openDeployment(user);
      await selectHardware(user, 'CPU only');
      await toReview(user, false);
      expect(await screen.findByTestId('model-hardware-mismatch')).toHaveTextContent(
        "site1 has GPUs that the model doesn't use with CPU only",
      );
    });

    it('gives no hint for other accelerators: the clusters count NVIDIA GPUs only', async () => {
      const user = userEvent.setup();
      const service = withGpus(0);
      service.config = {
        ...service.config,
        models: { hardware: [{ id: 'amd-gpu', label: 'AMD GPU', accelerator: 'amd.com/gpu', image: 'r/rocm:1' }] },
      };
      await openDeployment(user, service);
      await toReview(user, false);
      expect(await screen.findByTestId('model-review')).toBeVisible();
      expect(screen.queryByTestId('model-hardware-mismatch')).not.toBeInTheDocument();
    });

    it('matches the chosen clusters by name, not by location label', async () => {
      const user = userEvent.setup();
      const service = new MockConsoleService();
      // site1 has GPUs, so NVIDIA GPU suits it. site2 has none and a location label that happens to
      // equal site1's name; it isn't chosen, so it mustn't be warned about.
      service.clusters = service.clusters.map((c) =>
        c.name === cluster2 ? { ...c, gpuCapacity: 0, location: cluster1 } : c,
      );
      await openDeployment(user, service);
      await toReview(user, false);
      expect(await screen.findByTestId('model-review')).toBeVisible();
      expect(screen.queryByTestId('model-hardware-mismatch')).not.toBeInTheDocument();
    });
  });

  describe('a deployed model', () => {
    const openDeploymentStep = async (user: User) =>
      user.click(
        within(await screen.findByRole('navigation', { name: 'Wizard steps' })).getByRole('button', {
          name: 'Deployment',
        }),
      );

    /** granite-3-8b deployed without presets, with these requests, image and env. */
    const deployed = (requests: Record<string, string>, image: string, env: Record<string, string> = {}) => {
      const service = new MockConsoleService();
      const granite = modelsOf(service).find('granite-3-8b');
      granite.spec!.baseRefs = [];
      granite.spec!.main!.requests = requests;
      granite.spec!.main!.image = image;
      granite.spec!.main!.env = Object.entries(env).map(([name, value]) => ({
        $typeName: 'ai_grid.v1.ModelEnvVar',
        name,
        value,
      }));
      return service;
    };

    it('shows the accelerator it requests and its image on its page, and its edit starts on the hardware it matches', async () => {
      const service = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, '');
      const page = renderAt('/models/granite-3-8b', service);
      const details = await screen.findByLabelText('Deployment');
      expect(details).toHaveTextContent('Accelerators1 GPU (nvidia.com/gpu)');
      expect(details).toHaveTextContent("Runtime imageDefault (the cluster's vLLM image for NVIDIA GPUs)");
      expect(details).not.toHaveTextContent('Hardware');
      expect(details).not.toHaveTextContent('Presets');
      page.unmount();
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      // NVIDIA GPU deploys exactly this: one nvidia.com/gpu, no image, no environment.
      expect(await screen.findByRole('radio', { name: 'NVIDIA GPU' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'CPU only' })).not.toBeChecked();
      expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(1);
      expect(field(/^CPU/)).toHaveValue('2');
      expect(field(/^Memory/)).toHaveValue('16Gi');
      expect(screen.queryByRole('textbox', { name: 'Accelerators' })).not.toBeInTheDocument();
      await user.click(
        within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name: 'Review' }),
      );
      const review = await screen.findByTestId('model-review');
      expect(review).toHaveTextContent('HardwareNVIDIA GPU');
      expect(review).toHaveTextContent('GPUs1');
      // Nothing changed yet.
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });

    it('words what a model requests without the console’s hardware list, which may have changed or not load', async () => {
      const cpu = deployed({ cpu: '4', memory: '8Gi' }, 'registry.example/vllm-cpu:old', { OMP_NUM_THREADS: '4' });
      cpu.getConfig = () => Promise.reject(new ServiceError(503, 'The console server is unavailable.'));
      const first = renderAt('/models/granite-3-8b', cpu);
      const details = await screen.findByLabelText('Deployment');
      expect(details).toHaveTextContent('AcceleratorsNone (CPU only)');
      expect(details).toHaveTextContent('Runtime imageregistry.example/vllm-cpu:old');
      first.unmount();
      renderAt('/models/granite-3-8b', deployed({ 'amd.com/gpu': '2', 'habana.ai/gaudi': '1' }, 'r/vllm:1'));
      expect(await screen.findByLabelText('Deployment')).toHaveTextContent(
        'Accelerators2 GPUs (amd.com/gpu), 1 accelerator (habana.ai/gaudi)',
      );
    });

    it('keeps an image on a model without NVIDIA GPUs: the cluster’s default is for NVIDIA GPUs', async () => {
      const service = deployed({ cpu: '4', memory: '8Gi' }, cpuImage);
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      const image = await screen.findByRole('textbox', { name: /Runtime image/ });
      expect(image).toBeRequired();
      expect(image).toHaveAccessibleDescription("Enter a vLLM image for the model's hardware.");
      await setImage(user, '');
      await user.tab();
      expect(screen.getByRole('textbox', { name: /Runtime image/ })).toHaveAccessibleDescription(/Required\./);
      expect(
        within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name: 'Review' }),
      ).toBeDisabled();
    });

    it('saves an edit of a stored model without an image, NVIDIA GPUs, or presets, leaving its image alone', async () => {
      const service = deployed({ cpu: '4', memory: '8Gi' }, '');
      const update = vi.spyOn(modelsOf(service), 'update');
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      const description = await screen.findByRole('textbox', { name: 'Description' });
      await user.clear(description);
      await user.paste('Edited');
      await user.click(
        within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name: 'Review' }),
      );
      await user.click(await screen.findByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0][0].updateMask?.paths).toEqual(['metadata.annotations']);
    });

    it('says a cleared image runs the presets’ image, on NVIDIA GPUs too', async () => {
      const service = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, 'registry.example/vllm-cuda:1');
      modelsOf(service).find('granite-3-8b').spec!.baseRefs = ['custom-preset'];
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      expect(await screen.findByRole('textbox', { name: /Runtime image/ })).toHaveAccessibleDescription(
        'Leave empty to use the image the presets set.',
      );
    });

    it('shows its presets read-only, beside what it requests', async () => {
      const service = new MockConsoleService();
      modelsOf(service).find('granite-3-8b').spec!.baseRefs = ['custom-preset'];
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      const presets = await screen.findByRole('textbox', { name: 'Presets' });
      expect(presets).toHaveValue('custom-preset');
      expect(presets).toHaveAttribute('readonly');
      expect(presets).toHaveAccessibleDescription(
        'Set when the model was deployed. New models are deployed without presets.',
      );
      expect(screen.queryByRole('textbox', { name: 'Hardware' })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Accelerators' })).toHaveValue('None (CPU only)');
    });

    it('clears the image of a model on NVIDIA GPUs in an edit, and sends no presets', async () => {
      const service = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, 'registry.example/vllm-cuda:1');
      const update = vi.spyOn(modelsOf(service), 'update');
      const user = userEvent.setup();
      renderAt('/models/granite-3-8b/edit', service);
      await openDeploymentStep(user);
      expect(await screen.findByRole('textbox', { name: /Runtime image/ })).toHaveAccessibleDescription(
        defaultImageHelp,
      );
      await setImage(user, '');
      await user.click(
        within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name: 'Review' }),
      );
      expect(await screen.findByTestId('model-review')).toHaveTextContent(
        "Runtime imageDefault (the cluster's vLLM image for NVIDIA GPUs)",
      );
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      const [request] = update.mock.calls[0];
      expect(request.updateMask?.paths).toEqual(['spec.main.image']);
      expect(request.object?.spec?.main?.image).toBe('');
      expect(request.object?.spec?.baseRefs).toEqual([]);
    });
  });
});

describe('editing a model deployment', () => {
  const openStep = async (user: User, name: 'Source' | 'Deployment' | 'Clusters' | 'Review') =>
    user.click(within(await screen.findByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name }));

  it('reuses the deploy wizard: the served name read-only, every step open, and only the changed paths sent', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b', service);
    await user.click(await screen.findByRole('button', { name: 'Actions for Granite 3.3 8B Instruct' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit Granite 3.3 8B Instruct' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Model URI/ })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: /^Model URI/ })).toHaveValue('hf://example-org/granite-3-8b');
    expect(screen.getByRole('textbox', { name: 'Model name in requests' })).toHaveAttribute('readonly');
    await openStep(user, 'Review');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await openStep(user, 'Deployment');
    expect(screen.getByRole('textbox', { name: /^CPU/ })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: /^CPU/ })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Presets' })).toHaveAttribute('readonly');
    const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.paste('3');
    await openStep(user, 'Clusters');
    await user.click(await screen.findByRole('combobox', { name: 'Clusters' }));
    await user.click(screen.getByRole('option', { name: optionName(cluster2) }));
    await user.keyboard('{Escape}');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes to model Granite 3.3 8B Instruct saved to Git')).toBeVisible();
    const [request] = update.mock.calls[0];
    expect(request.updateMask?.paths).toEqual(['spec.replicas', 'spec.placement']);
    expect(request.lock).toBe(true);
    expect(request.object?.metadata?.version).toBe(1);
    expect(request.object?.spec?.replicas).toBe(3);
    expect(request.object?.spec?.placement?.labelSelector?.matchExpressions[0].values).toEqual(['site1', 'site2']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Granite 3.3 8B Instruct' })).toBeVisible();
    expect(await within(screen.getByTestId('model-locations')).findByText(site2)).toBeVisible();
  });

  it('sends the annotations and the env whole, keeping what the console doesn’t edit', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const granite = models.find('granite-3-8b');
    granite.metadata!.annotations.team = 'research';
    granite.spec!.main!.env = [{ $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' }];
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.paste('Updated description');
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    await user.click(screen.getByRole('textbox', { name: 'Additional runtime arguments' }));
    await user.paste('--enforce-eager');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const [request] = update.mock.calls[0];
    expect(request.updateMask?.paths).toEqual(['spec.main.env', 'metadata.annotations']);
    expect(request.object?.metadata?.annotations).toEqual({
      'openshift.io/display-name': 'Granite 3.3 8B Instruct',
      'openshift.io/description': 'Updated description',
      team: 'research',
    });
    expect(request.object?.spec?.main?.env.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
    ]);
  });

  it('leaves the display name alone when only the description changes on a model without one', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    delete models.find('granite-3-8b').metadata!.annotations['openshift.io/display-name'];
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.paste('new');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const annotations = update.mock.calls[0][0].object?.metadata?.annotations;
    expect(annotations).not.toHaveProperty('openshift.io/display-name');
    expect(annotations).toHaveProperty('openshift.io/description', 'new');
  });

  it('shows the name users send read-only, as the model has it', async () => {
    const service = new MockConsoleService();
    // A model written before the backend served models as their ids can keep another name.
    modelsOf(service).find('granite-3-8b').spec!.model!.name = 'example-org/granite-3-8b';
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    const served = await screen.findByRole('textbox', { name: 'Model name in requests' });
    expect(served).toHaveValue('example-org/granite-3-8b');
    expect(served).toHaveAttribute('readonly');
    expect(
      screen.getByText(/Users send this name as the model in their requests\. It cannot be edited\./),
    ).toBeInTheDocument();
    await openStep(user, 'Review');
    const review = await screen.findByTestId('model-review');
    expect(review).toHaveTextContent('Model name in requestsexample-org/granite-3-8b');
    expect(within(review).getAllByText('Model name in requests')).toHaveLength(1);
  });

  it("says a model that still serves an older name fails users' requests until any change is saved", async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    // Saved before the backend served models as their ids: it still serves its own name.
    models.find('granite-3-8b').spec!.model!.name = 'example-org/granite-3-8b';
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    const alert = await screen.findByTestId('model-older-name');
    expect(alert).toHaveClass('pf-m-info');
    expect(within(alert).getByRole('heading', { name: /This model uses an older name/ })).toBeVisible();
    expect(alert).toHaveTextContent(
      'Users request models by their ID, granite-3-8b, but this model still answers only to example-org/granite-3-8b, so their requests to it fail. Saving any change updates it to use its ID. The model is unavailable for a moment while it restarts.',
    );
    expect([...alert.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'granite-3-8b',
      'example-org/granite-3-8b',
    ]);
    await openStep(user, 'Deployment');
    expect(screen.queryByTestId('model-older-name')).not.toBeInTheDocument();
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.paste('new');
    await openStep(user, 'Review');
    expect(within(screen.getByTestId('model-review')).getByTestId('model-older-name')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes to model Granite 3.3 8B Instruct saved to Git')).toBeVisible();
    // The edit sends no served name: the backend switches the model to its id on any update.
    const [request] = update.mock.calls[0];
    expect(request.updateMask?.paths).toEqual(['metadata.annotations']);
    expect(request.object?.spec?.model).toBeUndefined();
    expect(models.find('granite-3-8b').spec?.model?.name).toBe('granite-3-8b');
  });

  it('shows no older-name alert for a model served as its id', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    expect(await screen.findByRole('textbox', { name: 'Model name in requests' })).toHaveValue('granite-3-8b');
    expect(screen.queryByTestId('model-older-name')).not.toBeInTheDocument();
    await openStep(user, 'Review');
    expect(await screen.findByTestId('model-review')).toBeVisible();
    expect(screen.queryByTestId('model-older-name')).not.toBeInTheDocument();
  });

  it('leaves a resource the model was deployed without empty and optional, and adds none', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    models.find('granite-3-8b').spec!.main!.requests = {};
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const cpu = await screen.findByRole('textbox', { name: 'CPU' });
    expect(cpu).toHaveValue('');
    expect(cpu).not.toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Memory' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Memory' })).not.toBeRequired();
    await user.click(cpu);
    await user.tab();
    expect(cpu).toHaveAccessibleDescription('In cores or millicores. For example, 2 or 500m.');
    await user.click(screen.getByRole('textbox', { name: 'Description' }));
    await user.paste(' (edited)');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].updateMask?.paths).toEqual(['metadata.annotations']);
  });

  it('treats spaces around a runtime argument as no change', async () => {
    const service = new MockConsoleService();
    modelsOf(service).find('granite-3-8b').spec!.main!.env = [
      { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
    ];
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    await user.click(await screen.findByRole('button', { name: 'Advanced settings' }));
    const end = '--enforce-eager'.length;
    await user.type(screen.getByRole('textbox', { name: 'Additional runtime arguments' }), ' ', {
      initialSelectionStart: end,
      initialSelectionEnd: end,
    });
    await openStep(user, 'Review');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows a placement the console doesn’t write read-only and leaves it alone', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const granite = models.find('granite-3-8b');
    granite.spec!.placement!.clusterSets = ['global'];
    // Its location labels differ from its clusters' names: the step shows the clusters.
    granite.status!.placement!.locations = ['somewhere'];
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Clusters');
    const placed = await screen.findByRole('textbox', { name: 'Clusters' });
    expect(placed).toHaveAttribute('readonly');
    expect(placed).toHaveValue(granite.status!.placement!.selectedClusters.join(', '));
    expect(screen.getByText(/selects clusters by more than their names/)).toBeVisible();
    await openStep(user, 'Deployment');
    const replicas = screen.getByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.paste('2');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].updateMask?.paths).toEqual(['spec.replicas']);
  });

  it('saves against the version the edit started from, whatever a refetch brings in meanwhile', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const get = vi.spyOn(models, 'get');
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const replicas = await screen.findByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.paste('4');
    // Another tab saves; then the window regains focus, and the model is read again.
    models.find('granite-3-8b').metadata!.version = 2;
    const reads = get.mock.calls.length;
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(reads));
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    // The edit's version, not the refetched one: the backend refuses it, and the page says so.
    expect(update.mock.calls[0][0].object?.metadata?.version).toBe(1);
    expect(
      await screen.findByText('This model was changed by another user. Reload the page to edit the latest version.'),
    ).toBeVisible();
    act(() => focusManager.setFocused(undefined));
  });

  it('says the deployment changed when the version it opened is stale', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const replicas = await screen.findByRole('spinbutton', { name: 'Replicas' });
    await user.clear(replicas);
    await user.paste('4');
    // Another tab saves first.
    models.find('granite-3-8b').metadata!.version = 9;
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('This model was changed by another user. Reload the page to edit the latest version.'),
    ).toBeVisible();
  });

  it('saves an unrelated change while a kept cluster is not offered, or the clusters fail to load', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const update = vi.spyOn(models, 'update');
    let calls = 0;
    models.placementClusters = async () => {
      if (calls++ === 0) return ['site2'];
      throw new ConnectError('Location catalog unavailable.', Code.Unavailable);
    };
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Clusters');
    await openStep(user, 'Deployment');
    const description = await screen.findByRole('textbox', { name: 'Description' });
    await user.clear(description);
    await user.paste('Still on site1');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].updateMask?.paths).toEqual(['metadata.annotations']);
  });

  it.each([
    ['no stored count', undefined],
    ['a count outside the deploy wizard’s limits', 0],
  ])('leaves the replicas alone when the model has %s', async (_, replicas) => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    models.find('granite-3-8b').spec!.replicas = replicas;
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    await user.click(await screen.findByRole('textbox', { name: 'Description' }));
    await user.paste(' (edited)');
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].updateMask?.paths).not.toContain('spec.replicas');
  });

  it('shows an autoscaled model’s replicas as Autoscaled, on its step and in Review', async () => {
    const service = new MockConsoleService();
    const granite = modelsOf(service).find('granite-3-8b');
    granite.spec!.replicas = undefined;
    granite.spec!.scaling = {
      $typeName: 'ai_grid.v1.ModelScaling',
      minReplicas: 1,
      maxReplicas: 3,
      keda: true,
      triggers: [],
    };
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    expect(await screen.findByRole('textbox', { name: 'Replicas' })).toHaveValue('Autoscaled');
    await openStep(user, 'Review');
    expect(within(await screen.findByTestId('model-review')).getByText('Autoscaled')).toBeVisible();
  });

  it("shows the backend's refusal and keeps the input", async () => {
    const service = new MockConsoleService();
    vi.spyOn(modelsOf(service), 'update').mockImplementation(() => {
      throw new ConnectError('spec.main.image: Invalid value', Code.InvalidArgument);
    });
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    await user.clear(await screen.findByRole('textbox', { name: 'Description' }));
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('spec.main.image: Invalid value')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await openStep(user, 'Deployment');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
  });

  it('offers Edit from the list, next to the details and Delete', async () => {
    const user = userEvent.setup();
    renderAt('/models', new MockConsoleService());
    await user.click(await screen.findByRole('button', { name: 'Actions for Granite 3.3 8B Instruct' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['View details', 'Edit', 'Delete']);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit Granite 3.3 8B Instruct' })).toBeVisible();
  });
});

describe('editing what a deployed model runs', () => {
  const cpuOnly = configExample.body.data.models.hardware.find((h) => h.id === 'cpu')!;
  const cpuHint = 'For long-context models on CPU, set --max-model-len in Advanced settings.';
  const openStep = async (user: User, name: 'Source' | 'Deployment' | 'Clusters' | 'Review') =>
    user.click(within(await screen.findByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name }));
  const field = (name: string | RegExp) => screen.getByRole('textbox', { name });
  const replace = async (user: User, name: string | RegExp, value: string) => {
    await user.clear(field(name));
    if (value) await user.paste(value);
  };

  /** granite-3-8b deployed without presets, with these requests, image and env; its update spy. */
  const deployed = (requests: Record<string, string>, image: string, env: Record<string, string> = {}) => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const granite = models.find('granite-3-8b');
    granite.spec!.baseRefs = [];
    granite.spec!.main!.requests = requests;
    granite.spec!.main!.image = image;
    granite.spec!.main!.env = Object.entries(env).map(([name, value]) => ({
      $typeName: 'ai_grid.v1.ModelEnvVar',
      name,
      value,
    }));
    return { service, models, update: vi.spyOn(models, 'update') };
  };

  /** Opens Review, saves, and returns the Models/Update request. */
  const save = async (user: User, update: ReturnType<typeof deployed>['update']) => {
    await openStep(user, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    return update.mock.calls[0][0];
  };

  const envOf = (env: { name: string; value: string }[] | undefined) =>
    env?.map(({ name, value }) => ({ name, value }));

  it('edits the model URI, says on Review that users get the new model under the same name, and sends spec.model', async () => {
    const { service, update } = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, '');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    const uri = await screen.findByRole('textbox', { name: /^Model URI/ });
    expect(uri).toBeRequired();
    await openStep(user, 'Review');
    expect(screen.queryByTestId('model-uri-changed')).not.toBeInTheDocument();
    await openStep(user, 'Source');
    await replace(user, /^Model URI/, 'hf://example-org/granite-3.3-8b-instruct');
    await openStep(user, 'Review');
    const review = screen.getByTestId('model-review');
    expect(review).toHaveTextContent('Model URIhf://example-org/granite-3.3-8b-instruct');
    const warning = within(review).getByTestId('model-uri-changed');
    expect(warning).toHaveClass('pf-m-warning');
    expect(within(warning).getByRole('heading', { name: /This changes the model users are served/ })).toBeVisible();
    expect(warning).toHaveTextContent(
      'Once the change rolls out, requests for granite-3-8b are answered by the model at the new URI. Subscriptions that include this model serve the new one under the same name.',
    );
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.model']);
    // The URI only: the backend serves the model as its id whatever an update sends.
    expect(request.object?.spec?.model).toEqual(
      expect.objectContaining({ uri: 'hf://example-org/granite-3.3-8b-instruct', name: '' }),
    );
    expect(await screen.findByText('Changes to model Granite 3.3 8B Instruct saved to Git')).toBeVisible();
    expect(await screen.findByLabelText('Deployment')).toHaveTextContent(
      'Model URIhf://example-org/granite-3.3-8b-instruct',
    );
  });

  it('checks a new model URI as Deploy does, and keeps one the model already has', async () => {
    const { service, models } = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, '');
    // The backend takes https:// URIs; the Deploy wizard offers hf, oci, s3, and pvc only.
    models.find('granite-3-8b').spec!.model!.uri = 'https://models.example.com/granite';
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    const uri = await screen.findByRole('textbox', { name: /^Model URI/ });
    await user.click(uri);
    await user.tab();
    expect(uri).toHaveAccessibleDescription(/^For example, hf:\/\/org\/model/);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    await replace(user, /^Model URI/, 'https://models.example.com/other');
    await user.tab();
    expect(uri).toHaveAccessibleDescription(/^Enter a model URI using hf, oci, s3 or pvc\./);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await replace(user, /^Model URI/, '');
    expect(uri).toHaveAccessibleDescription(/^Required\./);
  });

  it('edits CPU and memory, sending the requests whole with every other resource kept', async () => {
    const { service, update } = deployed(
      { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1', 'ephemeral-storage': '20Gi' },
      '',
    );
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    expect(await screen.findByRole('textbox', { name: /^CPU/ })).toBeRequired();
    // Without presets there is nothing to remove.
    expect(screen.queryByRole('checkbox', { name: 'Remove presets' })).not.toBeInTheDocument();
    await replace(user, /^CPU/, '4');
    await replace(user, /^Memory/, '32Gi');
    await openStep(user, 'Review');
    const review = screen.getByTestId('model-review');
    expect(review).toHaveTextContent('CPU4');
    expect(review).toHaveTextContent('Memory32Gi');
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.requests']);
    expect(request.object?.spec?.main?.requests).toEqual({
      cpu: '4',
      memory: '32Gi',
      'nvidia.com/gpu': '1',
      'ephemeral-storage': '20Gi',
    });
    const details = await screen.findByLabelText('Deployment');
    expect(details).toHaveTextContent('CPU4');
    expect(details).toHaveTextContent('Memory32Gi');
  });

  it('edits the GPU count of a model on NVIDIA GPUs', async () => {
    const { service, update } = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, '');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const gpus = await screen.findByRole('spinbutton', { name: 'GPUs' });
    await user.clear(gpus);
    await user.type(gpus, '2');
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.requests']);
    expect(request.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '2' });
  });

  it('checks CPU, memory, and GPUs as Deploy does, and keeps values the model already has', async () => {
    // Values the backend took that the Deploy wizard doesn't write: 16G (not Gi) and 80 GPUs (over 64).
    const { service } = deployed({ cpu: '2', memory: '16G', 'nvidia.com/gpu': '80' }, '');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const memory = await screen.findByRole('textbox', { name: /^Memory/ });
    await user.click(memory);
    await user.tab();
    expect(memory).toHaveAccessibleDescription('For example, 4Gi or 512Mi.');
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(80);
    const reviewNav = () =>
      within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', { name: 'Review' });
    expect(reviewNav()).toBeEnabled();
    await replace(user, /^CPU/, 'two');
    await user.tab();
    expect(field(/^CPU/)).toHaveAccessibleDescription(
      /^Enter positive CPU cores or millicores, for example 2 or 500m\./,
    );
    expect(reviewNav()).toBeDisabled();
    await replace(user, /^CPU/, '');
    await user.tab();
    expect(field(/^CPU/)).toHaveAccessibleDescription(/^Required\./);
    await replace(user, /^CPU/, '2');
    expect(reviewNav()).toBeEnabled();
    await replace(user, /^Memory/, '16GB');
    await user.tab();
    expect(memory).toHaveAccessibleDescription(/^Enter memory such as 4Gi or 512Mi\./);
    await replace(user, /^Memory/, '16G');
    const gpus = screen.getByRole('spinbutton', { name: 'GPUs' });
    await user.clear(gpus);
    await user.type(gpus, '0');
    await user.tab();
    expect(gpus).toHaveAccessibleDescription(/Enter a number from 1 to 64\./);
    expect(reviewNav()).toBeDisabled();
  });

  it('applies other hardware as Deploy does, and goes back to the model’s own values when its hardware is selected again', async () => {
    const { service, update } = deployed({ cpu: '3', memory: '12Gi', 'nvidia.com/gpu': '2' }, '', { TEAM: 'research' });
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    expect(await screen.findByRole('radio', { name: 'NVIDIA GPU' })).toBeChecked();
    expect(field(/^Memory/)).toHaveAccessibleDescription('For example, 4Gi or 512Mi.');
    await selectHardware(user, 'CPU only');
    expect(field(/Runtime image/)).toHaveValue(cpuOnly.image);
    expect(field(/Runtime image/)).toBeRequired();
    expect(field(/^CPU/)).toHaveValue('4');
    expect(field(/^Memory/)).toHaveValue('8Gi');
    expect(field(/^Memory/)).toHaveAccessibleDescription(`For example, 4Gi or 512Mi. ${cpuHint}`);
    expect(screen.queryByRole('spinbutton', { name: 'GPUs' })).not.toBeInTheDocument();
    await openStep(user, 'Review');
    const review = screen.getByTestId('model-review');
    expect(review).toHaveTextContent('HardwareCPU only');
    expect(review).toHaveTextContent('AcceleratorsNone (CPU only)');
    await openStep(user, 'Deployment');
    await selectHardware(user, 'NVIDIA GPU');
    expect(field(/Runtime image/)).toHaveValue('');
    expect(field(/^CPU/)).toHaveValue('3');
    expect(field(/^Memory/)).toHaveValue('12Gi');
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(2);
    await openStep(user, 'Review');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await openStep(user, 'Deployment');
    await selectHardware(user, 'CPU only');
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.image', 'spec.main.requests', 'spec.main.env']);
    expect(request.object?.spec?.main?.image).toBe(cpuOnly.image);
    expect(request.object?.spec?.main?.requests).toEqual({ cpu: '4', memory: '8Gi' });
    expect(envOf(request.object?.spec?.main?.env)).toEqual([
      { name: 'TEAM', value: 'research' },
      { name: 'OMP_NUM_THREADS', value: '4' },
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
    ]);
  });

  it('starts a model that matches no hardware on none, its accelerators read-only, until the user selects one', async () => {
    const { service, update } = deployed({ cpu: '4', memory: '8Gi', 'amd.com/gpu': '2' }, 'registry.example/rocm:1', {
      VLLM_CPU_KVCACHE_SPACE: '4',
      TEAM: 'research',
      VLLM_ADDITIONAL_ARGS: '--enforce-eager',
    });
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    expect(await screen.findByRole('radio', { name: 'NVIDIA GPU' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'CPU only' })).not.toBeChecked();
    expect(
      screen.getByText(
        "The model's current settings match none of these. Select one to apply its runtime image, environment, and resources.",
      ),
    ).toBeVisible();
    const accelerators = field('Accelerators');
    expect(accelerators).toHaveValue('2 GPUs (amd.com/gpu)');
    expect(accelerators).toHaveAttribute('readonly');
    expect(accelerators).toHaveAccessibleDescription('Select hardware to edit the accelerators.');
    await openStep(user, 'Review');
    expect(screen.getByTestId('model-review')).toHaveTextContent('Accelerators2 GPUs (amd.com/gpu)');
    expect(screen.getByTestId('model-review')).not.toHaveTextContent('Hardware');
    await openStep(user, 'Deployment');
    await selectHardware(user, 'NVIDIA GPU');
    expect(screen.queryByText(/match none of these/)).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'GPUs' })).toHaveValue(1);
    expect(field(/Runtime image/)).toHaveValue('');
    expect(field(/^CPU/)).toHaveValue('2');
    expect(field(/^Memory/)).toHaveValue('16Gi');
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.image', 'spec.main.requests', 'spec.main.env']);
    expect(request.object?.spec?.main?.image).toBe('');
    // The AMD GPUs give way to the NVIDIA GPU; CPU only's variable goes, the model's own stays.
    expect(request.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' });
    expect(envOf(request.object?.spec?.main?.env)).toEqual([
      { name: 'TEAM', value: 'research' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
    ]);
  });

  it('removes the presets, sending spec.base_refs empty, and says so on Review', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    // Presets set part of the image and environment, so no hardware matches.
    expect(await screen.findByRole('radio', { name: 'NVIDIA GPU' })).not.toBeChecked();
    expect(field('Presets')).toHaveValue('v3-6-0-kserve-config-llm-template-cpu');
    const remove = screen.getByRole('checkbox', { name: 'Remove presets' });
    expect(remove).not.toBeChecked();
    expect(remove).toHaveAccessibleDescription(
      "The model then uses only the runtime image, environment, and resources set here. Presets can't be added back.",
    );
    await user.click(remove);
    await openStep(user, 'Review');
    expect(screen.getByTestId('model-review')).toHaveTextContent(
      'PresetsNone (v3-6-0-kserve-config-llm-template-cpu removed)',
    );
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.base_refs']);
    expect(request.object?.spec?.baseRefs).toEqual([]);
    expect(await screen.findByText('Changes to model Granite 3.3 8B Instruct saved to Git')).toBeVisible();
    expect(models.find('granite-3-8b').spec?.baseRefs).toEqual([]);
    expect(await screen.findByLabelText('Deployment')).not.toHaveTextContent('Presets');
  });

  it('requires an image once the presets that set it are removed, off NVIDIA GPUs', async () => {
    const service = new MockConsoleService();
    const models = modelsOf(service);
    models.find('granite-3-8b').spec!.main!.image = '';
    const update = vi.spyOn(models, 'update');
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const image = await screen.findByRole('textbox', { name: /Runtime image/ });
    expect(image).not.toBeRequired();
    expect(image).toHaveAccessibleDescription('Leave empty to use the image the presets set.');
    await user.click(screen.getByRole('checkbox', { name: 'Remove presets' }));
    expect(image).toBeRequired();
    expect(image).toHaveAccessibleDescription("Enter a vLLM image for the model's hardware.");
    const reviewNav = within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', {
      name: 'Review',
    });
    expect(reviewNav).toBeDisabled();
    await user.click(image);
    await user.paste('registry.example/vllm-cpu:1');
    expect(reviewNav).toBeEnabled();
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.base_refs', 'spec.main.image']);
    expect(request.object?.spec?.main?.image).toBe('registry.example/vllm-cpu:1');
  });

  it('checks the image against the hardware the user selects: optional on NVIDIA GPUs, required on others', async () => {
    // Stored without an image or presets on CPU: the edit keeps that until other hardware is selected.
    const { service, update } = deployed({ cpu: '4', memory: '8Gi' }, '');
    service.config = {
      ...service.config,
      models: {
        hardware: [
          ...service.config.models.hardware,
          { id: 'amd-gpu', label: 'AMD GPU', accelerator: 'amd.com/gpu', defaults: { accelerators: 1 } },
        ],
      },
    };
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    const image = await screen.findByRole('textbox', { name: /Runtime image/ });
    expect(image).not.toBeRequired();
    await selectHardware(user, 'AMD GPU');
    expect(image).toBeRequired();
    expect(image).toHaveAccessibleDescription('Enter a vLLM image for this hardware.');
    const reviewNav = within(screen.getByRole('navigation', { name: 'Wizard steps' })).getByRole('button', {
      name: 'Review',
    });
    expect(reviewNav).toBeDisabled();
    await selectHardware(user, 'NVIDIA GPU');
    expect(image).not.toBeRequired();
    expect(image).toHaveAccessibleDescription("Leave empty to use the cluster's default vLLM image for NVIDIA GPUs.");
    expect(reviewNav).toBeEnabled();
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.requests']);
    expect(request.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' });
  });

  it('saves an edit while the hardware list fails to load, keeping what the model requests', async () => {
    const { service, update } = deployed({ cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, '');
    service.getConfig = () => Promise.reject(new ServiceError(503, 'The console server is unavailable.'));
    const user = userEvent.setup();
    renderAt('/models/granite-3-8b/edit', service);
    await openStep(user, 'Deployment');
    expect(await screen.findByText('Unable to load hardware')).toBeVisible();
    expect(field('Accelerators')).toHaveValue('1 GPU (nvidia.com/gpu)');
    await replace(user, /^CPU/, '6');
    const request = await save(user, update);
    expect(request.updateMask?.paths).toEqual(['spec.main.requests']);
    expect(request.object?.spec?.main?.requests).toEqual({ cpu: '6', memory: '16Gi', 'nvidia.com/gpu': '1' });
  });
});

it('shows the loading spinner until the models arrive, then the list in its place', async () => {
  const service = new MockConsoleService();
  const models = modelsOf(service);
  const release = deferred<void>();
  const list = models.list;
  vi.spyOn(models, 'list').mockImplementationOnce(async (req, ctx) => {
    await release.promise;
    return list(req, ctx);
  });
  renderAt('/models', service);
  const spinner = await screen.findByRole('progressbar', { name: 'Loading models' });
  expect(spinner.closest('.pf-v6-c-page__main-section')).toHaveClass('pf-m-fill');
  expect(screen.queryByRole('grid', { name: 'Models' })).not.toBeInTheDocument();
  await act(async () => release.resolve());
  expect(await screen.findByRole('grid', { name: 'Models' })).toBeVisible();
  expect(screen.queryByRole('progressbar', { name: 'Loading models' })).not.toBeInTheDocument();
});

describe('each cluster of a placed model (status.clusters, proposal P13)', () => {
  /** Mistral on three clusters, ready on one, as the backend reports it. */
  const partial = () => {
    const service = new MockConsoleService();
    modelsOf(service).models.push(
      modelObject({
        id: 'mistral-7b-instruct',
        metadata: {
          name: 'mistral-7b-instruct',
          version: 4,
          annotations: { 'openshift.io/display-name': 'Mistral 7B Instruct' },
        },
        spec: {
          model: { uri: 'hf://mistralai/mistral-7b-instruct', name: 'mistral-7b-instruct' },
          replicas: 1,
          placement: {
            labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: ['site1', 'site2', 'site3'] }] },
          },
        },
        status: {
          phase: ModelPhase.PARTIALLY_AVAILABLE,
          reason: 'PartiallyAvailable',
          // The summary counts every reporting cluster, an ingress one (hub-ingress) included; only the
          // placed ones have an entry in `clusters`.
          message: 'Not ready on site2; ready on hub-ingress, site1; no report from site3',
          placement: { selectedClusters: ['site1', 'site2', 'site3'], locations: ['site1', 'site2', 'site3'] },
          clusters: [
            { cluster: 'site1', phase: ModelPhase.READY, reason: 'Ready', message: 'LLMInferenceService ready' },
            {
              cluster: 'site2',
              phase: ModelPhase.PENDING,
              reason: 'NotReady',
              message: 'LLMInferenceService not ready',
            },
            {
              cluster: 'site3',
              phase: ModelPhase.PENDING,
              reason: 'NoReport',
              message: 'No LLMInferenceService report',
            },
          ],
        },
      }),
    );
    return service;
  };

  it('expands a model to each placed cluster the backend reports, named by its location', async () => {
    const user = userEvent.setup();
    renderAt('/models', partial());
    const row = await rowOf('mistral-7b-instruct');
    expect(within(row).getByTestId('model-phase')).toHaveTextContent('Partially available');
    await user.click(within(row).getByRole('button', { name: 'Details' }));
    const rows = screen.getAllByTestId('model-cluster-row');
    // As the backend lists them: hub-ingress, in the message only, has no row.
    expect(rows.map((r) => within(r).getByTestId('model-cluster-phase').textContent)).toEqual([
      `Ready at ${site1}`,
      `Pending at ${site2}`,
      `Pending at ${site3}`,
    ]);
    const location = within(rows[0]).getByTestId('model-cluster-location');
    expect(location).toHaveTextContent(`${site1}, cluster site1`);
    await user.hover(location);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Cluster: site1');
    // The column is all clickable: every row's status is a button.
    for (const r of rows) expect(within(r).getByRole('button')).toBeInTheDocument();
  });

  it('opens what a cluster reported, and offers Edit model', async () => {
    const user = userEvent.setup();
    renderAt('/models', partial());
    await user.click(within(await rowOf('mistral-7b-instruct')).getByRole('button', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: `Pending at ${site2}` }));
    const modal = await screen.findByTestId('cluster-status-modal');
    expect(within(modal).getByRole('heading', { name: /Mistral 7B Instruct status/ })).toBeVisible();
    expect(modal).toHaveTextContent(site2);
    expect(modal).toHaveTextContent('on cluster site2');
    expect(modal).toHaveTextContent('NotReady');
    expect(modal).toHaveTextContent('LLMInferenceService not ready');
    await user.click(within(modal).getByRole('button', { name: 'Edit model' }));
    expect(await screen.findByRole('heading', { name: /^Edit / })).toBeVisible();
  });

  it('lists the same clusters on the model page', async () => {
    renderAt('/models/mistral-7b-instruct', partial());
    const table = await screen.findByTestId('model-clusters-mistral-7b-instruct');
    expect(screen.getByTestId('model-locations')).toContainElement(table);
    expect(await within(table).findByRole('button', { name: `Ready at ${site1}` })).toBeVisible();
  });
});

describe('the Models list expands every row', () => {
  it('gives every row the expand toggle, named Details, collapsed until clicked', async () => {
    const user = userEvent.setup();
    renderAt('/models', new MockConsoleService());
    for (const id of ['granite-3-8b', 'llama-3-70b', 'granite-research']) {
      expect(within(await rowOf(id)).getByRole('button', { name: 'Details' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    const toggle = within(await rowOf('llama-3-70b')).getByRole('button', { name: 'Details' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('expands a model without locations to say so, with Edit locations for a provider admin', async () => {
    const user = userEvent.setup();
    renderAt('/models', new MockConsoleService());
    await user.click(within(await rowOf('llama-3-70b')).getByRole('button', { name: 'Details' }));
    const empty = await screen.findByTestId('model-not-placed-llama-3-70b');
    expect(within(empty).getByRole('heading', { name: 'No locations' })).toBeVisible();
    await user.click(within(empty).getByRole('button', { name: 'Edit locations' }));
    expect(await screen.findByRole('heading', { name: /^Edit / })).toBeVisible();
  });

  it('lists the clusters the placement chose while none has reported, without a Status column', async () => {
    const user = userEvent.setup();
    const service = new MockConsoleService();
    widget(service);
    renderAt('/models', service);
    await user.click(within(await rowOf('widget')).getByRole('button', { name: 'Details' }));
    const selected = await screen.findByTestId('model-selected-clusters-widget');
    expect(selected).toHaveTextContent('No cluster has reported a status for this model.');
    expect(
      within(selected)
        .getAllByTestId('model-selected-cluster-row')
        .map((r) => r.textContent),
    ).toEqual([`${site1}, cluster site1`]);
    expect(within(selected).queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('offers no Edit locations to a user the console could not load', async () => {
    const user = userEvent.setup();
    renderAt('/models', unknownUser());
    await user.click(within(await rowOf('llama-3-70b')).getByRole('button', { name: 'Details' }));
    const empty = await screen.findByTestId('model-not-placed-llama-3-70b');
    expect(within(empty).queryByRole('button', { name: 'Edit locations' })).not.toBeInTheDocument();
  });
});

// Ported from krisv/ai-grid-cloud-provider-poc src/app/__tests__/subscriptions.test.tsx at 62319b8.
// The PoC drives its mock service; here the same cases run on MockConsoleService, which follows
// the fake backend's rules (bff/internal/fakebackend/subscriptions.go).
// Rulings and scope:
// - "preserves user input on update conflict" is renamed "keeps input on conflict" (B8, D7).
// - The create case also picks an organization, which the console requires.
// - The PoC's failNext becomes a one-shot replacement of the service method.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import { App } from '../App';
import { ServiceError } from '../api/ConsoleService';
import { MockConsoleService, seedSubscriptions } from '../api/MockConsoleService';
import type { ConditionStatus, MaaSSubscription } from '../api/types';
import { isSameModel } from '../utilities/authpolicies';
import { serviceOnPr12Json } from './pr12Json';
import { renderAt } from './render';

/** A user the console couldn't load: the pages show, but without write actions. A viewer
 * (isProviderAdmin false) sees no pages at all (App.test.tsx). */
const unknownUser = () => {
  const service = new MockConsoleService();
  service.getUser = () => Promise.reject(new ServiceError(500, 'unavailable'));
  return service;
};

type User = ReturnType<typeof userEvent.setup>;

/** Picks an organization in the create form's Organization select. */
const pickOrganization = async (user: User, name: string) => {
  await user.click(await screen.findByRole('combobox', { name: 'Organization' }));
  await user.click(screen.getByRole('option', { name }));
};

/** Fills the create form for "Test team" with one group and granite-3-8b at the default limit. */
const fillNewSubscription = async (user: User) => {
  const name = await screen.findByTestId('subscription-name-desc-name');
  await user.type(name, 'Test team');
  await user.type(screen.getByRole('combobox', { name: 'Enter groups' }), 'engineering');
  const option = await screen.findByRole('option', { name: 'Add group "engineering"' });
  await user.click(option.querySelector('button') ?? option);
  await user.keyboard('{Escape}');
  await user.click(screen.getByTestId('add-models-button'));
  await user.click(screen.getByTestId('toggle-model-granite-3-8b'));
  await user.click(screen.getByTestId('confirm-add-models'));
  await user.click(screen.getByTestId('add-token-limit-0'));
  await user.click(screen.getByTestId('save-rate-limits'));
};

describe('administrator subscription flows', () => {
  it('renders the list with its groups, filters and shows details', async () => {
    const user = userEvent.setup();
    renderAt('/subscriptions', new MockConsoleService());
    const table = await screen.findByTestId('subscriptions-table');
    expect(within(table).getByRole('link', { name: 'Engineering' })).toBeVisible();
    const row = within(table).getByRole('link', { name: 'Engineering' }).closest('tr')!;
    // Groups and models are short lists in their cells, not nested tables.
    expect(within(row).getByTestId('subscription-groups')).toHaveTextContent('engineering');
    expect(within(row).getByTestId('subscription-models')).toHaveTextContent('Granite');
    await user.type(screen.getByTestId('subscriptions-filter-input').querySelector('input')!, 'production');
    expect(within(table).queryByRole('link', { name: 'Research' })).not.toBeInTheDocument();
    await user.click(within(table).getByRole('link', { name: 'Engineering' }));
    expect(await screen.findByRole('heading', { name: 'Engineering', level: 1 })).toBeVisible();
    // One view: no single "Details" tab, and no Name row repeating the title.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    const details = screen.getByTestId('subscription-details-section');
    expect(details).not.toHaveTextContent(/^Name/);
    expect(within(details).getByTestId('subscription-priority')).toHaveTextContent('100');
    // The backend lists every policy covering one of its models, so the term says so; a policy's
    // phase reads as itself (Active), not as a subscription's Ready.
    const policies = within(details).getByTestId('subscription-auth-policies');
    expect(policies).toHaveTextContent('Engineering policy');
    expect(policies).toHaveTextContent('Active');
    expect(policies).not.toHaveTextContent('Ready');
    expect(within(details).getByText('Policies for its models')).toBeVisible();
    expect(screen.getByTestId('subscription-models-table')).toHaveTextContent('100,000 / 1 hour');
    expect(screen.getByTestId('subscription-models-table')).toHaveTextContent('Ready');
  });

  it('creates a subscription using the group and model selectors and token-limit modal', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/subscriptions/create', service);
    await screen.findByTestId('subscription-name-desc-name');
    expect(screen.queryByTestId('subscription-create-auth-policy')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-subscription-button')).toBeDisabled();
    await pickOrganization(user, 'acme-robotics');
    await user.type(screen.getByTestId('subscription-name-desc-name'), 'Test team');
    await user.type(screen.getByRole('combobox', { name: 'Enter groups' }), 'engineering');
    const option = await screen.findByRole('option', { name: 'Add group "engineering"' });
    await user.click(option.querySelector('button') ?? option);
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('add-models-button'));
    const modelsTable = screen.getByTestId('add-models-table');
    expect(within(modelsTable).getByRole('columnheader', { name: /Model name/ })).toBeVisible();
    for (const heading of ['Project', 'Model ID', 'Subscriptions', 'Policies']) {
      expect(within(modelsTable).queryByRole('columnheader', { name: heading })).not.toBeInTheDocument();
    }
    await user.click(screen.getByTestId('toggle-model-granite-3-8b'));
    await user.click(screen.getByTestId('confirm-add-models'));
    expect(screen.getByTestId('create-subscription-button')).toBeDisabled();
    await user.click(screen.getByTestId('add-token-limit-0'));
    await user.click(screen.getByTestId('save-rate-limits'));
    await user.click(screen.getByTestId('create-subscription-button'));
    await screen.findByTestId('subscriptions-table');
    expect(await screen.findByRole('link', { name: 'Test team' })).toBeVisible();
    expect(await screen.findByText('Subscription created')).toBeVisible();
    const info = await service.getSubscriptionInfo('test-team');
    expect(info.subscription.modelRefs[0].tokenRateLimits).toEqual([{ limit: 1000, window: '1h' }]);
    expect(info.authPolicies.some((p) => p.name === 'test-team-policy')).toBe(true);
    // Before the controller's first reconcile a subscription has no phase.
    expect(info.subscription.phase).toBeUndefined();
  }, 20000);

  it('edits without losing billing or metering configuration', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/subscriptions/edit/engineering', service);
    const name = await screen.findByTestId('subscription-name-desc-name');
    expect(screen.queryByTestId('subscription-create-auth-policy')).not.toBeInTheDocument();
    await user.clear(name);
    await user.type(name, 'Engineering updated');
    await user.click(screen.getByTestId('update-subscription-button'));
    expect(await screen.findByRole('link', { name: 'Engineering updated' })).toBeVisible();
    const info = await service.getSubscriptionInfo('engineering');
    expect(info.subscription.modelRefs[0].billingRate?.perToken).toBe('0.000002');
    expect(info.subscription.tokenMetadata?.costCenter).toBe('engineering');
    expect(info.subscription.tokenMetadata?.organizationId).toBe('3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c');
  });

  it('requires typed confirmation and retains the dialog on delete failure', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/subscriptions/view/engineering', service);
    await screen.findByTestId('subscription-details-section');
    await user.click(screen.getByTestId('subscription-actions-toggle'));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const modal = await screen.findByTestId('delete-subscription-modal');
    expect(within(modal).getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.type(screen.getByTestId('delete-modal-input'), 'Engineering');
    const remove = service.deleteSubscription;
    service.deleteSubscription = async () => {
      service.deleteSubscription = remove;
      throw new ServiceError(403, 'Permission denied.');
    };
    await user.click(within(modal).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByTestId('delete-model-error-message-alert')).toHaveTextContent('Permission denied.');
    expect(await service.getSubscriptionInfo('engineering')).toBeDefined();
    await user.click(within(modal).getByRole('button', { name: 'Delete' }));
    await screen.findByTestId('subscriptions-table');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Engineering' })).not.toBeInTheDocument());
    expect(await screen.findByText('Subscription deleted')).toBeVisible();
  });

  it('edits an unlimited model without dropping controller-specific fields', async () => {
    const seed = structuredClone(seedSubscriptions()[0]);
    seed.owner.users = ['alice'];
    seed.inferencePriority = -5;
    seed.guardrails = [{ ref: { name: 'safety' } }];
    seed.modelRefs[0] = {
      ...seed.modelRefs[0],
      unlimited: true,
      tokenRateLimits: [],
      guardrails: [{ ref: { name: 'model-safety' } }],
    };
    const service = new MockConsoleService();
    service.subscriptions = [seed];
    service.authPolicies = [];
    const user = userEvent.setup();
    renderAt('/subscriptions/edit/engineering', service);
    const description = await screen.findByTestId('subscription-name-desc-description');
    expect(screen.getByTestId('subscription-models-table')).toHaveTextContent('Unlimited');
    await user.clear(description);
    await user.type(description, 'Changed description');
    await user.click(screen.getByTestId('update-subscription-button'));
    await screen.findByTestId('subscriptions-table');
    const saved = (await service.getSubscriptionInfo(seed.name)).subscription;
    expect(saved.owner.users).toEqual(['alice']);
    expect(saved.inferencePriority).toBe(-5);
    expect(saved.guardrails).toEqual(seed.guardrails);
    expect(saved.modelRefs[0]).toMatchObject({
      unlimited: true,
      tokenRateLimits: [],
      guardrails: seed.modelRefs[0].guardrails,
    });
  });

  it('renders load failures and allows retry', async () => {
    const service = new MockConsoleService();
    const list = service.listSubscriptions;
    service.listSubscriptions = async () => {
      service.listSubscriptions = list;
      throw new ServiceError(503, 'Service unavailable.');
    };
    const user = userEvent.setup();
    renderAt('/subscriptions', service);
    expect(await screen.findByTestId('error-empty-state')).toHaveTextContent('Service unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('subscriptions-table')).toBeVisible();
  });

  it('keeps input on conflict', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt('/subscriptions/edit/engineering', service);
    const description = await screen.findByTestId('subscription-name-desc-description');
    await user.clear(description);
    await user.type(description, 'Unsaved description');
    const sub = (await service.getSubscriptionInfo('engineering')).subscription;
    await service.updateSubscription(
      sub.name,
      { owner: sub.owner, modelRefs: sub.modelRefs, priority: 42 },
      sub.resourceVersion,
    );
    await user.click(screen.getByTestId('update-subscription-button'));
    expect(await screen.findByText('This subscription changed. Reload it before saving or deleting.')).toBeVisible();
    expect(description).toHaveValue('Unsaved description');
    expect((await service.getSubscriptionInfo('engineering')).subscription.description).toBe(
      'Production models for the engineering team.',
    );
  });
});

it('requires an organization and shows it in the table', async () => {
  const service = new MockConsoleService();
  service.subscriptions[1].tokenMetadata = { organizationId: 'retired-org' };
  const user = userEvent.setup();
  renderAt('/subscriptions/create', service);
  await fillNewSubscription(user);
  const create = screen.getByTestId('create-subscription-button');
  expect(create).toBeDisabled();
  // Tabbing past the empty select says why Create is disabled.
  const organization = screen.getByRole('combobox', { name: 'Organization' });
  expect(screen.queryByText('Select an organization')).not.toBeInTheDocument();
  organization.focus();
  await user.tab();
  expect(organization).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Select an organization')).toBeVisible();
  await pickOrganization(user, 'globex-research');
  expect(organization).toHaveAttribute('aria-invalid', 'false');
  expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue('globex-research');
  expect(create).toBeEnabled();
  await user.click(create);

  const table = await screen.findByTestId('subscriptions-table');
  const rowOf = async (name: string) => (await within(table).findByRole('link', { name })).closest('tr')!;
  expect(within(table).getByRole('columnheader', { name: /Organization/ })).toBeVisible();
  expect(await rowOf('Test team')).toHaveTextContent('globex-research');
  expect(await rowOf('Engineering')).toHaveTextContent('acme-robotics');
  // An organization the backend doesn't list shows its raw id.
  expect(await rowOf('Data science')).toHaveTextContent('retired-org');
  const saved = (await service.getSubscriptionInfo('test-team')).subscription;
  expect(saved.tokenMetadata?.organizationId).toBe('8d2e7b31-0c4f-4a9d-b5e6-7f8a9b0c1d2e');
}, 20000);

it('hides write actions until it knows the user is a provider admin', async () => {
  const service = unknownUser();
  const user = userEvent.setup();
  const { unmount } = renderAt('/subscriptions', service);
  await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('User could not be loaded'));
  const table = await screen.findByTestId('subscriptions-table');
  expect(within(table).getByRole('link', { name: 'Engineering' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Create subscription' })).not.toBeInTheDocument();
  const row = within(table).getByRole('link', { name: 'Engineering' }).closest('tr')!;
  await user.click(within(row).getByRole('button', { name: /Kebab toggle/ }));
  expect(screen.getByRole('menuitem', { name: 'View details' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  unmount();

  renderAt('/subscriptions/view/engineering', service);
  await screen.findByTestId('subscription-details-section');
  await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('User could not be loaded'));
  expect(screen.queryByTestId('subscription-actions-toggle')).not.toBeInTheDocument();
});

it('shows the not-available state when the backend has no subscriptions yet', async () => {
  const service = new MockConsoleService();
  service.listSubscriptions = async () => {
    throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
  };
  renderAt('/subscriptions', service);
  expect(await screen.findByText('Subscriptions are not available on this backend yet')).toBeVisible();
  expect(screen.queryByTestId('subscriptions-table')).not.toBeInTheDocument();
});

it('says creating is not available on a backend without subscriptions', async () => {
  const service = new MockConsoleService();
  service.createSubscription = async () => {
    throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
  };
  const user = userEvent.setup();
  renderAt('/subscriptions/create', service);
  await fillNewSubscription(user);
  await pickOrganization(user, 'acme-robotics');
  await user.click(screen.getByTestId('create-subscription-button'));
  expect(await screen.findByText('Creating subscriptions is not available on this backend yet.')).toBeVisible();
  expect(screen.getByText('Failed to create subscription')).toBeVisible();
}, 20000);

it('shows one pagination, in the toolbar, for a single page', async () => {
  renderAt('/subscriptions', new MockConsoleService());
  expect(await screen.findByTestId('subscriptions-table')).toBeVisible();
  expect(screen.getAllByRole('navigation', { name: /pagination/i })).toHaveLength(1);
});

describe('a failed background poll', () => {
  // Only the 30-second polls are faked; user-event and findBy keep real timeouts.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it.each([
    ['/subscriptions/create', 'subscription-name-desc-name'],
    ['/subscriptions/edit/engineering', 'subscription-name-desc-description'],
  ])('keeps the input on %s', async (path, testId) => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    renderAt(path, service);
    const field = await screen.findByTestId(testId);
    await user.clear(field);
    await user.type(field, 'Unsaved input');
    const failed = vi.fn(async () => {
      throw new ServiceError(503, 'Service unavailable.');
    });
    service.listModels = failed;
    service.listSubscriptions = failed;
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await waitFor(() => expect(failed).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Unable to load subscriptions')).not.toBeInTheDocument();
    expect(screen.getByTestId(testId)).toHaveValue('Unsaved input');
  });
});

/** A copy of the engineering seed named `name`, with the phase and Ready condition the backend reports. */
const withPhase = (
  name: string,
  phase: string | undefined,
  ready?: { status: ConditionStatus; reason: string; message?: string },
): MaaSSubscription => ({
  ...structuredClone(seedSubscriptions()[0]),
  name,
  displayName: name,
  phase,
  conditions: ready ? [{ type: 'Ready', ...ready }] : [],
});

const TRLP_MESSAGE = '1 of 1 TokenRateLimitPolicies not accepted';

describe('MaaS subscription phases', () => {
  it('shows the real phases', async () => {
    const service = new MockConsoleService();
    service.subscriptions = [
      withPhase('unreconciled-sub', undefined),
      withPhase('degraded-sub', 'Degraded', { status: 'False', reason: 'PartialFailure', message: TRLP_MESSAGE }),
      withPhase('active-sub', 'Active', { status: 'True', reason: 'Reconciled', message: 'successfully reconciled' }),
      withPhase('failed-sub', 'Failed', {
        status: 'False',
        reason: 'ReconcileFailed',
        message: 'all 1 model references are invalid or unavailable',
      }),
      withPhase('invalid-sub', 'Invalid', { status: 'False', reason: 'InvalidSpec' }),
    ];
    renderAt('/subscriptions', service);
    const table = await screen.findByTestId('subscriptions-table');
    const label = (name: string) =>
      within(within(table).getByRole('link', { name }).closest('tr')!).getByTestId('phase-label');
    // No phase yet reads Unknown, as in odh-dashboard's MaaS screens.
    expect(label('unreconciled-sub')).toHaveTextContent('Unknown');
    expect(label('degraded-sub')).toHaveTextContent('Degraded');
    expect(label('active-sub')).toHaveTextContent('Ready');
    expect(label('failed-sub')).toHaveTextContent('Failed');
    expect(label('invalid-sub')).toHaveTextContent('Invalid');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('shows the Degraded message', async () => {
    const service = new MockConsoleService();
    service.subscriptions = [
      withPhase('degraded-sub', 'Degraded', { status: 'False', reason: 'PartialFailure', message: TRLP_MESSAGE }),
    ];
    const user = userEvent.setup();
    renderAt('/subscriptions', service);
    expect(await screen.findByTestId('phase-label-subtext')).toHaveTextContent(TRLP_MESSAGE);
    await user.click(within(screen.getByTestId('phase-label')).getByRole('button'));
    expect(await screen.findByTestId('phase-modal')).toHaveTextContent(TRLP_MESSAGE);
  });

  it('lists unpaired and unhealthy models as affected', async () => {
    const service = new MockConsoleService();
    const sub = withPhase('degraded-sub', 'Degraded', {
      status: 'False',
      reason: 'PartialFailure',
      message: '1 of 3 model references are invalid or unavailable',
    });
    sub.modelRefs = ['granite-3-8b', 'llama-3-70b', 'retired-llm'].map((name) => ({
      name,
      tokenRateLimits: [{ limit: 1000, window: '1h' }],
    }));
    sub.modelRefStatuses = [
      { name: 'granite-3-8b', namespace: 'ai-grid-models', ready: true, reason: 'Valid' },
      { name: 'llama-3-70b', namespace: 'ai-grid-models', ready: true, reason: 'Valid' },
      {
        name: 'retired-llm',
        namespace: 'ai-grid-models',
        ready: false,
        reason: 'NotFound',
        message: 'MaaSModelRef ai-grid-models/retired-llm not found',
      },
    ];
    service.subscriptions = [sub];
    service.modelRegistrations = [
      {
        name: 'granite-3-8b',
        namespace: 'ai-grid-models',
        phase: 'Pending',
        conditions: [{ type: 'Ready', status: 'False', reason: 'Pending', message: 'Awaiting governance pairing' }],
      },
      {
        name: 'llama-3-70b',
        namespace: 'ai-grid-models',
        phase: 'Unhealthy',
        conditions: [
          { type: 'Ready', status: 'False', reason: 'Unhealthy', message: 'Governed but backend is not ready' },
        ],
      },
    ];
    const user = userEvent.setup();
    renderAt('/subscriptions/view/degraded-sub', service);
    const details = await screen.findByTestId('subscription-details-section');
    await user.click(within(within(details).getByTestId('phase-label')).getByRole('button'));
    const modal = await screen.findByTestId('phase-modal');
    expect(modal).toHaveTextContent('Awaiting governance pairing');
    expect(modal).toHaveTextContent('Governed but backend is not ready');
    expect(modal).toHaveTextContent('Model not found. It may have been deleted.');
  });
});

describe("model references on PR 12's models", () => {
  it('offers PR 12 models and sends the picked model with its namespace', async () => {
    const service = serviceOnPr12Json();
    const create = vi.spyOn(service, 'createSubscription');
    const user = userEvent.setup();
    renderAt('/subscriptions/create', service);
    await pickOrganization(user, 'acme-robotics');
    await user.type(screen.getByTestId('subscription-name-desc-name'), 'Test team');
    await user.type(screen.getByRole('combobox', { name: 'Enter groups' }), 'engineering');
    const option = await screen.findByRole('option', { name: 'Add group "engineering"' });
    await user.click(option.querySelector('button') ?? option);
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('no-models-warning')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('add-models-button'));
    await user.click(screen.getByTestId('toggle-model-granite-8b-instruct'));
    await user.click(screen.getByTestId('confirm-add-models'));
    await user.click(screen.getByTestId('add-token-limit-0'));
    await user.click(screen.getByTestId('save-rate-limits'));
    await user.click(screen.getByTestId('create-subscription-button'));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].modelRefs).toEqual([
      { name: 'granite-8b-instruct', namespace: 'ai-grid-models', tokenRateLimits: [{ limit: 1000, window: '1h' }] },
    ]);
  }, 20000);

  it('matches references by namespace and name', async () => {
    const service = new MockConsoleService();
    const [model] = service.models;
    service.models = [
      { ...model, namespace: 'ai-grid-models', displayName: 'Shared granite' },
      { ...model, namespace: 'team-models', displayName: 'Team granite' },
    ];
    const seed = structuredClone(seedSubscriptions()[0]);
    seed.modelRefs = [{ name: model.name, namespace: 'team-models', tokenRateLimits: [{ limit: 5, window: '1m' }] }];
    service.subscriptions = [seed];
    service.authPolicies = [];
    const update = vi.spyOn(service, 'updateSubscription');
    const user = userEvent.setup();
    renderAt(`/subscriptions/edit/${seed.name}`, service);
    const models = await screen.findByTestId('subscription-models-table');
    expect(models).toHaveTextContent('Team granite');
    expect(models).not.toHaveTextContent('Shared granite');
    await user.click(screen.getByTestId('add-models-button'));
    const rows = within(screen.getByTestId('add-models-table')).getAllByRole('row');
    const row = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    expect(within(row('Team granite')).getByRole('checkbox', { name: 'Select Team granite' })).toBeChecked();
    expect(within(row('Shared granite')).getByRole('checkbox', { name: 'Select Shared granite' })).not.toBeChecked();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('update-subscription-button'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].modelRefs).toEqual([
      { name: model.name, namespace: 'team-models', tokenRateLimits: [{ limit: 5, window: '1m' }] },
    ]);
  });
});

it('sends a re-added unlimited model with its new limits only', async () => {
  const seed = structuredClone(seedSubscriptions()[0]);
  seed.modelRefs[0] = { ...seed.modelRefs[0], unlimited: true, tokenRateLimits: [] };
  const service = new MockConsoleService();
  service.subscriptions = [seed];
  service.authPolicies = [];
  const update = vi.spyOn(service, 'updateSubscription');
  const user = userEvent.setup();
  renderAt('/subscriptions/edit/engineering', service);
  const models = await screen.findByTestId('subscription-models-table');
  await user.click(within(models).getByRole('button', { name: /^Remove / }));
  await user.click(screen.getByTestId('add-models-button'));
  await user.click(screen.getByTestId('toggle-model-granite-3-8b'));
  await user.click(screen.getByTestId('confirm-add-models'));
  await user.click(screen.getByTestId('add-token-limit-0'));
  await user.click(screen.getByTestId('save-rate-limits'));
  await user.click(screen.getByTestId('update-subscription-button'));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0][1].modelRefs[0]).toMatchObject({ tokenRateLimits: [{ limit: 1000, window: '1h' }] });
  expect(update.mock.calls[0][1].modelRefs[0].unlimited).toBeFalsy();
  await screen.findByTestId('subscriptions-table');
});

it.each(['view', 'edit'])('loads the other subscription when the name in /subscriptions/%s changes', async (page) => {
  let navigate: NavigateFunction = () => undefined;
  const Navigator = () => {
    navigate = useNavigate();
    return null;
  };
  render(
    <MemoryRouter initialEntries={[`/subscriptions/${page}/engineering`]}>
      <Navigator />
      <App service={new MockConsoleService()} />
    </MemoryRouter>,
  );
  const shows = (name: string) =>
    waitFor(() =>
      page === 'edit'
        ? expect(screen.getByTestId('subscription-name-desc-name')).toHaveValue(name)
        : expect(screen.getByTestId('subscription-details-section')).toHaveTextContent(name),
    );
  await shows('Engineering');
  await act(async () => navigate(`/subscriptions/${page}/data-science`));
  await shows('Data science');
});

it('matches a model reference only in its own namespace', () => {
  // The backend names every reference's namespace, so a missing one matches nothing.
  expect(isSameModel({ name: 'm' }, { name: 'm', namespace: 'team-models' })).toBe(false);
  expect(isSameModel({ name: 'm', namespace: 'team-models' }, { name: 'm', namespace: 'team-models' })).toBe(true);
});

it('hints that a new model needs a token limit, and labels the limit fields', async () => {
  const user = userEvent.setup();
  renderAt('/subscriptions/create', new MockConsoleService());
  expect(await screen.findByText(/^Give groups of an organization's users access to models/)).toBeVisible();
  await user.click(screen.getByTestId('add-models-button'));
  await user.click(screen.getByTestId('toggle-model-granite-3-8b'));
  await user.click(screen.getByTestId('confirm-add-models'));
  // A hint, not an error, before the user has done anything with the model.
  const hint = screen.getByTestId('token-limit-required-0');
  expect(hint).toHaveTextContent('Required: add at least one.');
  expect(hint).not.toHaveClass('pf-m-error');
  await user.click(screen.getByTestId('add-token-limit-0'));
  expect(screen.getByRole('dialog', { name: 'Edit token limits' })).toHaveTextContent(
    /^Edit token limitsLimit how many tokens each member of this subscription can use with/,
  );
  expect(screen.getByRole('spinbutton', { name: 'Tokens' })).toHaveValue(1000);
  expect(screen.getByRole('spinbutton', { name: 'Per' })).toHaveValue(1);
  expect(screen.getByRole('button', { name: 'Add token limit' })).toBeVisible();
});

it('says straight away that a subscription saved without an organization needs one', async () => {
  const service = new MockConsoleService();
  service.subscriptions[0].tokenMetadata = undefined;
  renderAt(`/subscriptions/edit/${service.subscriptions[0].name}`, service);
  const organization = await screen.findByRole('combobox', { name: 'Organization' });
  expect(organization).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Select an organization')).toBeVisible();
});

it('keeps a set organization read-only when editing', async () => {
  renderAt('/subscriptions/edit/engineering', new MockConsoleService());
  const organization = await screen.findByTestId('subscription-organization');
  expect(organization).toHaveAttribute('readonly');
  expect(organization).toHaveValue('acme-robotics');
  expect(screen.getByText('The organization can’t be changed once it is set.')).toBeVisible();
});

it('shows Not found for a referenced model the hub no longer has, even with a namespace', async () => {
  const service = new MockConsoleService();
  const seed = structuredClone(seedSubscriptions()[0]);
  seed.modelRefs = [{ name: 'gone', namespace: 'ai-grid-models', tokenRateLimits: [{ limit: 5, window: '1m' }] }];
  service.subscriptions = [seed];
  renderAt(`/subscriptions/view/${seed.name}`, service);
  expect(await screen.findByTestId('subscription-models-table')).toHaveTextContent('Not found');
});

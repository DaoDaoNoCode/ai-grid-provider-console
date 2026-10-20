// Ported from krisv/ai-grid-cloud-provider-poc src/app/__tests__/clusters.test.tsx at 62319b8.
// The PoC drives a fake ACM Hub through its backend; here the same cases run on
// MockConsoleService, and the BFF's PATCH is covered by bff/internal/api tests.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceError } from '../api/ConsoleService';
import { HttpConsoleService } from '../api/HttpConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';
import type { GridCluster } from '../api/types';
import { renderAt } from './render';

const cluster = (name: string, status: GridCluster['status'], labels: Record<string, string> = {}): GridCluster => {
  const aiGridEnabled = labels['ai-grid/enabled'] === 'true';
  const provisioned = labels['ai-grid/provisioned'] === 'true';
  return {
    name,
    status,
    aiGridEnabled,
    provisioned,
    provisioningStatus: provisioned ? 'Provisioned' : aiGridEnabled ? 'Provisioning' : 'Not provisioned',
    hubAcceptsClient: true,
    ...(labels.location ? { location: labels.location } : {}),
    labels,
  };
};

const hubClusters = () => [
  cluster('cluster-a', 'Ready', { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true', location: 'site1' }),
  cluster('cluster-b', 'Ready', { location: 'site2' }),
  cluster('cluster-c', 'Offline'),
];

const serviceWith = (clusters: GridCluster[]) => new MockConsoleService(undefined, clusters);

type User = ReturnType<typeof userEvent.setup>;

/** Opens a row's actions menu and picks an item. */
const pick = async (user: User, cluster: string, item: string) => {
  await user.click(await screen.findByRole('button', { name: `Actions for ${cluster}` }));
  await user.click(screen.getByRole('menuitem', { name: item }));
};

/** Adds a cluster from its row menu and confirms. */
const add = async (user: User, cluster: string) => {
  await pick(user, cluster, 'Add to AI Grid');
  const modal = await screen.findByTestId('cluster-membership-modal');
  await user.click(within(modal).getByRole('button', { name: 'Add to AI Grid' }));
  return modal;
};

it('lists live Hub states, includes AI Grid navigation and enrolls with a label-only PATCH', async () => {
  const user = userEvent.setup();
  const service = serviceWith(hubClusters());
  renderAt('/', service);
  const table = await screen.findByTestId('clusters-table');
  const nav = screen.getByRole('navigation', { name: 'Console sections' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['AI Grid', 'Monitoring', 'Clusters', 'Organizations', 'Models', 'Subscriptions']);
  // A member links to its AI Grid drawer and shows its provisioning; one status line each.
  const member = within(table).getByRole('link', { name: 'cluster-a' }).closest('tr')!;
  expect(within(table).getByRole('link', { name: 'cluster-a' })).toHaveAttribute('href', '/ai-grid?cluster=cluster-a');
  expect(within(member).getByText('Provisioned')).toBeInTheDocument();
  const offline = within(table).getByText('cluster-c').closest('tr')!;
  expect(offline).toHaveTextContent('Offline');
  expect(within(offline).queryByRole('link')).not.toBeInTheDocument();
  expect(within(offline).getAllByText('—').length).toBeGreaterThan(0);
  await add(user, 'cluster-b');
  expect(await screen.findByText('cluster-b added to AI Grid')).toBeVisible();
  expect(screen.queryByTestId('cluster-membership-modal')).not.toBeInTheDocument();
  const enrolled = service.clusters.find((c) => c.name === 'cluster-b')!;
  expect(enrolled.labels).toEqual({ location: 'site2', 'ai-grid/enabled': 'true' });
  expect(enrolled.location).toBe('site2');
  await user.type(screen.getByRole('textbox', { name: 'Search clusters' }), 'cluster-c');
  expect(within(screen.getByTestId('clusters-table')).queryByText('cluster-a')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Actions for cluster-c' }));
  expect(screen.getByRole('menuitem', { name: 'Add to AI Grid' })).not.toHaveAttribute('aria-disabled', 'true');
});

it('removes a member from AI Grid after a confirmation', async () => {
  const user = userEvent.setup();
  const service = serviceWith(hubClusters());
  renderAt('/clusters', service);
  await pick(user, 'cluster-a', 'Remove from AI Grid');
  const modal = await screen.findByTestId('cluster-membership-modal');
  expect(modal).toHaveTextContent('Remove cluster-a from AI Grid?');
  await user.click(within(modal).getByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('cluster-a removed from AI Grid')).toBeVisible();
  const removed = service.clusters.find((c) => c.name === 'cluster-a')!;
  expect(removed.labels).toEqual({ 'ai-grid/provisioned': 'true', location: 'site1' });
  expect(
    within(screen.getByTestId('clusters-table')).queryByRole('link', { name: 'cluster-a' }),
  ).not.toBeInTheDocument();
});

it('warns about a member without a location, and before adding a cluster without one', async () => {
  const user = userEvent.setup();
  renderAt(
    '/clusters',
    serviceWith([
      cluster('no-location-member', 'Ready', { 'ai-grid/enabled': 'true' }),
      cluster('no-location', 'Ready'),
    ]),
  );
  expect(await screen.findByTestId('missing-location-no-location-member')).toHaveTextContent('No location');
  await pick(user, 'no-location', 'Add to AI Grid');
  expect(await screen.findByTestId('cluster-membership-modal')).toHaveTextContent('This cluster has no location label');
});

it('keeps an unenrolled cluster on patch failure and allows a retry', async () => {
  const service = serviceWith(hubClusters());
  const enroll = service.enrollCluster;
  service.enrollCluster = async () => {
    throw new ServiceError(403, 'The backend does not have permission to list or patch ACM ManagedClusters.');
  };
  const user = userEvent.setup();
  renderAt('/clusters', service);
  const modal = await add(user, 'cluster-b');
  // The error stays in the dialog, which stays open for a retry.
  expect(
    await within(modal).findByText('The backend does not have permission to list or patch ACM ManagedClusters.'),
  ).toBeVisible();
  expect(service.clusters[1].labels['ai-grid/enabled']).toBeUndefined();
  service.enrollCluster = enroll;
  await user.click(within(modal).getByRole('button', { name: 'Add to AI Grid' }));
  expect(await screen.findByText('cluster-b added to AI Grid')).toBeVisible();
});

it('reports Hub unavailability and retries instead of showing a false empty list', async () => {
  const service = serviceWith(hubClusters());
  const list = service.listClusters;
  service.listClusters = async () => {
    throw new ServiceError(503, 'the AI Grid backend is unavailable; try again');
  };
  const user = userEvent.setup();
  renderAt('/clusters', service);
  expect(await screen.findByText('the AI Grid backend is unavailable; try again')).toBeVisible();
  expect(screen.queryByText('No managed clusters')).not.toBeInTheDocument();
  service.listClusters = list;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByTestId('clusters-table')).toHaveTextContent('cluster-a');
});

it('refresh reflects external membership changes on the Hub', async () => {
  const service = serviceWith(hubClusters());
  const user = userEvent.setup();
  renderAt('/clusters', service);
  await add(user, 'cluster-b');
  expect(await screen.findByText('cluster-b added to AI Grid')).toBeVisible();
  expect(await screen.findByRole('link', { name: 'cluster-b' })).toBeInTheDocument();
  service.clusters[1] = cluster('cluster-b', 'Ready', { location: 'site2' });
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'cluster-b' })).not.toBeInTheDocument());
});

it('rejects a response that does not confirm membership', async () => {
  const service = serviceWith(hubClusters());
  service.enrollCluster = async (c) => cluster(c.name, 'Ready');
  const user = userEvent.setup();
  renderAt('/clusters', service);
  const modal = await add(user, 'cluster-b');
  expect(await within(modal).findByText('Unable to add the cluster')).toBeVisible();
  expect(within(modal).getByText('The Hub did not confirm the change. Refresh and try again.')).toBeVisible();
});

it('shows the PoC empty state', async () => {
  renderAt('/clusters', serviceWith([]));
  expect(await screen.findByText('No managed clusters')).toBeInTheDocument();
  expect(screen.getByText('No ManagedClusters are available.')).toBeInTheDocument();
});

it('shows the seeded clusters with status, provisioning and site', async () => {
  renderAt('/clusters', new MockConsoleService());
  const table = await screen.findByTestId('clusters-table');
  const sydney = within(table).getByRole('row', { name: /^site4 / });
  expect(sydney).toHaveTextContent('sydney');
  expect(sydney).toHaveTextContent('asia-pacific');
  expect(sydney).toHaveTextContent('Ready');
  // Not a member: no provisioning to show.
  expect(sydney).not.toHaveTextContent('provisioned');
  expect(within(table).getAllByText('Provisioned')).toHaveLength(3);
});

it('hides write actions from a viewer', async () => {
  const service = new MockConsoleService({ username: 'viewer', groups: [], isProviderAdmin: false });
  renderAt('/clusters', service);
  await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('viewer'));
  // site4 is both the name and the location, so find its row rather than the text.
  expect(await screen.findByRole('row', { name: /^site4 / })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Actions for / })).not.toBeInTheDocument();
});

it('shows the not-available state on a backend without the RPC', async () => {
  const user = userEvent.setup();
  const service = new MockConsoleService();
  service.enrollCluster = async () => {
    throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
  };
  renderAt('/clusters', service);
  const modal = await add(user, 'site4');
  expect(await within(modal).findByText('Unable to add the cluster')).toBeInTheDocument();
  expect(
    within(modal).getByText('Adding clusters to AI Grid is not available on this backend yet.'),
  ).toBeInTheDocument();
});

it('shows one pagination, in the toolbar, for a single page', async () => {
  renderAt('/clusters', new MockConsoleService());
  expect(await screen.findByTestId('clusters-table')).toBeVisible();
  expect(screen.getAllByRole('navigation', { name: /pagination/i })).toHaveLength(1);
});

// PR 12's cluster JSON through HttpConsoleService, as GET /api/v1/clusters sends it.
const serviceOnClusterJson = (clusters: unknown[]) => {
  const service = new MockConsoleService();
  const fetchFn = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: clusters }), { headers: { 'Content-Type': 'application/json' } }),
    );
  service.listClusters = () => new HttpConsoleService(fetchFn).listClusters();
  return service;
};

it('shows Unknown for a cluster without a status', async () => {
  // The shipped backend reports no state, so PR 12's BFF omits status.
  renderAt('/clusters', serviceOnClusterJson([{ name: 'bare', aiGridEnabled: false, provisioned: false }]));
  const row = await screen.findByRole('row', { name: /^bare / });
  expect(within(row).getByText('Unknown')).toBeInTheDocument();
  expect(row).not.toHaveTextContent('provisioned');
});

it('shows the ACM state for an importing cluster', async () => {
  const user = userEvent.setup();
  renderAt(
    '/clusters',
    serviceOnClusterJson([
      {
        name: 'site-berlin-1',
        aiGridEnabled: false,
        provisioned: false,
        status: 'importing',
        statusMessage: 'Import of the managed cluster is in progress',
      },
    ]),
  );
  const row = await screen.findByRole('row', { name: /^site-berlin-1 / });
  // One status line; the state and the message are in its tooltip.
  expect(within(row).getByText('Unknown')).toBeInTheDocument();
  expect(within(row).queryByText('Importing')).not.toBeInTheDocument();
  await user.hover(within(row).getByText('Unknown'));
  expect(await screen.findByText('Importing: Import of the managed cluster is in progress')).toBeInTheDocument();
});

it('offers only Remove from AI Grid for a member', async () => {
  const user = userEvent.setup();
  renderAt('/clusters', new MockConsoleService());
  await user.click(await screen.findByRole('button', { name: 'Actions for site1' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Remove from AI Grid']);
});

it('offers Add to AI Grid only for ready, offline or unknown clusters', async () => {
  const withState = (name: string, state: NonNullable<GridCluster['state']>): GridCluster => ({
    ...cluster(name, 'Unknown'),
    state,
  });
  renderAt(
    '/clusters',
    serviceWith([
      cluster('is-ready', 'Ready'),
      cluster('is-offline', 'Offline'),
      cluster('is-unknown', 'Unknown'),
      withState('is-detaching', 'Detaching'),
      withState('is-importfailed', 'Import failed'),
      withState('is-notaccepted', 'Not accepted'),
      withState('is-pendingimport', 'Pending import'),
      withState('is-importing', 'Importing'),
    ]),
  );
  await screen.findByTestId('clusters-table');
  const user = userEvent.setup();
  const addItem = async (name: string) => {
    await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    const item = screen.getByRole('menuitem', { name: 'Add to AI Grid' });
    return item;
  };
  for (const name of ['is-ready', 'is-offline', 'is-unknown']) {
    expect(await addItem(name)).not.toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
  }
  // The others say why they can't be added yet.
  for (const name of ['is-detaching', 'is-importfailed', 'is-notaccepted', 'is-pendingimport', 'is-importing']) {
    const item = await addItem(name);
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.hover(item);
    expect(await screen.findByText(/once it has imported it/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
  }
});

it('wraps the headers and keeps Site, Region and Hub for wide screens only', async () => {
  renderAt('/clusters', serviceWith(hubClusters()));
  const table = await screen.findByTestId('clusters-table');
  for (const header of within(table)
    .getAllByRole('columnheader')
    .filter((h) => h.textContent !== 'Actions')) {
    expect(header).toHaveClass('pf-m-wrap');
  }
  for (const name of ['Site', 'Region', 'Hub']) {
    expect(within(table).getByRole('columnheader', { name })).toHaveClass('pf-m-hidden', 'pf-m-visible-on-2xl');
  }
  expect(within(table).getByRole('columnheader', { name: 'OpenShift' })).not.toHaveClass('pf-m-hidden');
});

it('says when the search matches no cluster, and clears it from the table', async () => {
  const user = userEvent.setup();
  renderAt('/clusters', new MockConsoleService());
  await screen.findByRole('row', { name: /^site1 / });
  await user.type(screen.getByRole('textbox', { name: 'Search clusters' }), 'no-such-cluster');
  expect(screen.getByRole('heading', { name: 'No results found' })).toBeVisible();
  expect(screen.getByText('Change the search to see more clusters.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
  expect(await screen.findByRole('row', { name: /^site1 / })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Search clusters' })).toHaveValue('');
});

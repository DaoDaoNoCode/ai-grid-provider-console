import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockConsoleService, seedClusters } from '../api/MockConsoleService';
import type { GridCluster } from '../api/types';
import { renderAt } from './render';


/** A cluster as today's backend sends it: no claims, capacity or conditions. */
const bare = (): GridCluster => ({
  name: 'bare-1',
  status: 'Ready',
  aiGridEnabled: true,
  provisioned: false,
  provisioningStatus: 'Provisioning',
  location: 'us-east',
  openshiftVersion: '4.21.36',
  creationTimestamp: '2026-10-21T03:56:00Z',
  addons: { 'work-manager': 'available', submariner: 'unreachable' },
  conditions: [],
  labels: { 'ai-grid/enabled': 'true', 'ai-grid/role': 'inference', location: 'us-east' },
});

const details = (label: string) => screen.getByLabelText(label);

it('opens from the Clusters list', async () => {
  const user = userEvent.setup();
  renderAt('/clusters', new MockConsoleService());
  await user.click(await screen.findByRole('link', { name: 'site4' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'site4' })).toBeVisible();
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(breadcrumb).getByRole('link', { name: 'Clusters' })).toHaveAttribute('href', '/clusters');
});

it('shows a member: AI Grid, the cluster, its capacity, add-ons and conditions', async () => {
  renderAt('/clusters/site1', new MockConsoleService());
  expect(await screen.findByRole('heading', { level: 1, name: 'site1' })).toBeVisible();

  expect(screen.getByTestId('cluster-membership')).toHaveTextContent('Provisioned');
  const aiGrid = details('AI Grid membership');
  expect(aiGrid).toHaveTextContent('Combined: Takes tenant traffic and serves models.');
  expect(aiGrid).toHaveTextContent('site1');

  const cluster = details('Cluster');
  for (const text of ['4.22.15', 'v1.35.6', 'BareMetal', 'OpenShift']) {
    expect(cluster).toHaveTextContent(text);
  }

  const capacity = details('Capacity');
  expect(capacity).toHaveTextContent('192 cores, 186 cores allocatable');
  expect(capacity).toHaveTextContent('1536 GiB, 1504 GiB allocatable');
  expect(screen.getByTestId('cluster-gpus')).toHaveTextContent('16');

  const addons = screen.getByTestId('cluster-addons');
  expect(addons).toHaveTextContent('cluster-proxy');
  expect(addons).toHaveTextContent('work-manager');

  const conditions = screen.getByTestId('cluster-conditions');
  expect(within(conditions).getByRole('row', { name: /ManagedClusterConditionAvailable True/ })).toHaveTextContent(
    'Managed cluster is available',
  );

  // The cluster's own console opens in a new tab.
  const console = screen.getByRole('link', { name: 'OpenShift console' });
  expect(console).toHaveAttribute('href', 'https://console-openshift-console.apps.site1.example.com');
  expect(console).toHaveAttribute('target', '_blank');
});

it("says what the backend doesn't report yet instead of showing zeros", async () => {
  renderAt('/clusters/bare-1', new MockConsoleService(undefined, [bare()]));
  expect(await screen.findByRole('heading', { level: 1, name: 'bare-1' })).toBeVisible();
  expect(screen.getByTestId('cluster-membership')).toHaveTextContent('Provisioning');
  expect(details('AI Grid membership')).toHaveTextContent('Inference');
  // Versions the labels carry show; claims the backend doesn't send read as empty.
  expect(details('Cluster')).toHaveTextContent('4.21.36');
  expect(details('Cluster')).toHaveTextContent('Platform—');
  expect(screen.getByText("The backend doesn't report this cluster's capacity yet.")).toBeVisible();
  expect(screen.getByText("The backend doesn't report this cluster's conditions yet.")).toBeVisible();
  expect(screen.queryByTestId('cluster-gpus')).not.toBeInTheDocument();
  // An unreachable add-on is red, and says so on hover.
  const submariner = within(screen.getByTestId('cluster-addons')).getByText('submariner').closest('.pf-v6-c-label')!;
  expect(submariner).toHaveClass('pf-m-danger');
  await userEvent.setup().hover(submariner);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Unreachable');
  expect(screen.queryByRole('link', { name: 'OpenShift console' })).not.toBeInTheDocument();
});

it('shows 0 GPUs when the hub reports capacity without any', async () => {
  const clusters = seedClusters();
  renderAt('/clusters/site4', new MockConsoleService(undefined, clusters));
  expect(await screen.findByTestId('cluster-gpus')).toHaveTextContent('0');
  expect(screen.getByTestId('cluster-membership')).toHaveTextContent('Not added');
  // A cluster outside AI Grid has no role to miss.
  expect(screen.queryByTestId('missing-role')).not.toBeInTheDocument();
});

it('adds the cluster to AI Grid from its Actions', async () => {
  const user = userEvent.setup();
  const service = new MockConsoleService();
  renderAt('/clusters/site4', service);
  await user.click(await screen.findByRole('button', { name: 'Actions for site4' }));
  await user.click(screen.getByRole('menuitem', { name: 'Add to AI Grid' }));
  const modal = await screen.findByTestId('cluster-membership-modal');
  await user.click(within(modal).getByRole('combobox', { name: 'Role' }));
  await user.click(await screen.findByRole('option', { name: /Inference/ }));
  await user.click(within(modal).getByRole('button', { name: 'Add to AI Grid' }));
  expect(await screen.findByText('site4 added to AI Grid')).toBeVisible();
  await waitFor(() => expect(screen.getByTestId('cluster-membership')).toHaveTextContent('Provisioning'));
  expect(service.clusters.find((c) => c.name === 'site4')!.labels['ai-grid/role']).toBe('inference');
});

it('says when the hub has no such cluster', async () => {
  renderAt('/clusters/nope', new MockConsoleService());
  expect(await screen.findByRole('heading', { name: 'Cluster not found' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Go to Clusters' })).toHaveAttribute('href', '/clusters');
});

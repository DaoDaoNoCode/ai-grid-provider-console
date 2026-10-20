// Ported from krisv/ai-grid-cloud-provider-poc src/app/__tests__/grid.test.tsx at 62319b8 (the map cases).
// The PoC's demo clusters become the console's fixture clusters: demo-new-york is site2 and
// demo-brussels is site3, whose placement location is its name. The monitoring cases belong to
// Task 11. The real-Leaflet cases are in GridFleetMap.test.tsx, because this file mocks the map (A31).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '../App';
import userEvent from '@testing-library/user-event';
import { ServiceError } from '../api/ConsoleService';
import { HttpConsoleService } from '../api/HttpConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';
import { tileLayerConfig } from '../pages/grid/tiles';
import { serviceOnPr12Json } from './pr12Json';
import { renderAt } from './render';

// Exercise the page and drawer without a browser map renderer or external tiles.
vi.mock('../pages/grid/GridFleetMap', () => ({
  GridFleetMap: ({ clusters, onSelect }: { clusters: Array<{ name: string }>; onSelect: (name: string) => void }) => (
    <div aria-label="AI Grid map of clusters">
      {clusters.map((c) => (
        <button key={c.name} onClick={() => onSelect(c.name)}>{`Map pin ${c.name}`}</button>
      ))}
    </div>
  ),
}));

it('uses the reference map-and-drawer layout and opens cluster details from a pin', async () => {
  const service = new MockConsoleService();
  // The PoC's browser demo is the only source that sets demo; the BFF never does.
  const overview = service.getGridOverview;
  vi.spyOn(service, 'getGridOverview').mockImplementation(async (...args) => ({
    ...(await overview(...args)),
    demo: true,
  }));
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  expect(await screen.findByText('Inventory on this page is simulated.')).toBeVisible();
  expect(screen.getByLabelText('Fleet summary')).toBeVisible();
  await user.click(await screen.findByRole('button', { name: 'Map pin site3' }));
  expect(screen.getByRole('heading', { name: 'site3' })).toBeVisible();
  expect(screen.getByText('50.8503, 4.3517')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clusters' }));
  expect(screen.getByRole('button', { name: 'View site2 details' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Filter by site' })).not.toBeInTheDocument();
});

it('opens the drawer on the cluster or model a link names', async () => {
  const service = new MockConsoleService();
  const view = renderAt('/ai-grid?cluster=site3', service);
  expect(await screen.findByRole('heading', { name: 'site3' })).toBeVisible();
  view.unmount();
  const [model] = await service.listModels();
  renderAt(`/ai-grid?model=${encodeURIComponent(`${model.namespace}/${model.name}`)}`, service);
  expect(await screen.findByRole('heading', { name: model.displayName ?? model.name })).toBeVisible();
});

it('filters the drawer and map by availability while retaining inventory summaries', async () => {
  const service = new MockConsoleService();
  service.clusters[1] = { ...service.clusters[1], status: 'Offline' };
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  await screen.findByRole('button', { name: 'View site2 details' });
  await user.click(
    within(screen.getByRole('group', { name: 'Filter cluster availability' })).getByRole('button', {
      name: 'Offline',
    }),
  );
  expect(screen.getByRole('button', { name: 'View site2 details' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'View site3 details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Map pin site3' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Fleet summary')).toBeVisible();
});

it('switches between clusters and models and follows placement cross-links', async () => {
  const service = new MockConsoleService();
  const [model] = service.models;
  service.models = [{ ...model, locations: ['site3'] }];
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  // A card is one control; its models are links in the cluster's details.
  await user.click(await screen.findByRole('button', { name: 'View site3 details' }));
  await user.click(await screen.findByRole('button', { name: model.displayName ?? model.name }));
  expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Brussels · site3' }));
  expect(screen.getByRole('heading', { name: 'Site and cluster' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Clusters' }));
  await user.click(
    within(screen.getByRole('group', { name: 'Grid object type' })).getByRole('button', { name: 'Models' }),
  );
  expect(screen.getByRole('heading', { name: 'Models' })).toBeVisible();
  expect(screen.getByText('Sites: Brussels')).toBeVisible();
  expect(screen.queryByText('GPU utilization')).not.toBeInTheDocument();
  expect(screen.queryByText('Fleet metrics')).not.toBeInTheDocument();
});

it("follows placement cross-links on PR 12's model JSON", async () => {
  const user = userEvent.setup();
  renderAt('/ai-grid', serviceOnPr12Json());
  await user.click(await screen.findByRole('button', { name: 'View site-paris-1 details' }));
  await user.click(await screen.findByRole('button', { name: 'Granite 8B Instruct' }));
  expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Paris DC1 · site-paris-1' }));
  expect(screen.getByRole('heading', { name: 'Site and cluster' })).toBeVisible();
});

it('uses the configured tile URL, or none for the bundled land outline', () => {
  expect(tileLayerConfig({ mapTileUrl: '', mapTileAttribution: '' })).toEqual({ url: '', attribution: '' });
  expect(
    tileLayerConfig({ mapTileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png', mapTileAttribution: 'Example tiles' }),
  ).toEqual({ url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: 'Example tiles' });
});

it('shows not-available when the backend has no grid overview', async () => {
  const service = new MockConsoleService();
  vi.spyOn(service, 'getGridOverview').mockRejectedValue(
    new ServiceError(501, 'the AI Grid backend does not support this operation yet'),
  );
  renderAt('/ai-grid', service);
  expect(await screen.findByText('AI Grid clusters are not available on this backend yet')).toBeInTheDocument();
});

it('shows the map when the backend leaves the inventory and metrics sources out', async () => {
  // The BFF omits inventorySource, metricsSource and a metric's status when the backend doesn't set them.
  const json = {
    updatedAt: '2026-10-16T12:00:00.000Z',
    demo: false,
    clusters: [
      {
        name: 'site-paris-1',
        aiGridEnabled: true,
        provisioned: true,
        status: 'ready',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    ],
    metrics: [{ key: 'requests', label: 'Requests', unit: 'req/s', points: [] }],
  };
  const fetchFn = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ data: json }), { headers: { 'Content-Type': 'application/json' } }),
    );
  const service = new MockConsoleService();
  service.getGridOverview = (...args) => new HttpConsoleService(fetchFn).getGridOverview(...args);
  renderAt('/ai-grid', service);
  expect(await screen.findByRole('button', { name: 'Map pin site-paris-1' })).toBeInTheDocument();
  expect(screen.queryByText(/Inventory:/)).not.toBeInTheDocument();
  expect(screen.getByText(/^Updated/)).toBeVisible();
});

it('shows the page when the backend sends no updated time', async () => {
  // The BFF omits updatedAt when the backend doesn't send one.
  const json = {
    demo: false,
    clusters: [
      {
        name: 'site-paris-1',
        aiGridEnabled: true,
        provisioned: true,
        status: 'ready',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    ],
    metrics: [],
  };
  const fetchFn = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ data: json }), { headers: { 'Content-Type': 'application/json' } }),
    );
  const service = new MockConsoleService();
  service.getGridOverview = (...args) => new HttpConsoleService(fetchFn).getGridOverview(...args);
  renderAt('/ai-grid', service);
  expect(await screen.findByRole('button', { name: 'Map pin site-paris-1' })).toBeInTheDocument();
  // No time to show, so no "Updated" line, and never "Invalid Date".
  expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
});

it('shows a model by its phase, not "Deployment saved"', async () => {
  const user = userEvent.setup();
  const service = serviceOnPr12Json();
  const [model] = await service.listModels();
  renderAt('/ai-grid', service);
  await user.click(
    within(await screen.findByRole('group', { name: 'Grid object type' })).getByRole('button', { name: 'Models' }),
  );
  expect((await screen.findAllByText(model.phase!)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Deployment saved/)).not.toBeInTheDocument();
});

it('keeps the map, its selection and its models when a refresh fails', async () => {
  const service = new MockConsoleService();
  const [model] = service.models;
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  await user.click(await screen.findByRole('button', { name: 'Map pin site1' }));
  expect(screen.getByRole('heading', { name: 'site1' })).toBeVisible();
  expect(screen.getByRole('button', { name: model.displayName })).toBeVisible();
  const failed = new ServiceError(503, 'Service unavailable.');
  vi.spyOn(service, 'getGridOverview').mockRejectedValue(failed);
  vi.spyOn(service, 'listModels').mockRejectedValue(failed);
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('AI Grid clusters could not be loaded')).toBeVisible();
  expect(screen.getByText('Models unavailable')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'site1' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Map pin site1' })).toBeVisible();
  expect(screen.getByRole('button', { name: model.displayName })).toBeVisible();
});

it("explains, in a help popover, where a cluster's models come from", async () => {
  const user = userEvent.setup();
  renderAt('/ai-grid', new MockConsoleService());
  await user.click(await screen.findByRole('button', { name: 'Map pin site1' }));
  expect(screen.queryByText(/whose placement chose/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'More about models at this location' }));
  expect(await screen.findByText(/^The models whose placement chose this cluster's location\./)).toBeVisible();
});

it('says no clusters match and clears the search and filter', async () => {
  const user = userEvent.setup();
  renderAt('/ai-grid', new MockConsoleService());
  await user.type(await screen.findByRole('textbox', { name: 'Search grid clusters' }), 'zzz');
  expect(screen.getByText('No clusters match')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
  expect(screen.getByRole('button', { name: 'View site1 details' })).toBeVisible();
});

it('names the page like every other page, with no status chips over the map', async () => {
  const service = new MockConsoleService();
  service.clusters[1] = { ...service.clusters[1], status: 'Offline' };
  renderAt('/ai-grid', service);
  expect(await screen.findByRole('heading', { name: 'AI Grid', level: 1 })).toBeVisible();
  expect(screen.queryByText('site2: Offline')).not.toBeInTheDocument();
});

it('does not call a failed model available for subscriptions', async () => {
  const service = new MockConsoleService();
  const [model] = service.models;
  service.models = [{ ...model, phase: 'Failed' }];
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  await user.click(await screen.findByRole('button', { name: 'Map pin site1' }));
  await user.click(screen.getByRole('button', { name: model.displayName }));
  expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
  expect(screen.queryByText('Available for subscriptions')).not.toBeInTheDocument();
});

it('tells apart models of the same name in two namespaces', async () => {
  const service = new MockConsoleService();
  const [model] = service.models;
  service.models = [
    { ...model, namespace: 'ai-grid-models', displayName: 'Shared granite' },
    { ...model, namespace: 'team-models', displayName: 'Team granite' },
  ];
  const user = userEvent.setup();
  renderAt('/ai-grid', service);
  await user.click(await screen.findByRole('button', { name: `Map pin ${model.locations[0]}` }));
  await user.click(screen.getByRole('button', { name: 'Team granite' }));
  expect(screen.getByRole('heading', { name: 'Team granite' })).toBeVisible();
});

it('exposes the map area and the fleet summary as named regions', async () => {
  renderAt('/ai-grid', new MockConsoleService());
  expect(await screen.findByRole('region', { name: 'AI Grid map and drawer' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Fleet summary' })).toBeVisible();
});

it('keeps the URL in step with the drawer, and clears it when the drawer closes', async () => {
  let search = '';
  const Probe = () => {
    search = useLocation().search;
    return null;
  };
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/ai-grid']}>
      <Probe />
      <App service={new MockConsoleService()} />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: 'Map pin site3' }));
  expect(search).toBe('?cluster=site3');
  await user.click(screen.getByRole('button', { name: 'Clusters' }));
  expect(search).toBe('');
});

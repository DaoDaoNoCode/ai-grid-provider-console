// The map with real Leaflet (review focus 5). grid-map.test.tsx mocks the map, so these
// cases live in their own file (A31).
import { act, render, screen, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { seedClusters } from '../api/MockConsoleService';
import { GridFleetMap } from '../pages/grid/GridFleetMap';

const tiles = { url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: 'Example tiles' };
const members = seedClusters().filter((c) => c.aiGridEnabled);

afterEach(() => vi.restoreAllMocks());

/** How many pins the map drew. */
const pinsDrawn = (marker: { mock: { calls: unknown[] } }) => marker.mock.calls.length;

it('keeps pins when tiles fail', () => {
  const tileLayer = vi.spyOn(L, 'tileLayer');
  const marker = vi.spyOn(L, 'circleMarker');
  render(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={tiles} />);
  expect(tileLayer).toHaveBeenCalledWith(tiles.url, expect.objectContaining({ attribution: tiles.attribution }));
  expect(screen.queryByText(/Basemap tiles unavailable/)).not.toBeInTheDocument();

  act(() => {
    tileLayer.mock.results[0].value.fire('tileerror');
  });

  expect(
    screen.getByText('Basemap tiles unavailable. Cluster pins and the cluster list remain available.'),
  ).toBeInTheDocument();
  expect(pinsDrawn(marker)).toBe(3);
  expect(
    screen.queryByText('No mapped clusters. Add site coordinates to ManagedCluster annotations.'),
  ).not.toBeInTheDocument();
});

it('labels only the selected pin, which keeps its status colour; the others label on hover', () => {
  const marker = vi.spyOn(L, 'circleMarker');
  render(<GridFleetMap clusters={members} selected="site3" onSelect={() => {}} tiles={tiles} />);
  expect(screen.getByText('Brussels · site3 · Ready')).toBeInTheDocument();
  expect(screen.queryByText('San Francisco')).not.toBeInTheDocument();
  const selected = marker.mock.calls.find(([, options]) => options?.radius === 11);
  expect(selected?.[1]).toMatchObject({ color: '#3d7317', weight: 4 });
});

it('fits the pins without zooming in past the region around them', () => {
  const fitBounds = vi.spyOn(L.Map.prototype, 'fitBounds');
  render(<GridFleetMap clusters={members.slice(0, 1)} selected={null} onSelect={() => {}} tiles={tiles} />);
  expect(fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxZoom: 4 }));
});

it('says a filter, not missing coordinates, emptied the map', () => {
  render(<GridFleetMap clusters={[]} selected={null} onSelect={() => {}} tiles={tiles} isFiltered />);
  expect(screen.getByText('No clusters match the search or filter.')).toBeInTheDocument();
});

it('draws the bundled land outline instead of tiles without a tile URL', async () => {
  const tileLayer = vi.spyOn(L, 'tileLayer');
  const geoJSON = vi.spyOn(L, 'geoJSON');
  const marker = vi.spyOn(L, 'circleMarker');
  render(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={{ url: '', attribution: '' }} />);
  await waitFor(() => expect(geoJSON).toHaveBeenCalledTimes(1));
  expect(tileLayer).not.toHaveBeenCalled();
  expect(geoJSON).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'FeatureCollection' }),
    expect.objectContaining({ interactive: false, style: { className: 'fleet-map-land' } }),
  );
  const land = geoJSON.mock.results[0].value as L.GeoJSON;
  expect(land.getLayers().length).toBeGreaterThan(100);
  expect(screen.queryByText(/basemap/i)).not.toBeInTheDocument();
  expect(pinsDrawn(marker)).toBe(3);
});

it('draws no land outline when tiles are configured', async () => {
  const geoJSON = vi.spyOn(L, 'geoJSON');
  render(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={tiles} />);
  await act(() => import('../pages/grid/ne_110m_land.json'));
  expect(geoJSON).not.toHaveBeenCalled();
});

it('draws no land outline when tiles are configured while it loads', async () => {
  const geoJSON = vi.spyOn(L, 'geoJSON');
  const consoleError = vi.spyOn(console, 'error');
  const { rerender } = render(
    <GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={{ url: '', attribution: '' }} />,
  );
  rerender(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={tiles} />);
  await act(() => import('../pages/grid/ne_110m_land.json'));
  expect(geoJSON).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

it('says there is no basemap when the land outline fails to load', async () => {
  vi.resetModules();
  vi.doMock('../pages/grid/ne_110m_land.json', () => {
    throw new Error('chunk failed to load');
  });
  try {
    const { GridFleetMap: Map } = await import('../pages/grid/GridFleetMap');
    render(<Map clusters={members} selected={null} onSelect={() => {}} tiles={{ url: '', attribution: '' }} />);
    expect(
      await screen.findByText('No basemap configured. Cluster pins and the cluster list remain available.'),
    ).toBeInTheDocument();
  } finally {
    vi.doUnmock('../pages/grid/ne_110m_land.json');
  }
});

it('explains a map without coordinates', () => {
  const unmapped = members.map(({ latitude: _lat, longitude: _lng, ...c }) => c);
  const marker = vi.spyOn(L, 'circleMarker');
  render(<GridFleetMap clusters={unmapped} selected={null} onSelect={() => {}} tiles={tiles} />);
  expect(
    screen.getByText('No mapped clusters. Add site coordinates to ManagedCluster annotations.'),
  ).toBeInTheDocument();
  expect(pinsDrawn(marker)).toBe(0);
});

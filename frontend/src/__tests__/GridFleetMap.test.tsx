// The map with real Leaflet (review focus 5). grid-map.test.tsx mocks the map, so these
// cases live in their own file (A31).
import { act, render, screen, waitFor } from '@testing-library/react';
import L from 'leaflet';
import { seedClusters } from '../api/MockConsoleService';
import { GridFleetMap } from '../pages/grid/GridFleetMap';

const tiles = { url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: 'Example tiles' };
const members = seedClusters().filter((c) => c.aiGridEnabled);

afterEach(() => vi.restoreAllMocks());

it('keeps pins when tiles fail', () => {
  const tileLayer = vi.spyOn(L, 'tileLayer');
  render(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={tiles} />);
  expect(tileLayer).toHaveBeenCalledWith(tiles.url, expect.objectContaining({ attribution: tiles.attribution }));
  expect(screen.queryByText(/Basemap tiles unavailable/)).not.toBeInTheDocument();

  act(() => {
    tileLayer.mock.results[0].value.fire('tileerror');
  });

  expect(
    screen.getByText('Basemap tiles unavailable. Cluster pins and the cluster list remain available.'),
  ).toBeInTheDocument();
  for (const site of ['San Francisco', 'New York', 'Brussels']) {
    expect(screen.getByText(site)).toBeInTheDocument();
  }
  expect(
    screen.queryByText('No mapped clusters. Add site coordinates to ManagedCluster annotations.'),
  ).not.toBeInTheDocument();
});

it('draws the bundled land outline instead of tiles without a tile URL', async () => {
  const tileLayer = vi.spyOn(L, 'tileLayer');
  const geoJSON = vi.spyOn(L, 'geoJSON');
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
  expect(screen.getByText('San Francisco')).toBeInTheDocument();
});

it('draws no land outline when tiles are configured', async () => {
  const geoJSON = vi.spyOn(L, 'geoJSON');
  render(<GridFleetMap clusters={members} selected={null} onSelect={() => {}} tiles={tiles} />);
  await act(() => import('../pages/grid/ne_110m_land.json'));
  expect(geoJSON).not.toHaveBeenCalled();
});

it('explains a map without coordinates', () => {
  const unmapped = members.map(({ latitude: _lat, longitude: _lng, ...c }) => c);
  render(<GridFleetMap clusters={unmapped} selected={null} onSelect={() => {}} tiles={tiles} />);
  expect(
    screen.getByText('No mapped clusters. Add site coordinates to ManagedCluster annotations.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('San Francisco')).not.toBeInTheDocument();
});

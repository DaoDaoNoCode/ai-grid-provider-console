import { toGridCluster } from './adapters';
import type { ApiCluster } from './types';

// A cluster of GET /api/v1/grid/overview (mock/examples/get-grid-overview.json), trimmed.
const apiCluster = (overrides: Partial<ApiCluster> = {}): ApiCluster => ({
  name: 'site-paris-1',
  aiGridEnabled: true,
  provisioned: true,
  hubAcceptsClient: true,
  location: 'paris',
  site: 'paris-dc1',
  region: 'europe-west',
  siteName: 'Paris DC1',
  latitude: 48.8566,
  longitude: 2.3522,
  openshiftVersion: '4.22.15',
  status: 'ready',
  statusMessage: 'Managed cluster is available',
  resourceVersion: '7',
  labels: { 'ai-grid/enabled': 'true' },
  ...overrides,
});

describe('toGridCluster', () => {
  it.each([
    ['ready', 'Ready', undefined],
    ['offline', 'Offline', undefined],
    ['unknown', 'Unknown', undefined],
    ['pendingimport', 'Unknown', 'Pending import'],
    ['importing', 'Unknown', 'Importing'],
    ['importfailed', 'Unknown', 'Import failed'],
    ['detaching', 'Unknown', 'Detaching'],
    ['notaccepted', 'Unknown', 'Not accepted'],
    [undefined, 'Unknown', undefined],
  ])("maps the BFF's cluster state %s to the PoC availability %s", (status, availability, state) => {
    const cluster = toGridCluster(apiCluster({ status }));
    expect(cluster.status).toBe(availability);
    expect(cluster.state).toBe(state);
  });

  it('keeps the backend status message for the tooltip', () => {
    expect(toGridCluster(apiCluster({ status: 'importing', statusMessage: 'Import in progress' }))).toMatchObject({
      state: 'Importing',
      statusMessage: 'Import in progress',
    });
  });

  it('shows the provisioning word', () => {
    expect(toGridCluster(apiCluster()).provisioningStatus).toBe('Provisioned');
    expect(toGridCluster(apiCluster({ provisioned: false })).provisioningStatus).toBe('Provisioning');
    expect(toGridCluster(apiCluster({ aiGridEnabled: false, provisioned: false })).provisioningStatus).toBe(
      'Not provisioned',
    );
    // Just removed: the hub still reports it provisioned until its Policy lets go.
    expect(toGridCluster(apiCluster({ aiGridEnabled: false, provisioned: true })).provisioningStatus).toBe(
      'Not provisioned',
    );
  });

  it('reads coordinates and keeps them absent when the backend sends none', () => {
    expect(toGridCluster(apiCluster())).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
    const unmapped = toGridCluster(apiCluster({ latitude: undefined, longitude: undefined }));
    expect(unmapped.latitude).toBeUndefined();
    expect(unmapped.longitude).toBeUndefined();
  });

  it('keeps the shared fields and only those', () => {
    const json = {
      ...apiCluster(),
      conditions: [{ type: 'ManagedClusterConditionAvailable', status: 'True' }],
      annotations: { 'ai-grid/latitude': '48.8566' },
      gpuCapacity: 8,
    } as ApiCluster;
    expect(toGridCluster(json)).toEqual({
      name: 'site-paris-1',
      status: 'Ready',
      state: undefined,
      statusMessage: 'Managed cluster is available',
      aiGridEnabled: true,
      provisioned: true,
      provisioningStatus: 'Provisioned',
      location: 'paris',
      site: 'paris-dc1',
      region: 'europe-west',
      siteName: 'Paris DC1',
      latitude: 48.8566,
      longitude: 2.3522,
      openshiftVersion: '4.22.15',
      gpuCapacity: 8,
      addons: {},
      conditions: [{ type: 'ManagedClusterConditionAvailable', status: 'True' }],
      resourceVersion: '7',
      labels: { 'ai-grid/enabled': 'true' },
    });
  });

  it('keeps the hub details the details page shows', () => {
    const json = {
      ...apiCluster(),
      consoleUrl: 'https://console.example.com',
      kubernetesVersion: 'v1.35.6',
      platform: 'AWS',
      product: 'ROSA',
      capacity: { cpu: '32', 'nvidia.com/gpu': '1' },
      gpuCapacity: 1,
      allocatable: { cpu: '31' },
      creationTimestamp: '2026-10-21T00:15:04Z',
      addons: { submariner: 'available' },
    } as ApiCluster;
    expect(toGridCluster(json)).toMatchObject({
      consoleUrl: 'https://console.example.com',
      kubernetesVersion: 'v1.35.6',
      platform: 'AWS',
      product: 'ROSA',
      capacity: { cpu: '32', 'nvidia.com/gpu': '1' },
      gpuCapacity: 1,
      allocatable: { cpu: '31' },
      creationTimestamp: '2026-10-21T00:15:04Z',
      addons: { submariner: 'available' },
    });
  });

  it('gives a cluster without labels an empty map', () => {
    expect(toGridCluster(apiCluster({ labels: undefined })).labels).toEqual({});
  });
});

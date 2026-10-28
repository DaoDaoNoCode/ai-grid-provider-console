import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { describe, expect, it } from 'vitest';
import { ManagedClusterSchema, type ManagedCluster } from '../../gen/ai_grid/v1/managed_cluster_type_pb';
import { toClusterView } from './clusterView';

/** A ManagedCluster as Clusters/List answers it, with what the test sets. */
const cluster = (init: {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  availableCondition?: string;
  provisioning?: string;
  capacity?: Record<string, string>;
  claims?: Record<string, string>;
}): ManagedCluster =>
  create(ManagedClusterSchema, {
    id: 'site-a',
    metadata: {
      name: 'site-a',
      version: 6141364,
      labels: init.labels ?? {},
      annotations: init.annotations ?? {},
      creationTimestamp: timestampFromDate(new Date('2026-10-20T14:00:00Z')),
    },
    spec: { hubAcceptsClient: true },
    status: {
      availableCondition: init.availableCondition ?? 'True',
      provisioning: init.provisioning ?? '',
      kubernetesVersion: 'v1.34.9',
      capacity: init.capacity ?? {},
      clusterClaims: Object.entries(init.claims ?? {}).map(([name, value]) => ({ name, value })),
    },
  });

const member = { aiGridEnabled: true };

describe('toClusterView', () => {
  it('reads the documented labels, annotations and claims', () => {
    const view = toClusterView(
      cluster({
        labels: {
          location: 'us-east',
          'ai-grid/site': 'ashburn-dc1',
          'ai-grid/region': 'us-east',
          openshiftVersion: '4.21.36',
        },
        annotations: {
          'ai-grid/site-name': 'Ashburn DC1',
          'ai-grid/latitude': '39.0438',
          'ai-grid/longitude': '-77.4874',
        },
        claims: {
          'consoleurl.cluster.open-cluster-management.io': 'https://console.example.com',
          'platform.open-cluster-management.io': 'AWS',
          'product.open-cluster-management.io': 'OpenShift',
        },
      }),
      member,
    );
    expect(view).toMatchObject({
      name: 'site-a',
      version: 6141364,
      location: 'us-east',
      site: 'ashburn-dc1',
      region: 'us-east',
      siteName: 'Ashburn DC1',
      latitude: 39.0438,
      longitude: -77.4874,
      openshiftVersion: '4.21.36',
      consoleUrl: 'https://console.example.com',
      platform: 'AWS',
      product: 'OpenShift',
      kubernetesVersion: 'v1.34.9',
      creationTimestamp: '2026-10-20T14:00:00.000Z',
    });
  });

  it('words the Available condition, Unknown while the BFF reports a state behind it', () => {
    expect(toClusterView(cluster({ availableCondition: 'True' })).status).toBe('Ready');
    expect(toClusterView(cluster({ availableCondition: 'False' })).status).toBe('Offline');
    expect(toClusterView(cluster({ availableCondition: 'Unknown' })).status).toBe('Unknown');
    expect(toClusterView(cluster({ availableCondition: '' })).status).toBe('Unknown');
    const detaching = toClusterView(cluster({ availableCondition: 'True' }), {
      aiGridEnabled: false,
      state: 'Detaching',
    });
    expect(detaching).toMatchObject({ status: 'Unknown', state: 'Detaching' });
  });

  it("takes membership from the BFF's answer, not from the labels", () => {
    const labelled = cluster({ labels: { 'ai-grid/enabled': 'true' }, provisioning: 'Compliant' });
    expect(toClusterView(labelled)).toMatchObject({ aiGridEnabled: false, provisioningStatus: 'Not provisioned' });
    expect(toClusterView(labelled, member)).toMatchObject({ aiGridEnabled: true, provisioningStatus: 'Provisioned' });
    for (const provisioning of ['', 'Pending', 'NonCompliant']) {
      expect(toClusterView(cluster({ provisioning }), member).provisioningStatus).toBe('Provisioning');
    }
  });

  it('counts the GPUs in the capacity as the device plugin writes them, and keeps 0 apart from none', () => {
    expect(toClusterView(cluster({ capacity: { 'nvidia.com/gpu': '16' } })).gpuCapacity).toBe(16);
    expect(toClusterView(cluster({ capacity: { cpu: '8' } })).gpuCapacity).toBe(0);
    // Another quantity spelling reads as 0, as the BFF read it.
    expect(toClusterView(cluster({ capacity: { 'nvidia.com/gpu': '1e1' } })).gpuCapacity).toBe(0);
    expect(toClusterView(cluster({ capacity: { 'nvidia.com/gpu': '-1' } })).gpuCapacity).toBeUndefined();
    const none = toClusterView(cluster({}));
    expect(none.capacity).toBeUndefined();
    expect(none.gpuCapacity).toBeUndefined();
  });

  it('leaves out coordinates that are not numbers in range, and both when one is missing', () => {
    const at = (latitude: string, longitude: string) =>
      toClusterView(cluster({ annotations: { 'ai-grid/latitude': latitude, 'ai-grid/longitude': longitude } }));
    expect(at(' 48.8566 ', '2.3522')).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
    for (const [lat, lon] of [
      ['91', '0'],
      ['0', '-180.5'],
      ['north', '0'],
      ['NaN', '0'],
      ['Infinity', '0'],
      ['0x10', '0'],
      ['', '2'],
    ]) {
      const view = at(lat, lon);
      expect(view.latitude).toBeUndefined();
      expect(view.longitude).toBeUndefined();
    }
  });

  it('shows nothing for empty values rather than empty strings', () => {
    const view = toClusterView(
      cluster({ labels: { location: '' }, claims: { 'platform.open-cluster-management.io': '' } }),
    );
    expect(view.location).toBeUndefined();
    expect(view.platform).toBeUndefined();
    expect(view.site).toBeUndefined();
  });
});

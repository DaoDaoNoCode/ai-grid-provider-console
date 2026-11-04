import { describe, expect, it } from 'vitest';
import type { ClusterRole } from '../../api/clusters';
import { roleSet } from './editClusterText';

const SETTLES = 'The cluster shows Provisioning until the installation finishes.';

describe('roleSet', () => {
  it.each<[ClusterRole, string, string]>([
    [
      'ingress',
      'Role set to Ingress',
      'The hub installs MaaS, the consumer gateway, the MaaS portal, and the database replica on this cluster.',
    ],
    [
      'inference',
      'Role set to Inference',
      'The hub installs KServe model serving, the provider gateway, and the GPU operators on this cluster.',
    ],
    [
      'combined',
      'Role set to Combined',
      'The hub installs MaaS, the consumer gateway, the MaaS portal, the database replica, KServe model serving, the provider gateway, and the GPU operators on this cluster.',
    ],
  ])('words %s', (role, title, installs) => {
    expect(roleSet(role)).toEqual({ title, installs, settling: SETTLES });
  });
});

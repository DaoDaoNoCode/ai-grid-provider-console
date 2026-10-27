import { describe, expect, it } from 'vitest';
import { seedClusters } from '../../api/MockConsoleService';
import { gpuCount } from './clusterInfo';

describe('gpuCount', () => {
  const cluster = () => seedClusters()[0];

  it("reads the BFF's gpuCapacity, not the capacity map", () => {
    // The BFF reads "1e1" as 0; the console must show the same number, not parse the map itself.
    expect(gpuCount({ ...cluster(), capacity: { 'nvidia.com/gpu': '1e1' }, gpuCapacity: 0 })).toBe(0);
    expect(gpuCount({ ...cluster(), gpuCapacity: 16 })).toBe(16);
  });

  it('keeps 0 apart from no capacity reported', () => {
    expect(gpuCount({ ...cluster(), capacity: { cpu: '8' }, gpuCapacity: 0 })).toBe(0);
    expect(gpuCount({ ...cluster(), capacity: undefined, gpuCapacity: 0 })).toBeUndefined();
    expect(gpuCount({ ...cluster(), gpuCapacity: undefined })).toBeUndefined();
  });

  it('drops a negative count, which the BFF passes through from "-1"', () => {
    expect(gpuCount({ ...cluster(), gpuCapacity: -1 })).toBeUndefined();
  });
});

import { create } from '@bufbuild/protobuf';
import {
  ClusterGPUsSchema,
  GPUConfigurationSchema,
  GPUSharingSchema,
} from '../../gen/ai_grid/v1/managed_cluster_type_pb';
import {
  capacityText,
  configurationText,
  gpuArchitecture,
  gpuMemory,
  gpuModel,
  gpuSharing,
  migProfile,
} from './gpuText';

const sharing = (s: { strategy: string; replicas?: number; migStrategy?: string }) =>
  create(GPUSharingSchema, { replicas: 1, ...s });
const none = sharing({ strategy: 'none' });

describe('gpuText', () => {
  it('names products, memory and architectures', () => {
    expect(gpuModel('NVIDIA-L4')).toBe('NVIDIA L4');
    expect(gpuModel('NVIDIA-L4-SHARED')).toBe('NVIDIA L4');
    expect(gpuModel('NVIDIA-A100-SXM4-40GB-MIG-3g.20gb')).toBe('NVIDIA A100-SXM4-40GB');
    expect(migProfile('NVIDIA-A100-SXM4-40GB-MIG-3g.20gb')).toBe('3g.20gb');
    expect(migProfile('NVIDIA-L4')).toBeUndefined();
    expect(gpuMemory(23034n)).toBe('22.5 GiB');
    expect(gpuMemory(81920n)).toBe('80 GiB');
    expect(gpuMemory(0n)).toBeUndefined();
    expect(gpuArchitecture('ada-lovelace')).toBe('Ada Lovelace');
    expect(gpuArchitecture(undefined)).toBeUndefined();
  });

  it('words sharing, or nothing when the GPUs are not shared', () => {
    expect(gpuSharing(none, 'NVIDIA-L4')).toBeUndefined();
    expect(gpuSharing(undefined, 'NVIDIA-L4')).toBeUndefined();
    expect(gpuSharing(sharing({ strategy: 'time-slicing', replicas: 4 }), 'NVIDIA-L4-SHARED')).toBe('Time-sliced ×4');
    expect(gpuSharing(sharing({ strategy: 'mps', replicas: 2 }), 'NVIDIA-L4')).toBe('MPS ×2');
    expect(gpuSharing(sharing({ strategy: 'mig', migStrategy: 'mixed' }), 'NVIDIA-H100')).toBe('MIG');
  });

  it('words a configuration and a capacity as provider admins asked', () => {
    const c = create(GPUConfigurationSchema, {
      vendor: 'NVIDIA',
      product: 'NVIDIA-H200',
      memoryMib: 143771n,
      gpusPerNode: 8,
      nodeCount: 4,
      sharing: none,
    });
    expect(configurationText(c)).toBe('NVIDIA H200, 8 GPUs/node');
    expect(configurationText({ ...c, gpusPerNode: 1 })).toBe('NVIDIA H200, 1 GPU/node');
    expect(capacityText(create(ClusterGPUsSchema, { total: 32, nodeCount: 4, configurations: [c] }))).toBe(
      '4 nodes, 32 GPUs',
    );
    expect(capacityText(create(ClusterGPUsSchema, { total: 1, nodeCount: 1, configurations: [c] }))).toBe(
      '1 node, 1 GPU',
    );
  });
});

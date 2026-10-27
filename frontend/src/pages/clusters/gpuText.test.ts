import {
  capacityText,
  configurationText,
  gpuArchitecture,
  gpuMemory,
  gpuModel,
  gpuSharing,
  migProfile,
} from './gpuText';

const none = { strategy: 'none', replicas: 1, migCapable: false };

describe('gpuText', () => {
  it('names products, memory and architectures', () => {
    expect(gpuModel('NVIDIA-L4')).toBe('NVIDIA L4');
    expect(gpuModel('NVIDIA-L4-SHARED')).toBe('NVIDIA L4');
    expect(gpuModel('NVIDIA-A100-SXM4-40GB-MIG-3g.20gb')).toBe('NVIDIA A100-SXM4-40GB');
    expect(migProfile('NVIDIA-A100-SXM4-40GB-MIG-3g.20gb')).toBe('3g.20gb');
    expect(migProfile('NVIDIA-L4')).toBeUndefined();
    expect(gpuMemory(23034)).toBe('22.5 GiB');
    expect(gpuMemory(81920)).toBe('80 GiB');
    expect(gpuMemory(0)).toBeUndefined();
    expect(gpuArchitecture('ada-lovelace')).toBe('Ada Lovelace');
    expect(gpuArchitecture(undefined)).toBeUndefined();
  });

  it('words sharing, or nothing when the GPUs are not shared', () => {
    expect(gpuSharing(none, 'NVIDIA-L4')).toBeUndefined();
    expect(gpuSharing({ ...none, strategy: 'time-slicing', replicas: 4 }, 'NVIDIA-L4-SHARED')).toBe('Time-sliced ×4');
    expect(gpuSharing({ ...none, strategy: 'mps', replicas: 2 }, 'NVIDIA-L4')).toBe('MPS ×2');
    expect(gpuSharing({ ...none, strategy: 'mig', migStrategy: 'mixed' }, 'NVIDIA-H100')).toBe('MIG');
  });

  it('words a configuration and a capacity as provider admins asked', () => {
    const c = {
      vendor: 'NVIDIA',
      product: 'NVIDIA-H200',
      memoryMib: 143771,
      gpusPerNode: 8,
      nodeCount: 4,
      sharing: none,
    };
    expect(configurationText(c)).toBe('NVIDIA H200, 8 GPUs/node');
    expect(configurationText({ ...c, gpusPerNode: 1 })).toBe('NVIDIA H200, 1 GPU/node');
    expect(capacityText({ total: 32, nodeCount: 4, configurations: [c], nodes: [] })).toBe('4 nodes, 32 GPUs');
    expect(capacityText({ total: 1, nodeCount: 1, configurations: [c], nodes: [] })).toBe('1 node, 1 GPU');
  });
});

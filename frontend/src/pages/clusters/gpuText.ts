// How the Clusters pages word a cluster's GPUs. Presentation only: the counts, the configurations
// and the sharing come from the backend's GPU inventory (ACM Search and GPU Feature Discovery's
// labels), and nothing here decides what they mean.
import type { ClusterGPUs, GPUConfiguration, GPUSharing } from '../../gen/ai_grid/v1/managed_cluster_type_pb';

const MIG_SUFFIX = /-MIG-([^-]+)$/;
const SHARED_SUFFIX = /-SHARED$/;

/**
 * GPU Feature Discovery's product as a name: "NVIDIA-L4" as "NVIDIA L4". The MIG profile and the
 * time-slicing "-SHARED" suffix are left out here; the sharing says them.
 */
export const gpuModel = (product: string) =>
  product
    .replace(MIG_SUFFIX, '')
    .replace(SHARED_SUFFIX, '')
    .replace(/^NVIDIA-/, 'NVIDIA ');

/** The MIG profile in a MIG product, such as "3g.20gb" in "NVIDIA-A100-SXM4-40GB-MIG-3g.20gb". */
export const migProfile = (product: string) => product.match(MIG_SUFFIX)?.[1];

/** Memory per GPU from MiB (an int64), one decimal dropped when zero: 23034 MiB as "22.5 GiB". */
export const gpuMemory = (mib: bigint) => (mib > 0n ? `${Math.round((Number(mib) / 1024) * 10) / 10} GiB` : undefined);

/** GPU Feature Discovery's family as a name: "ada-lovelace" as "Ada Lovelace". */
export const gpuArchitecture = (family?: string) =>
  family
    ?.split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** How the GPUs are shared, or nothing when they aren't: "Time-sliced ×4", "MPS ×2", "MIG 3g.20gb". */
export const gpuSharing = (sharing: GPUSharing | undefined, product: string): string | undefined => {
  switch (sharing?.strategy) {
    case 'time-slicing':
      return `Time-sliced ×${sharing.replicas}`;
    case 'mps':
      return `MPS ×${sharing.replicas}`;
    case 'mig': {
      const profile = migProfile(product);
      return profile ? `MIG ${profile}` : 'MIG';
    }
    default:
      return undefined;
  }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One configuration as the list shows it: "NVIDIA H200, 8 GPUs/node". */
export const configurationText = (c: GPUConfiguration) =>
  `${gpuModel(c.product)}, ${plural(c.gpusPerNode, 'GPU', 'GPUs')}/node`;

/** The cluster's GPU capacity as the list shows it: "4 nodes, 32 GPUs". */
export const capacityText = (g: ClusterGPUs) =>
  `${plural(g.nodeCount, 'node', 'nodes')}, ${plural(g.total, 'GPU', 'GPUs')}`;

/** A GPU count without an inventory: "16 GPUs". */
export const gpuCountText = (n: number) => plural(n, 'GPU', 'GPUs');

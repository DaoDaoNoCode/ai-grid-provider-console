import type { GridCluster } from '../../api/types';
import type { MembershipChange } from './MembershipModal';

/** The resource name the NVIDIA device plugin advertises GPUs under. */
const GPU_RESOURCE = 'nvidia.com/gpu';

/** The Connection tooltip: the ACM state behind Unknown, then the backend's message. */
export const statusReason = (c: GridCluster) => [c.state, c.statusMessage].filter(Boolean).join(': ') || undefined;

/** Why a cluster can't be added: the hub hasn't accepted it, hasn't finished importing it, or is detaching it. */
export const cannotAddReason = (c: GridCluster) => {
  if (c.state === 'Not accepted') {
    return "The hub hasn't accepted this cluster yet. Accept it in ACM, then add it to AI Grid.";
  }
  return c.state ? `The hub can add this cluster to AI Grid once it has imported it (now: ${c.state}).` : undefined;
};

/**
 * The cluster's NVIDIA GPUs as the hub reports its capacity: 0 when it reports capacity without
 * GPUs (no GPU nodes, or no GPU operator yet), undefined when it reports no capacity at all.
 */
export const gpuCount = (c: GridCluster): number | undefined => {
  if (!c.capacity) return undefined;
  const gpus = Number(c.capacity[GPU_RESOURCE] ?? '0');
  return Number.isInteger(gpus) && gpus >= 0 ? gpus : undefined;
};

/** The one membership action a provider admin has on a cluster: Remove for a member, else Add. */
export const membershipAction = (c: GridCluster, onChange: (change: MembershipChange) => void) =>
  c.aiGridEnabled
    ? {
        key: 'remove',
        label: 'Remove from AI Grid',
        isDanger: true,
        onClick: () => onChange({ cluster: c, join: false }),
      }
    : {
        key: 'add',
        label: 'Add to AI Grid',
        disabledReason: cannotAddReason(c),
        onClick: () => onChange({ cluster: c, join: true }),
      };

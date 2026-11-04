import type { ClusterView } from './clusterView';
import { editText } from './editClusterText';
import type { MembershipChange } from './MembershipModal';

/** The Connection tooltip: the ACM state behind Unknown, then the backend's message. */
export const statusReason = (c: ClusterView) => [c.state, c.statusMessage].filter(Boolean).join(': ') || undefined;

/** Why a cluster can't be added: the hub hasn't accepted it, hasn't finished importing it, or is detaching it. */
export const cannotAddReason = (c: ClusterView) => {
  if (c.state === 'Not accepted') {
    return 'The hub has not accepted this cluster. To add it to AI Grid, first accept it in ACM.';
  }
  return c.state
    ? `This cluster can be added to AI Grid after the hub imports it. Current state: ${c.state}.`
    : undefined;
};

/**
 * The cluster's NVIDIA GPUs as the hub reports its capacity (`gpuCapacity`, clusterView.ts): 0 when
 * it reports capacity without GPUs (no GPU nodes, or no GPU operator yet), undefined when it
 * reports no capacity at all or a negative count.
 */
export const gpuCount = (c: ClusterView): number | undefined => c.gpuCapacity;

/**
 * The AI Grid actions a provider admin has on a cluster: for a member, Edit, then Remove
 * (destructive, last, after a divider); otherwise Add.
 */
export const membershipActions = (
  c: ClusterView,
  onChange: (change: MembershipChange) => void,
  onEdit: (cluster: ClusterView) => void,
) =>
  c.aiGridEnabled
    ? [
        { key: 'edit', label: editText.action, onClick: () => onEdit(c) },
        { key: 'divider', isSpacer: true },
        {
          key: 'remove',
          label: 'Remove from AI Grid',
          isDanger: true,
          onClick: () => onChange({ cluster: c, join: false }),
        },
      ]
    : [
        {
          key: 'add',
          label: 'Add to AI Grid',
          disabledReason: cannotAddReason(c),
          onClick: () => onChange({ cluster: c, join: true }),
        },
      ];

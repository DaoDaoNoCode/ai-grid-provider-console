import type { ClusterRole } from '../../api/clusters';

/**
 * The roles a member can have, as Add to AI Grid offers them and the Clusters table shows them. The
 * clusters tenants send their requests to are MaaS clusters in AI Grid's setup docs; the label
 * value stays `ingress`, which the hub's Placements select on.
 */
export const clusterRoles: { value: ClusterRole; label: string; description: string }[] = [
  { value: 'combined', label: 'Combined', description: 'A MaaS (ingress) cluster that also serves models.' },
  {
    value: 'ingress',
    label: 'MaaS (ingress)',
    description: 'Where tenants send their requests: runs MaaS and routes them to inference clusters.',
  },
  { value: 'inference', label: 'Inference', description: 'Serves models behind a MaaS (ingress) cluster.' },
];

/** The cluster's `ai-grid/role` label when it's one of the roles above. */
export const roleOf = (labels: Record<string, string>) => clusterRoles.find((r) => r.value === labels['ai-grid/role']);

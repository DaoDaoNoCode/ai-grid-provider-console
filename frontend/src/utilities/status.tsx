import type { LabelProps } from '@patternfly/react-core';
import {
  BanIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InProgressIcon,
  OutlinedQuestionCircleIcon,
  PendingIcon,
  RhUiClockIcon,
  RhUiOffIcon,
} from '@patternfly/react-icons';

/**
 * How a status reads, the same on every page (PatternFly's status pattern: a color and an icon
 * together). Success, warning and danger use the Label's status colors; "info" is for work in
 * progress and "neutral" for states that are neither good nor bad.
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Every status word the console shows, by tone. A word missing here reads as neutral. */
const tones: Record<string, StatusTone> = {
  // Clusters (GridCluster.status) and AI Grid provisioning.
  Ready: 'success',
  Offline: 'danger',
  Unknown: 'neutral',
  // A cluster's GPU node (its Ready condition, through ACM Search).
  'Not ready': 'danger',
  Provisioned: 'success',
  Provisioning: 'info',
  'Not provisioned': 'neutral',
  // A cluster outside AI Grid (no ai-grid/enabled label).
  'Not added': 'neutral',
  // Models (the Models pages' phase words) and subscriptions (their phase as reported).
  Active: 'success',
  Pending: 'info',
  Failed: 'danger',
  // A model's Status column (ModelState) and each cluster's, as in the UX design of console #114:
  // Partially ready when clusters disagree; the Git states Saved to Git (grey), Syncing (blue) and
  // Synced; Starting (blue, not PatternFly's purple info); Stopped (grey). Pending sync: a placed
  // cluster that hasn't reported yet.
  'Partially ready': 'warning',
  'Saved to Git': 'neutral',
  Syncing: 'info',
  Synced: 'success',
  Starting: 'neutral',
  Stopped: 'neutral',
  'Pending sync': 'neutral',
  // A cluster's Git sync in its dialog (ModelSyncState).
  'Out of sync': 'info',
  'Sync failed': 'danger',
  // The Availability column (ModelMaasState): MaaS publishes the model but no cluster serves it.
  Unavailable: 'warning',
  // A subscription's model that the hub doesn't have.
  'Not found': 'danger',
  // ACM add-ons (feature.open-cluster-management.io/addon-* labels).
  Available: 'success',
  Unreachable: 'danger',
  // Organizations.
  Enabled: 'success',
  Disabled: 'neutral',
};

export const statusTone = (status: string | undefined): StatusTone =>
  status ? (tones[status] ?? 'neutral') : 'neutral';

const toneProps: Record<StatusTone, Pick<LabelProps, 'status' | 'color' | 'icon'>> = {
  success: { status: 'success', icon: <CheckCircleIcon /> },
  warning: { status: 'warning', icon: <ExclamationTriangleIcon /> },
  danger: { status: 'danger', icon: <ExclamationCircleIcon /> },
  info: { status: 'info', icon: <InProgressIcon /> },
  neutral: { color: 'grey', icon: <OutlinedQuestionCircleIcon /> },
};

/** The Label props for a status: PatternFly's status color with its icon. */
export const statusLabelProps = (status: string | undefined): Pick<LabelProps, 'status' | 'color' | 'icon'> => {
  const props = toneProps[statusTone(status)];
  // A few states have a more specific icon than their tone's.
  if (status === 'Pending') {
    return { ...props, icon: <PendingIcon /> };
  }
  if (status === 'Saved to Git') {
    return { color: 'grey', icon: <RhUiClockIcon /> };
  }
  if (status === 'Starting' || status === 'Syncing') {
    return { color: 'blue', icon: <InProgressIcon /> };
  }
  if (status === 'Stopped') {
    return { color: 'grey', icon: <RhUiOffIcon /> };
  }
  // Pending sync, and the MaaS words that are Pending in the Availability column (#114's purple
  // hourglass).
  if (
    status === 'Pending sync' ||
    status === 'Awaiting subscription' ||
    status === 'Configuring routing' ||
    status === 'Awaiting subscription and backend'
  ) {
    return { color: 'purple', icon: <PendingIcon /> };
  }
  if (status === 'Disabled' || status === 'Not provisioned' || status === 'Not added') {
    return { ...props, icon: <BanIcon /> };
  }
  return props;
};

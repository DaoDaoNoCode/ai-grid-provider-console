import type { LabelProps } from '@patternfly/react-core';
import {
  BanIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InProgressIcon,
  OutlinedQuestionCircleIcon,
  PendingIcon,
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
  Provisioned: 'success',
  Provisioning: 'info',
  'Not provisioned': 'neutral',
  // Models (ManagedModel.phase) and subscriptions (normalized MaaSSubscription phases).
  Active: 'success',
  Pending: 'info',
  Failed: 'danger',
  Invalid: 'danger',
  Unavailable: 'danger',
  Unhealthy: 'danger',
  Degraded: 'warning',
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
  // A few neutral states have a more specific icon than the question mark.
  if (status === 'Pending') {
    return { ...props, icon: <PendingIcon /> };
  }
  if (status === 'Disabled' || status === 'Not provisioned') {
    return { ...props, icon: <BanIcon /> };
  }
  return props;
};

// Ported from krisv/ai-grid-cloud-provider-poc src/app/utilities/phaseLabelUtils.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/utilities/phaseLabelUtils.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Only the subscription branches are ported: the PoC's model, external model, external
// provider and policy labels have no pages here, and its telemetry helpers are dropped.
// The PoC's Saved phase is gone: the phases are MaaSSubscription's (mock/research/models-maas.md
// 3.5), and a Degraded subtext shows the Ready condition's message when there is one.
import type { AlertProps, ContentProps, LabelProps } from '@patternfly/react-core';
import { Stack, StackItem } from '@patternfly/react-core';
import { PhaseApiDetails } from '../pages/subscriptions/Phase/PhaseApiDetails';
import type { StatusTone } from './status';
import { statusLabelProps, statusTone } from './status';

/** A model that keeps a subscription from being Ready. */
export type AffectedModel = { name: string; displayName?: string; phase?: string; statusMessage?: string };

export enum PhaseResourceType {
  SUBSCRIPTION = 'Subscription',
}

export enum PhaseStatus {
  ACTIVE = 'Active',
  READY = 'Ready',
  PENDING = 'Pending',
  FAILED = 'Failed',
  INVALID = 'Invalid',
  DEGRADED = 'Degraded',
  UNAVAILABLE = 'Unavailable',
  UNHEALTHY = 'Unhealthy',
  UNKNOWN = 'Unknown',
}

/** The label props for a phase, from the console's one status mapping (utilities/status). */
export const getPhaseProps = (
  phase: string | undefined,
): { icon: React.ReactNode; status?: LabelProps['status']; color?: LabelProps['color'] } => {
  const { icon, status, color } = statusLabelProps(phase);
  return { icon, status, color };
};

/** The phase as the label shows it: an Active subscription reads Ready, as in odh-dashboard. */
export const normalizePhase = (phase: string | undefined): string => {
  const normalized = phase?.trim();
  if (normalized === PhaseStatus.UNHEALTHY) {
    return PhaseStatus.UNAVAILABLE;
  }
  if (normalized === PhaseStatus.ACTIVE) {
    return PhaseStatus.READY;
  }
  return normalized || PhaseStatus.UNKNOWN;
};

/** An affected model the subscription names but the hub doesn't have (no MaaSModelRef). */
export const MODEL_NOT_FOUND_STATUS_MESSAGE = 'Model not found. It may have been deleted.';

/** The subtext under a label; for Degraded, the Ready condition's message when there is one. */
export const getStatusSubtext = (phase: string, statusMessage?: string): React.ReactNode | undefined => {
  switch (phase) {
    case PhaseStatus.FAILED:
      return 'All models unavailable or setup failed';
    case PhaseStatus.DEGRADED:
      return statusMessage || 'Models unavailable';
    case PhaseStatus.PENDING:
      return 'Setting up subscription';
    case PhaseStatus.INVALID:
      return 'Configuration error';
    default:
      return undefined;
  }
};

export const getModalSubtitle = (): string => 'Subscription status';

const getAlertContent = (phase: string): { title: string; children: string } | undefined => {
  switch (phase) {
    case PhaseStatus.FAILED:
      return {
        title: 'Subscription failed',
        children: 'Either the rate limit configuration failed, or this subscription includes no available models. ',
      };
    case PhaseStatus.DEGRADED:
      return {
        title: 'Subscription degraded',
        children: 'At least one of the models or rate limits included in this subscription is unavailable.',
      };
    case PhaseStatus.PENDING:
      return { title: 'Pending', children: 'Subscription setup is in progress.' };
    case PhaseStatus.INVALID:
      return {
        title: 'Invalid subscription configuration',
        children:
          'The subscription configuration is invalid or missing required fields. Edit the subscription and ensure its configuration is correct.',
      };
    default:
      return undefined;
  }
};

// The alert and the subtext take their colour from the same tone table as the label
// (utilities/status), so a phase reads the same colour everywhere.
const ALERT_VARIANTS: Record<StatusTone, AlertProps['variant']> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'info',
};

const getAlertVariant = (phase: string): AlertProps['variant'] => ALERT_VARIANTS[statusTone(phase)];

export const getModalAlertProps = (
  phase: string,
  statusMessage?: string,
  reason?: string,
  status?: string,
  conditionType?: string,
  lastTransitionTime?: string,
): AlertProps => {
  const phaseProps = getPhaseProps(phase);
  const alertContent = getAlertContent(phase);
  const hasAlertBody = !!alertContent?.children;
  const showApiDetails =
    (phase === PhaseStatus.FAILED ||
      phase === PhaseStatus.INVALID ||
      phase === PhaseStatus.UNAVAILABLE ||
      phase === PhaseStatus.DEGRADED) &&
    (!!reason || !!statusMessage);

  return {
    variant: getAlertVariant(phase),
    title: alertContent?.title,
    children:
      hasAlertBody || showApiDetails ? (
        <Stack hasGutter>
          {hasAlertBody ? <StackItem data-testid="phase-modal-alert-body">{alertContent.children}</StackItem> : null}
          {showApiDetails ? (
            <StackItem>
              <PhaseApiDetails
                reason={reason}
                statusMessage={statusMessage}
                status={status}
                conditionType={conditionType}
                lastTransitionTime={lastTransitionTime}
              />
            </StackItem>
          ) : null}
        </Stack>
      ) : undefined,
    ...phaseProps,
  };
};

/**
 * The subtext's colour. It isn't underlined: unlike odh-dashboard's, it isn't a link (the label
 * opens the status), so it shouldn't look like one.
 */
export const getSubtextProps = (phase: string): ContentProps | undefined => {
  const tone = statusTone(phase);
  return tone === 'warning' || tone === 'danger' || tone === 'info'
    ? { className: `pf-v6-u-text-color-status-${tone}` }
    : undefined;
};

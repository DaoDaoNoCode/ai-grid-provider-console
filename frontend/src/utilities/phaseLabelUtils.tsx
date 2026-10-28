// Ported from krisv/ai-grid-cloud-provider-poc src/app/utilities/phaseLabelUtils.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/utilities/phaseLabelUtils.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Only the subscription branches are ported: the PoC's model, external model, external
// provider and policy labels have no pages here, and its telemetry helpers are dropped.
// The PoC's Saved phase is gone: the phases are MaaSSubscription's (mock/research/models-maas.md
// 3.5), and a Degraded subtext shows the Ready condition's message when there is one. The status
// modal is gone too: a status label opens nothing (frontend/AGENTS.md, "Status").
import type { ContentProps } from '@patternfly/react-core';
import { statusTone } from './status';

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

/**
 * The phase as the label shows it. Unlike odh-dashboard, an Active subscription reads Active, as its
 * authorization policy's Active does beside it: one word for one state.
 */
export const normalizePhase = (phase: string | undefined): string => {
  const normalized = phase?.trim();
  if (normalized === PhaseStatus.UNHEALTHY) {
    return PhaseStatus.UNAVAILABLE;
  }
  return normalized || PhaseStatus.UNKNOWN;
};

/** A subscription's model that the hub doesn't have (no MaaSModelRef). */
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

/** The subtext's colour, the label's tone. It isn't underlined: it isn't a link. */
export const getSubtextProps = (phase: string): ContentProps | undefined => {
  const tone = statusTone(phase);
  return tone === 'warning' || tone === 'danger' || tone === 'info'
    ? { className: `pf-v6-u-text-color-status-${tone}` }
    : undefined;
};

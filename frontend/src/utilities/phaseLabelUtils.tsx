// Ported from krisv/ai-grid-cloud-provider-poc src/app/utilities/phaseLabelUtils.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/utilities/phaseLabelUtils.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Only the subscription branches are ported: the PoC's model, external model, external
// provider and policy labels have no pages here, and its telemetry helpers are dropped.
// The phases are the backend's git mode's: Active when every ingress cluster reports the
// subscription, Pending while any doesn't, none before a cluster reports
// (withSubscriptionPhase, internal/servers/subscriptions_git.go). The MaaS controller's Degraded,
// Failed and Invalid, and the PoC's Saved, aren't reported, so they aren't worded here. A status
// label opens nothing (frontend/AGENTS.md, "Status").
import type { ContentProps } from '@patternfly/react-core';
import { statusTone } from './status';

export enum PhaseStatus {
  ACTIVE = 'Active',
  PENDING = 'Pending',
  UNKNOWN = 'Unknown',
}

/**
 * The phase as the label shows it. Unlike odh-dashboard, an Active subscription reads Active, as its
 * authorization policy's Active does beside it: one word for one state.
 */
export const normalizePhase = (phase: string | undefined): string => phase?.trim() || PhaseStatus.UNKNOWN;

/** A subscription's model that the hub doesn't have (no MaaSModelRef). */
export const MODEL_NOT_FOUND_STATUS_MESSAGE = 'Model not found. It may have been deleted.';

/** The subtext under a label: what Pending means for a subscription. */
export const getStatusSubtext = (phase: string): React.ReactNode | undefined =>
  phase === PhaseStatus.PENDING ? 'Setting up subscription' : undefined;

/** The subtext's colour, the label's tone. It isn't underlined: it isn't a link. */
export const getSubtextProps = (phase: string): ContentProps | undefined => {
  const tone = statusTone(phase);
  return tone === 'warning' || tone === 'danger' || tone === 'info'
    ? { className: `pf-v6-u-text-color-status-${tone}` }
    : undefined;
};

// Ported from krisv/ai-grid-cloud-provider-poc src/app/shared/Phase/PhaseLabel.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/shared/Phase/PhaseLabel.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The console's StatusLabel opens nothing: the controller's message is in its tooltip, the
// subscription's page has the rest (its models and the policies for them).
import { Content } from '@patternfly/react-core';
import { StatusLabel } from '../../../components/StatusLabel';
import { getStatusSubtext, getSubtextProps, normalizePhase } from '../../../utilities/phaseLabelUtils';

type Props = {
  phase: string | undefined;
  statusMessage?: string;
  reason?: string;
};

/** A subscription's phase: an outline StatusLabel with the controller's message in its tooltip, and a subtext. */
export const PhaseLabel: React.FC<Props> = ({ phase, statusMessage, reason }) => {
  const normalized = normalizePhase(phase);
  const statusSubtext = getStatusSubtext(normalized, statusMessage);
  const subtextProps = getSubtextProps(normalized);
  return (
    <>
      <StatusLabel isCompact status={normalized} reason={statusMessage || reason} data-testid="phase-label" />
      {statusSubtext && subtextProps ? (
        <Content component="small" {...subtextProps} data-testid="phase-label-subtext">
          {statusSubtext}
        </Content>
      ) : null}
    </>
  );
};

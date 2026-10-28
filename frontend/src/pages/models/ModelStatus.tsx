import { ExpandableSection, Stack } from '@patternfly/react-core';
import type { ManagedModel } from '../../api/types';
import { StatusLabel } from '../../components/StatusLabel';
import { failureExplanations, modelPhase } from './modelStatusInfo';

/**
 * The status in words: a sentence and the next step for a known failure, else the controller's
 * message; the controller's raw reason and message fold away under "Details".
 */
export const ModelStatusDetails: React.FC<{ model: ManagedModel }> = ({ model }) => {
  const known = model.reason ? failureExplanations[model.reason] : undefined;
  const failed = modelPhase(model) === 'Failed';
  if (!known && !failed) {
    return <>{model.statusMessage ?? model.reason}</>;
  }
  return (
    <Stack hasGutter>
      <p>{known?.summary ?? 'The controller couldn’t deploy this model.'}</p>
      {known && <p>{known.next}</p>}
      <ExpandableSection toggleText="Details">
        <code className="pf-v6-u-font-size-sm pf-v6-u-text-break-word">
          {[model.reason, model.statusMessage].filter(Boolean).join(': ')}
        </code>
      </ExpandableSection>
    </Stack>
  );
};

/**
 * The model's phase as an outline StatusLabel with the backend's message (or reason) in its tooltip.
 * It opens nothing (frontend/AGENTS.md, "Status"): each location's status is in the Models list's
 * expanded row and on the model's page, which also explains a failure.
 */
export const ModelStatusLabel: React.FC<{ model: ManagedModel }> = ({ model }) => (
  <span data-testid="model-phase">
    <StatusLabel isCompact status={modelPhase(model)} reason={model.statusMessage || model.reason} />
  </span>
);

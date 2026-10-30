import { ExpandableSection, Stack } from '@patternfly/react-core';
import { titleOf, type ModelView } from './modelView';
import { StatusLabel } from '../../components/StatusLabel';
import { failureExplanations, modelPhase, statusOpens } from './modelStatusInfo';

/**
 * The status in words: a sentence and the next step for a known failure, else the backend's
 * message; the raw reason and message fold away under "Details".
 */
export const ModelStatusDetails: React.FC<{ model: ModelView }> = ({ model }) => {
  const known = model.reason ? failureExplanations[model.reason] : undefined;
  const failed = modelPhase(model) === 'Failed';
  if (!known && !failed) {
    return <>{model.statusMessage ?? model.reason}</>;
  }
  return (
    <Stack hasGutter>
      <p>{known?.summary ?? 'Unable to deploy this model.'}</p>
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
 * The model's Status column (#114): the backend's rollout word (status.state). Saved to Git, Syncing
 * and Partially ready open the model's status dialog through `onOpen`; the other words are outline,
 * with the backend's message in a tooltip. Without `onOpen` (the model page), nothing opens.
 */
export const ModelStatusLabel: React.FC<{ model: ModelView; onOpen?: () => void }> = ({ model, onOpen }) => {
  const opens = statusOpens(model.state) && !!onOpen;
  return (
    <span data-testid="model-phase">
      <StatusLabel
        isCompact
        status={model.state}
        reason={opens ? undefined : (model.statusMessage ?? model.reason)}
        onClick={opens ? onOpen : undefined}
        screenReaderSuffix={onOpen ? ` for ${titleOf(model)}` : undefined}
      />
    </span>
  );
};

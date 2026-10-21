import { useState } from 'react';
import { ExpandableSection, Label, Popover, Stack } from '@patternfly/react-core';
import type { ManagedModel } from '../../api/types';
import { getPhaseProps } from '../../utilities/phaseLabelUtils';
import { failureExplanations, hasModelStatusDetails, modelPhase, modelStatusTitle } from './modelStatusInfo';

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

/** The model's phase as a label; when there's more to say, it opens the explanation in a popover. */
export const ModelStatusLabel: React.FC<{ model: ManagedModel }> = ({ model }) => {
  const [open, setOpen] = useState(false);
  const phase = modelPhase(model);
  const { icon, status, color } = getPhaseProps(phase);
  const explained = hasModelStatusDetails(model);
  const label = (
    <Label
      isCompact
      icon={icon}
      status={status}
      color={color}
      variant="filled"
      onClick={explained ? () => setOpen((previous) => !previous) : undefined}
    >
      {phase}
    </Label>
  );
  return (
    <span data-testid="model-phase">
      {explained ? (
        <Popover
          isVisible={open}
          shouldClose={() => setOpen(false)}
          headerContent={modelStatusTitle(model)}
          bodyContent={<ModelStatusDetails model={model} />}
        >
          {label}
        </Popover>
      ) : (
        label
      )}
    </span>
  );
};

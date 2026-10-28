import { Button, EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from '@patternfly/react-core';
import type { ManagedModel } from '../../api/types';

type Props = {
  model: Pick<ManagedModel, 'name' | 'placementIssue'>;
  /** Opens the model's edit page; absent for a viewer. */
  onEdit?: () => void;
};

/**
 * A model row expanded when its placement chose no cluster: why, as the backend's placement says
 * when it isn't satisfied (PlacementSatisfied's reason and message), otherwise that it has no
 * locations.
 */
export const NotPlaced: React.FC<Props> = ({ model, onEdit }) => {
  const issue = model.placementIssue;
  return (
    <EmptyState
      variant="xs"
      titleText="Not placed on any cluster yet"
      headingLevel="h3"
      data-testid={`model-not-placed-${model.name}`}
    >
      <EmptyStateBody>
        {issue ? [issue.reason, issue.message].filter(Boolean).join(': ') : 'This model has no locations.'}
      </EmptyStateBody>
      {onEdit && (
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="link" onClick={onEdit}>
              Edit locations
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      )}
    </EmptyState>
  );
};

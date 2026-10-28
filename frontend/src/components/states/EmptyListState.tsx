import {
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  type EmptyStateProps,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';

type Props = {
  /** "No <objects>". */
  title: string;
  children: React.ReactNode;
  /** The list's create button, for a user who may create; nothing for one who may not. */
  action?: React.ReactNode;
  /** PatternFly's plus-circle for a list a user fills; another icon for one they can't. */
  icon?: EmptyStateProps['icon'];
  'data-testid'?: string;
};

/** A list with nothing in it yet: PatternFly's full empty state for creation, with the create action. */
export const EmptyListState: React.FC<Props> = ({
  title,
  children,
  action,
  icon = PlusCircleIcon,
  'data-testid': testId,
}) => (
  <EmptyState variant="lg" titleText={title} headingLevel="h2" icon={icon} data-testid={testId ?? 'empty-list-state'}>
    <EmptyStateBody>{children}</EmptyStateBody>
    {action && (
      <EmptyStateFooter>
        <EmptyStateActions>{action}</EmptyStateActions>
      </EmptyStateFooter>
    )}
  </EmptyState>
);

import {
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  type EmptyStateProps,
} from '@patternfly/react-core';

type Props = {
  title: string;
  children?: React.ReactNode;
  /** One link-styled action, such as Edit locations. */
  action?: React.ReactNode;
  headingLevel?: EmptyStateProps['headingLevel'];
  'data-testid'?: string;
};

/**
 * A section of a page, a card or an expanded row with nothing to show: PatternFly's extra-small
 * empty state, without an icon, so it doesn't compete with the page.
 */
export const SectionEmptyState: React.FC<Props> = ({
  title,
  children,
  action,
  headingLevel = 'h3',
  'data-testid': testId,
}) => (
  <EmptyState variant="xs" titleText={title} headingLevel={headingLevel} data-testid={testId}>
    {children && <EmptyStateBody>{children}</EmptyStateBody>}
    {action && (
      <EmptyStateFooter>
        <EmptyStateActions>{action}</EmptyStateActions>
      </EmptyStateFooter>
    )}
  </EmptyState>
);

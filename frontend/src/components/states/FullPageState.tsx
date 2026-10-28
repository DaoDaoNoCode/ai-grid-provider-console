import {
  Bullseye,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
  type EmptyStateProps,
} from '@patternfly/react-core';
import { LockIcon } from '@patternfly/react-icons';

type Props = {
  title: string;
  children?: React.ReactNode;
  /** PatternFly's lock for no access, the default. */
  icon?: EmptyStateProps['icon'];
  actions?: React.ReactNode;
  headingLevel?: EmptyStateProps['headingLevel'];
  /**
   * In a page that keeps its header (a 403 under the page's title): the state alone, h2. Without
   * it, the state is the whole page, centred like a loading page, with the h1.
   */
  inPage?: boolean;
};

/**
 * A state that leaves nothing of the page to show: no access, or an ended session. PatternFly's full
 * empty state, with the lock icon by default.
 */
export const FullPageState: React.FC<Props> = ({
  title,
  children,
  icon = LockIcon,
  actions,
  headingLevel,
  inPage = false,
}) => {
  const state = (
    <EmptyState
      variant="lg"
      titleText={title}
      headingLevel={headingLevel ?? (inPage ? 'h2' : 'h1')}
      icon={icon}
      data-testid="full-page-state"
    >
      {children && <EmptyStateBody>{children}</EmptyStateBody>}
      {actions && (
        <EmptyStateFooter>
          <EmptyStateActions>{actions}</EmptyStateActions>
        </EmptyStateFooter>
      )}
    </EmptyState>
  );
  if (inPage) {
    return state;
  }
  // A page section is a flex column; without the body wrapper the Bullseye grows to its height.
  return (
    <PageSection isFilled hasBodyWrapper={false}>
      <Bullseye className="pf-v6-u-flex-grow-1">{state}</Bullseye>
    </PageSection>
  );
};

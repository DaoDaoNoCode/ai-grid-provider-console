import { Component } from 'react';
import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
} from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';

type Props = {
  /** The page's path: moving to another page tries again. */
  resetKey: string;
  children: React.ReactNode;
};

type State = { failed: boolean; resetKey: string };

/**
 * Catches a page that fails to render, most often a page's code that can no longer be fetched:
 * pages load on demand, and a tab left open across a redeploy asks for files the new version no
 * longer has. A reload fetches the current version.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <PageSection isFilled>
        <EmptyState titleText="This page could not be loaded" headingLevel="h1" icon={ExclamationCircleIcon}>
          <EmptyStateBody>
            The console may have been updated since this tab opened. Reload to get the current version.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </PageSection>
    );
  }
}

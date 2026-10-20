// Ported from krisv/ai-grid-cloud-provider-poc src/shared/dashboard.tsx (ApplicationsPage) at 62319b8:
// its header section only, so every page's title, breadcrumb and description sit the same way.
import { PageSection, Title } from '@patternfly/react-core';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type Props = {
  title: string;
  description?: React.ReactNode;
  breadcrumb?: React.ReactElement;
  /** A resource's status label, beside its name. */
  status?: React.ReactNode;
  headerAction?: React.ReactNode;
};

/**
 * A page's header: the breadcrumb, the h1 title with its status beside it and its action at the
 * end, then the description. The title also names the browser tab.
 */
export const PageHeader: React.FC<Props> = ({ title, description, breadcrumb, status, headerAction }) => {
  useDocumentTitle(title);
  return (
    <PageSection>
      {breadcrumb}
      <div className="portal-page-heading">
        <div className="portal-page-heading__title">
          <Title headingLevel="h1" size="2xl">
            {title}
          </Title>
          {status}
        </div>
        {headerAction}
      </div>
      {description}
    </PageSection>
  );
};

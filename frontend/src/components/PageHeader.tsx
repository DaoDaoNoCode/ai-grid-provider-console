// Ported from krisv/ai-grid-cloud-provider-poc src/shared/dashboard.tsx (ApplicationsPage) at 62319b8:
// its header section only, so every page's title, breadcrumb and description sit the same way.
import { PageSection, Title } from '@patternfly/react-core';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type Props = {
  title: string;
  description?: React.ReactNode;
  breadcrumb?: React.ReactElement;
  headerAction?: React.ReactNode;
};

/** A page's header: the breadcrumb, the h1 title beside its action, then the description. The title also names the browser tab. */
export const PageHeader: React.FC<Props> = ({ title, description, breadcrumb, headerAction }) => {
  useDocumentTitle(title);
  return (
    <PageSection>
      {breadcrumb}
      <div className="portal-page-heading">
        <Title headingLevel="h1" size="2xl">
          {title}
        </Title>
        {headerAction}
      </div>
      {description}
    </PageSection>
  );
};

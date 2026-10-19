// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/tenants/TenantWizardPage.tsx at 62319b8.
import { Breadcrumb, BreadcrumbItem, PageSection, Spinner } from '@patternfly/react-core';
import { Link, useParams } from 'react-router-dom';
import type { UserService } from '../../api/ConsoleService';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { useServiceData } from '../../hooks/useServiceData';
import { OrganizationFormWizard } from './OrganizationFormWizard';
import { OrganizationLoadError } from './OrganizationLoadError';

type Props = { service: OrganizationsService & UserService };

/** Create at /organizations/create, edit at /organizations/:id/edit. */
export const OrganizationWizardPage: React.FC<Props> = ({ service }) => {
  const { id } = useParams();
  const [organization, loaded, error] = useServiceData<Organization | undefined>(
    () => (id ? service.getOrganization(id) : Promise.resolve(undefined)),
    undefined,
    0,
  );
  const title = id ? 'Edit organization' : 'Create organization';

  return (
    <>
      <PageHeader
        title={title}
        description="Configure organization details and an OIDC identity provider."
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/organizations">Organizations</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>{title}</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      <PageSection hasBodyWrapper={false}>
        {error ? (
          <OrganizationLoadError error={error} />
        ) : !loaded ? (
          <Spinner aria-label="Loading organization" />
        ) : (
          <OrganizationFormWizard key={id ?? 'create'} service={service} initial={organization} />
        )}
      </PageSection>
    </>
  );
};

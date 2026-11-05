// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/tenants/TenantDetailsPage.tsx at 62319b8.
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageStateSection } from '../../components/states/PageStateSection';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { useConsoleSession } from '../../context/useConsoleSession';
import { OrganizationConfigurationDetails } from './OrganizationConfigurationDetails';
import { organizationNotFound } from './organizationNotFound';
import { useDeleteOrganization } from './useDeleteOrganization';
import { useOrganization } from './useOrganizations';

export const OrganizationDetailsPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: organization, loaded, error, refresh } = useOrganization(id);
  const { user } = useConsoleSession();
  const [confirmDelete, deleteModal] = useDeleteOrganization({
    refresh: () => void refresh(),
    onDeleted: () => navigate('/organizations', { state: { notice: 'Organization deleted' } }),
  });

  const actions = organization && user?.isProviderAdmin && (
    <SimpleMenuActions
      toggleLabel="Actions"
      ariaLabel={`Actions for ${organization.name}`}
      testId="organization-actions"
      dropdownItems={[
        {
          key: 'edit',
          label: 'Edit',
          onClick: () => navigate(`/organizations/${encodeURIComponent(id)}/edit`),
        },
        { isSpacer: true },
        { key: 'delete', label: 'Delete', isDanger: true, onClick: () => confirmDelete(organization) },
      ]}
    />
  );

  return (
    <>
      <PageStateSection
        title={organization?.name ?? id}
        headerAction={actions}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/organizations">Organizations</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>{organization?.name ?? id}</BreadcrumbItem>
          </Breadcrumb>
        }
        loaded={loaded}
        error={error}
        onRetry={() => void refresh()}
        subject="Organizations"
        object="organization"
        loadingLabel="Loading organization"
        notFound={organizationNotFound(id)}
      >
        {organization && <OrganizationConfigurationDetails organization={organization} variant="details" />}
      </PageStateSection>
      {deleteModal}
    </>
  );
};

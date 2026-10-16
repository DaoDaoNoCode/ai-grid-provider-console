import { Fragment } from 'react';
import { PageSection } from '@patternfly/react-core';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import type { ConsoleService } from './api/ConsoleService';
import { NotFoundPage } from './components/NotFoundPage';
import { NotYetPortedPage } from './components/NotYetPortedPage';
import { MaaSGovernanceProvider } from './context/MaaSGovernanceContext';
import { ClustersPage } from './pages/ClustersPage';
import { ModelWizard } from './pages/models/ModelWizard';
import { ModelsPage } from './pages/models/ModelsPage';
import { OrganizationDetailsPage } from './pages/organizations/OrganizationDetailsPage';
import { OrganizationListPage } from './pages/organizations/OrganizationListPage';
import { OrganizationWizardPage } from './pages/organizations/OrganizationWizardPage';
import { CreateSubscriptionPage } from './pages/subscriptions/CreateSubscriptionPage';
import { EditSubscriptionPage } from './pages/subscriptions/EditSubscriptionPage';
import { SubscriptionsPage } from './pages/subscriptions/SubscriptionsPage';
import { ViewSubscriptionPage } from './pages/subscriptions/ViewSubscriptionPage';

type Props = { service: ConsoleService };

/** Mounts its page afresh for each record, so another :id loads that record and resets its form. */
const ByParams: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Fragment key={Object.values(useParams()).join('/')}>{children}</Fragment>
);

// Ported from krisv/ai-grid-cloud-provider-poc src/app/App.tsx at 62319b8.
// Later tasks replace each NotYetPortedPage with its page.
export const AppRoutes: React.FC<Props> = ({ service }) => (
  <Routes>
    <Route path="/" element={<Navigate to="/clusters" replace />} />
    <Route path="/ai-grid" element={<NotYetPortedPage title="AI Grid" />} />
    <Route path="/monitoring" element={<NotYetPortedPage title="Monitoring" />} />
    <Route
      path="/clusters"
      element={
        <PageSection>
          <ClustersPage service={service} />
        </PageSection>
      }
    />
    <Route
      path="/organizations"
      element={
        <PageSection>
          <OrganizationListPage service={service} />
        </PageSection>
      }
    />
    <Route
      path="/organizations/create"
      element={
        <PageSection>
          <OrganizationWizardPage service={service} />
        </PageSection>
      }
    />
    <Route
      path="/organizations/:id"
      element={
        <PageSection>
          <ByParams>
            <OrganizationDetailsPage service={service} />
          </ByParams>
        </PageSection>
      }
    />
    <Route
      path="/organizations/:id/edit"
      element={
        <PageSection>
          <ByParams>
            <OrganizationWizardPage service={service} />
          </ByParams>
        </PageSection>
      }
    />
    <Route
      path="/models"
      element={
        <PageSection>
          <ModelsPage service={service} />
        </PageSection>
      }
    />
    <Route
      path="/models/deploy"
      element={
        <PageSection>
          <ModelWizard service={service} />
        </PageSection>
      }
    />
    {/* The subscription pages share the PoC's governance context, and only they use it (A25). */}
    <Route
      element={
        <MaaSGovernanceProvider service={service}>
          <Outlet />
        </MaaSGovernanceProvider>
      }
    >
      <Route path="/subscriptions" element={<SubscriptionsPage service={service} />} />
      <Route path="/subscriptions/create" element={<CreateSubscriptionPage service={service} />} />
      <Route
        path="/subscriptions/view/:subscriptionName"
        element={
          <ByParams>
            <ViewSubscriptionPage service={service} />
          </ByParams>
        }
      />
      <Route
        path="/subscriptions/edit/:subscriptionName"
        element={
          <ByParams>
            <EditSubscriptionPage service={service} />
          </ByParams>
        }
      />
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
);

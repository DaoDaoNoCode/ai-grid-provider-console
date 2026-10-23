import { Suspense, lazy } from 'react';
import {
  Alert,
  AlertActionLink,
  EmptyState,
  EmptyStateBody,
  PageSection,
  Stack,
  Tab,
  TabTitleText,
  Tabs,
} from '@patternfly/react-core';
import { useSearchParams } from 'react-router-dom';
import type { ConsoleService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import { dashboardKey, dashboardTitle, monitoringTabs } from '../../api/monitoring';
import type { ConsoleConfig } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { PageLoading } from '../../components/PageLoading';
import { useServiceData } from '../../hooks/useServiceData';
import { GridPage } from '../grid/GridPage';

const PersesDashboardView = lazy(() => import('./PersesDashboardView'));

type Props = { service: ConsoleService };

const failureOf = (error: Error) => {
  if (error instanceof ServiceError && error.status === 403) {
    return { title: "You can't read these dashboards", body: error.message };
  }
  return { title: 'Dashboards could not be loaded', body: error.message };
};

/**
 * The hub's Perses dashboards as tabs, when the BFF relays to a Perses (docs/plan/bff-api.md, "The
 * Perses relay"): one tab per `dashboard-*` PersesDashboard in the configured project, selected
 * with `?dashboard=`. The monitoring team writes the dashboards; the console only shows them.
 */
const PersesMonitoring: React.FC<{ service: ConsoleService; project: string }> = ({ service, project }) => {
  const [dashboards, loaded, error, refresh] = useServiceData(() => service.listMonitoringDashboards(project), [], 0);
  const [params, setParams] = useSearchParams();
  const tabs = monitoringTabs(dashboards);
  const asked = params.get('dashboard');
  const selected = tabs.find((d) => dashboardKey(d, project) === asked) ?? tabs[0];
  const where = project ? `project ${project}` : 'any project you can read';

  const body = () => {
    if (error) {
      const { title, body } = failureOf(error);
      return (
        <Alert
          isInline
          variant="danger"
          title={title}
          actionLinks={<AlertActionLink onClick={() => void refresh()}>Retry</AlertActionLink>}
        >
          {body}
        </Alert>
      );
    }
    if (!selected) {
      return (
        <EmptyState titleText="No dashboards yet" headingLevel="h2">
          <EmptyStateBody>
            Monitoring shows the Perses dashboards in {where} whose names start with <code>dashboard-</code>. The hub
            has none yet.
          </EmptyStateBody>
        </EmptyState>
      );
    }
    return (
      <Stack hasGutter>
        <Tabs
          activeKey={dashboardKey(selected, project)}
          // A new tab starts from its own time range and variables: Perses's query parameters go.
          onSelect={(_event, key) => setParams({ dashboard: String(key) })}
          aria-label="Dashboards"
          data-testid="monitoring-tabs"
        >
          {tabs.map((d) => (
            <Tab
              key={dashboardKey(d, project)}
              eventKey={dashboardKey(d, project)}
              title={<TabTitleText>{dashboardTitle(d)}</TabTitleText>}
            />
          ))}
        </Tabs>
        <Suspense fallback={<PageLoading label="Loading dashboard" />}>
          <PersesDashboardView key={dashboardKey(selected, project)} dashboard={selected} />
        </Suspense>
      </Stack>
    );
  };

  return (
    <>
      <PageHeader title="Monitoring" description="Dashboards from the hub's Perses, across the AI Grid clusters." />
      {!loaded ? <PageLoading label="Loading dashboards" /> : <PageSection isFilled>{body()}</PageSection>}
    </>
  );
};

/** /monitoring: the hub's Perses dashboards when the BFF relays to a Perses, else the AI Grid overview's metrics. */
export const MonitoringPage: React.FC<Props> = ({ service }) => {
  const [config, loaded, error, refresh] = useServiceData<ConsoleConfig | undefined>(
    () => service.getConfig(),
    undefined,
    0,
  );
  if (!loaded && !error) {
    return <PageLoading label="Loading monitoring" />;
  }
  // Without the configuration the page can't tell whether the console has a Perses: say so rather
  // than fall back to the overview's metrics.
  if (!config) {
    return (
      <>
        <PageHeader title="Monitoring" />
        <PageSection isFilled>
          <Alert
            isInline
            variant="danger"
            title="Monitoring could not be loaded"
            actionLinks={<AlertActionLink onClick={() => void refresh()}>Retry</AlertActionLink>}
          >
            {error?.message}
          </Alert>
        </PageSection>
      </>
    );
  }
  if (config.monitoring.enabled) {
    return <PersesMonitoring service={service} project={config.monitoring.persesProject} />;
  }
  return <GridPage key="monitoring" service={service} monitoring />;
};

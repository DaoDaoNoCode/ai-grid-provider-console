import type { DashboardResource } from '@perses-dev/client';

/** Where the BFF relays the hub's Perses API (bff/internal/perses, docs/plan/bff-api.md "The Perses relay"). */
export const PERSES_API = '/perses/api';

/** The Monitoring page: the hub's Perses dashboards, read through the BFF's relay. */
export interface MonitoringService {
  /**
   * The Perses dashboards in `project`, or in every project the caller may read when it's empty,
   * as Perses returns them.
   */
  listMonitoringDashboards(project: string): Promise<DashboardResource[]>;
}

/** The dashboards the Monitoring page shows as tabs: the `dashboard-*` ones, ordered by name. */
export const monitoringTabs = (dashboards: DashboardResource[]): DashboardResource[] =>
  dashboards
    .filter((d) => d.metadata.name.startsWith('dashboard-'))
    .sort((a, b) =>
      a.metadata.name === b.metadata.name
        ? a.metadata.project.localeCompare(b.metadata.project)
        : a.metadata.name.localeCompare(b.metadata.name),
    );

/** A dashboard's tab title: its display name, or its name. */
export const dashboardTitle = (d: DashboardResource): string => d.spec.display?.name || d.metadata.name;

/** The `?dashboard=` value that selects a tab: the name, with the project when it isn't the configured one. */
export const dashboardKey = (d: DashboardResource, project: string): string =>
  project ? d.metadata.name : `${d.metadata.project}/${d.metadata.name}`;

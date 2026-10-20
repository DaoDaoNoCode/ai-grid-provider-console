// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/grid/GridPage.tsx at 62319b8: the map at
// /ai-grid and, with `monitoring`, the dashboards at /monitoring. The PoC's loading, error, and refresh
// state becomes useServiceData, and a failed load is a LoadError. A backend without Grid/GetOverview
// still has its AI Grid clusters in the Clusters list, so the map and the availability panel use those.
import { useEffect, useState } from 'react';
import { Alert, Flex, PageSection, Spinner, ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';
import { Link } from 'react-router-dom';
import type { ConsoleService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import type { ClustersService } from '../../api/clusters';
import type { GridService } from '../../api/grid';
import type { ModelsService } from '../../api/models';
import type { OrganizationsService } from '../../api/organizations';
import type { GridOverview, GridRange, ManagedModel, Organization } from '../../api/types';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { RefreshButton } from '../../components/RefreshButton';
import { RelativeTime } from '../../components/RelativeTime';
import { useServiceData } from '../../hooks/useServiceData';
import { GridFleetView } from './GridFleetView';
import { ObservabilityPanel } from './ObservabilityPanel';
import { tileLayerConfig } from './tiles';

type Props = {
  service: GridService &
    ModelsService &
    Pick<ClustersService, 'listClusters'> &
    Pick<OrganizationsService, 'listOrganizations'> &
    Pick<ConsoleService, 'getConfig'>;
  monitoring?: boolean;
};

/** An overview, and whether the backend served it or the page built it from the Clusters list. */
type Inventory = { overview: GridOverview; served: boolean };

/**
 * The backend's overview, or, when it doesn't serve Grid/GetOverview yet (501), the AI Grid members
 * from the Clusters list with no metrics: the overview's clusters are exactly those members.
 */
const overviewOrClusters = async (
  service: GridService & Pick<ClustersService, 'listClusters'>,
  ...args: Parameters<GridService['getGridOverview']>
): Promise<Inventory> => {
  try {
    return { overview: await service.getGridOverview(...args), served: true };
  } catch (err) {
    if (!(err instanceof ServiceError && err.isNotImplemented)) throw err;
    const clusters = (await service.listClusters()).filter((c) => c.aiGridEnabled);
    return { overview: { demo: false, clusters, metrics: [] }, served: false };
  }
};

const modelsErrorOf = (err: Error) =>
  err instanceof ServiceError && err.isNotImplemented ? 'Models are not available on this backend yet.' : err.message;

const organizationsErrorOf = (err: Error) =>
  err instanceof ServiceError && err.isNotImplemented
    ? 'Organizations are not available on this backend yet.'
    : 'Unable to load organization identities.';

const ranges: GridRange[] = ['1h', '6h', '24h'];

export const GridPage: React.FC<Props> = ({ service, monitoring = false }) => {
  // On /monitoring the metrics answer below carries the clusters too, so only the map asks for them alone.
  const [inventory, inventoryLoaded, inventoryError, refreshOverview] = useServiceData<Inventory | undefined>(
    () => (monitoring ? Promise.resolve(undefined) : overviewOrClusters(service, '1h', { includeMetrics: false })),
    undefined,
  );
  const [models, , modelsLoadError, refreshModels] = useServiceData<ManagedModel[]>(() => service.listModels(), []);
  const [config, , configError] = useServiceData(() => service.getConfig(), undefined, 0);
  const [organizations, , organizationsLoadError, refreshOrganizations] = useServiceData<Organization[]>(
    () => (monitoring ? service.listOrganizations() : Promise.resolve([])),
    [],
  );
  const [range, setRange] = useState<GridRange>('1h');
  // Each metrics response carries the range it was asked for, so a slow answer for an earlier
  // range is never shown as the current one.
  const [metricsData, metricsLoaded, metricsLoadError, refreshMetrics] = useServiceData<
    (Inventory & { range: GridRange }) | undefined
  >(
    () =>
      monitoring
        ? overviewOrClusters(service, range).then((answer) => ({ ...answer, range }))
        : Promise.resolve(undefined),
    undefined,
  );
  const metricsCurrent = metricsData?.range === range;
  const answer = monitoring ? metricsData : inventory;
  const data = answer?.overview;
  // Built from the Clusters list: there are no per-site models or metrics to show.
  const overviewServed = answer?.served !== false;
  const loaded = monitoring ? metricsLoaded : inventoryLoaded;
  // A failed range keeps the last answer's clusters; the panel shows the metrics error.
  const error = monitoring ? (data ? undefined : metricsLoadError) : inventoryError;
  // A new range, or a late answer for an old one, asks again for the current range.
  useEffect(() => {
    if (monitoring && metricsLoaded && !metricsCurrent) {
      void refreshMetrics();
    }
  }, [monitoring, range, metricsData, metricsLoaded, metricsCurrent, refreshMetrics]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refreshOverview(),
      refreshModels(),
      ...(monitoring ? [refreshOrganizations(), refreshMetrics()] : []),
    ]);
    setRefreshing(false);
  };

  // Until the config loads there is no basemap; if it can't be read, the map says tiles are unavailable. An empty tile URL draws the bundled land outline.
  const tiles = config ? tileLayerConfig(config) : configError ? null : undefined;
  const modelsError = modelsLoadError && modelsErrorOf(modelsLoadError);

  const metricsSource = metricsData?.overview.metricsSource;

  // One toolbar row: the time range (Monitoring), when the data was read, refresh, and the other view.
  const toolbar = (
    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
      {monitoring && (
        <ToggleGroup aria-label="Time range" isCompact>
          {ranges.map((r) => (
            <ToggleGroupItem
              key={r}
              text={`Last ${r}`}
              buttonId={`obs-range-${r}`}
              isSelected={range === r}
              onChange={() => setRange(r)}
            />
          ))}
        </ToggleGroup>
      )}
      {data?.updatedAt && (
        <span className="grid-updated">
          Updated <RelativeTime time={data.updatedAt} />
        </span>
      )}
      <RefreshButton onRefresh={() => void refresh()} isRefreshing={!loaded || refreshing} />
      <Link to={monitoring ? '/ai-grid' : '/monitoring'}>{monitoring ? 'View AI Grid map' : 'View monitoring'}</Link>
    </Flex>
  );

  return (
    <>
      <PageHeader
        title={monitoring ? 'Monitoring' : 'AI Grid'}
        description={
          monitoring
            ? 'Cluster availability, gateway performance and resource use across AI Grid.'
            : 'Where the AI Grid clusters are, and which models they serve.'
        }
        headerAction={toolbar}
      />
      <PageSection isFilled>
        {error && <LoadError subject="AI Grid clusters" error={error} />}
        {!loaded && <Spinner aria-label="Loading AI Grid" />}
        {data && (
          <>
            {data.demo && (
              <Alert isInline variant="info" title="Demo data">
                {monitoring
                  ? 'Inventory and metrics on this page are simulated.'
                  : 'Inventory on this page is simulated.'}
              </Alert>
            )}
            {monitoring && !data.demo && metricsSource === 'demo' && (
              <Alert isInline variant="info" title="Simulated monitoring metrics">
                Thanos is not configured. Charts show generated demo data; cluster inventory comes from the configured
                backend.
              </Alert>
            )}
            {!overviewServed && (
              <Alert isInline variant="info" title="Showing clusters from the Clusters list">
                {monitoring
                  ? 'This backend doesn’t serve the AI Grid overview yet, so cluster availability comes from the Clusters list and there are no metrics to chart.'
                  : 'This backend doesn’t serve the AI Grid overview yet, so the map shows the AI Grid clusters from the Clusters list.'}
              </Alert>
            )}
            {!monitoring && (
              <GridFleetView clusters={data.clusters} models={models} modelsError={modelsError} tiles={tiles} />
            )}
            {monitoring && (
              <ObservabilityPanel
                clusters={data.clusters}
                models={models}
                modelsError={modelsError}
                organizations={organizations}
                organizationsError={organizationsLoadError && organizationsErrorOf(organizationsLoadError)}
                metrics={metricsCurrent ? metricsData.overview.metrics : []}
                loading={!metricsLoaded || (!metricsCurrent && !metricsLoadError)}
                error={metricsLoadError && 'Unable to load metrics for this selection. Please retry.'}
                metricsServed={overviewServed}
                simulated={metricsSource === 'demo'}
                range={range}
              />
            )}
          </>
        )}
      </PageSection>
    </>
  );
};

// Layout adapted from the reference VisionModelFleetPage.
// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/grid/GridFleetView.tsx at 62319b8.
// The console makes each card one control (no links nested in it), drops the map's status chips
// (the legend and the cards already show status), moves the summary above the map, and lays the
// drawer details out as the other pages do.
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerHead,
  DrawerPanelBody,
  DrawerPanelContent,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Flex,
  FlexItem,
  Grid,
  Label,
  SearchInput,
  Stack,
  Title,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import { AngleLeftIcon, SearchIcon } from '@patternfly/react-icons';
import { Link, useSearchParams } from 'react-router-dom';
import type { GridCluster, ManagedModel } from '../../api/types';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { StatCard } from '../../components/StatCard';
import { StatusLabel } from '../../components/StatusLabel';
import { SubtleText } from '../../components/SubtleText';
import { modelKey } from '../../utilities/authpolicies';
import { modelPath } from '../models/modelUtils';
import { GridFleetMap } from './GridFleetMap';
import type { TileLayerConfig } from './tiles';
import './grid-fleet.css';

/** A cluster by its name, or a model by its modelKey. */
type Selection = { kind: 'cluster' | 'model'; name: string };

type Props = {
  clusters: GridCluster[];
  models: ManagedModel[];
  modelsError?: string;
  tiles: TileLayerConfig | null | undefined;
};

const matches = (model: ManagedModel, cluster: GridCluster) =>
  Boolean(cluster.location && model.locations.includes(cluster.location));

const displayName = (model: ManagedModel) => model.displayName ?? model.name;

const siteOf = (cluster: GridCluster) => cluster.siteName ?? cluster.site ?? cluster.name;

const hasCoordinates = (c: GridCluster) => c.latitude !== undefined && c.longitude !== undefined;

/** The availability filter: All, then each cluster status by the word the labels use. */
const availabilityFilters: GridCluster['status'][] = ['Ready', 'Offline', 'Unknown'];

/** A link can open the drawer on a cluster (?cluster=<name>) or a model (?model=<namespace/name>). */
const selectionFrom = (params: URLSearchParams): Selection | null => {
  const cluster = params.get('cluster');
  const model = params.get('model');
  return cluster ? { kind: 'cluster', name: cluster } : model ? { kind: 'model', name: model } : null;
};

/** The drawer's details are narrower than a page's, so their terms are too. */
const DRAWER_TERM_WIDTH = '9rem';

/** A card in the drawer's list: one control that opens the item, with its status beside the name. */
const FleetCard: React.FC<{
  id: string;
  title: string;
  status: string;
  actionLabel: string;
  onOpen: () => void;
  children: React.ReactNode;
}> = ({ id, title, status, actionLabel, onOpen, children }) => (
  <Card isClickable isCompact id={`fleet-card-${id}`}>
    <CardHeader
      selectableActions={{
        onClickAction: onOpen,
        selectableActionId: `fleet-card-action-${id}`,
        selectableActionAriaLabel: actionLabel,
      }}
    >
      {/* In the title, not in actions: PatternFly's clickable-only cards may not carry actions. */}
      <CardTitle>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsFlexStart' }}
          flexWrap={{ default: 'nowrap' }}
          spaceItems={{ default: 'spaceItemsSm' }}
        >
          <span className="pf-v6-u-text-break-word">{title}</span>
          <StatusLabel isCompact status={status} />
        </Flex>
      </CardTitle>
    </CardHeader>
    <CardBody>
      <Stack>{children}</Stack>
    </CardBody>
  </Card>
);

export const GridFleetView: React.FC<Props> = ({ clusters, models, modelsError, tiles }) => {
  const [params, setParams] = useSearchParams();
  // The URL is the drawer's state: a link or a reload opens the same thing, closing it clears the
  // URL, and navigating to plain /ai-grid (the nav link) closes it.
  const selection = selectionFrom(params);
  const setSelection = (next: Selection | null) => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.delete('cluster');
        updated.delete('model');
        if (next) updated.set(next.kind, next.name);
        return updated;
      },
      { replace: true },
    );
  };
  // The Back trail belongs to the selection it was built for. When the URL moves the drawer some
  // other way (browser back, a link, the nav), the trail no longer applies and reads as empty.
  const [trail, setTrail] = useState<{ at: string | null; items: Selection[] }>({ at: null, items: [] });
  const keyOf = (s: Selection | null) => (s ? `${s.kind}:${s.name}` : null);
  const history = trail.at === keyOf(selection) ? trail.items : [];
  const [mode, setMode] = useState<'cluster' | 'model'>(() => selectionFrom(params)?.kind ?? 'cluster');
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('all');

  const selectedCluster = selection?.kind === 'cluster' ? clusters.find((c) => c.name === selection.name) : undefined;
  const selectedModel = selection?.kind === 'model' ? models.find((m) => modelKey(m) === selection.name) : undefined;
  const relevantModels = models.filter((m) => m.locations.length === 0 || clusters.some((c) => matches(m, c)));
  const modelsAt = (cluster: GridCluster) => models.filter((m) => matches(m, cluster));
  const clustersOf = (model: ManagedModel) => clusters.filter((c) => matches(model, c));
  const query = search.toLowerCase();
  const visibleClusters = clusters.filter(
    (c) =>
      (availability === 'all' || c.status === availability) &&
      `${c.name} ${c.site ?? ''} ${c.siteName ?? ''} ${modelsAt(c).map(displayName).join(' ')}`
        .toLowerCase()
        .includes(query),
  );
  const visibleModels = relevantModels.filter((m) =>
    `${m.name} ${displayName(m)} ${m.modelName ?? ''} ${clustersOf(m).map(siteOf).join(' ')}`
      .toLowerCase()
      .includes(query),
  );
  const isFiltered = search !== '' || (mode === 'cluster' && availability !== 'all');
  const clearFilters = () => {
    setSearch('');
    setAvailability('all');
  };

  const open = (next: Selection) => {
    setTrail({ at: keyOf(next), items: selection ? [...history, selection] : [] });
    setSelection(next);
  };
  const reset = () => {
    setSelection(null);
    setTrail({ at: null, items: [] });
  };
  const back = () => {
    const previous = history.at(-1) ?? null;
    setTrail({ at: keyOf(previous), items: history.slice(0, -1) });
    setSelection(previous);
  };

  const mapClusters = selectedModel
    ? clustersOf(selectedModel)
    : mode === 'cluster'
      ? visibleClusters
      : clusters.filter((c) => visibleModels.some((m) => matches(m, c)));

  const clusterLinks = (model: ManagedModel) => {
    const targets = clustersOf(model);
    return targets.length ? (
      <Flex
        direction={{ default: 'column' }}
        alignItems={{ default: 'alignItemsFlexStart' }}
        spaceItems={{ default: 'spaceItemsSm' }}
      >
        {targets.map((c) => (
          <Button key={c.name} variant="link" isInline onClick={() => open({ kind: 'cluster', name: c.name })}>
            {siteOf(c)} · {c.name}
          </Button>
        ))}
      </Flex>
    ) : (
      <SubtleText>{model.locations.length ? 'No AI Grid cluster at its locations.' : 'No locations yet.'}</SubtleText>
    );
  };

  const modelLinks = (cluster: GridCluster) => {
    const assigned = modelsAt(cluster);
    return assigned.length ? (
      <Flex
        direction={{ default: 'column' }}
        alignItems={{ default: 'alignItemsFlexStart' }}
        spaceItems={{ default: 'spaceItemsSm' }}
      >
        {assigned.map((m) => (
          <Button key={modelKey(m)} variant="link" isInline onClick={() => open({ kind: 'model', name: modelKey(m) })}>
            {displayName(m)}
          </Button>
        ))}
      </Flex>
    ) : (
      <SubtleText>{modelsError ? 'Model assignments unavailable.' : 'No models at this location.'}</SubtleText>
    );
  };

  const objects = mode === 'cluster' ? 'clusters' : 'models';

  // The same header for a cluster and a model: back, the name with its status, and what it is.
  const head =
    selection && (selectedCluster || selectedModel) ? (
      <Stack hasGutter>
        <div>
          <Button variant="link" isInline icon={<AngleLeftIcon />} onClick={back}>
            {history.length ? 'Back' : mode === 'cluster' ? 'Clusters' : 'Models'}
          </Button>
        </div>
        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
          <Title headingLevel="h2" size="lg" className="pf-v6-u-text-break-word">
            {selectedCluster?.name ?? (selectedModel && displayName(selectedModel))}
          </Title>
          <StatusLabel isCompact status={selectedCluster?.status ?? selectedModel?.phase ?? 'Pending'} />
        </Flex>
        <SubtleText>
          {selectedCluster ? siteOf(selectedCluster) : (selectedModel?.modelName ?? selectedModel?.name)}
        </SubtleText>
      </Stack>
    ) : (
      <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
        <FlexItem grow={{ default: 'grow' }}>
          <SearchInput
            aria-label={`Search grid ${objects}`}
            placeholder={`Search ${objects}`}
            value={search}
            onChange={(_, value) => setSearch(value)}
            onClear={() => setSearch('')}
          />
        </FlexItem>
        <ToggleGroup aria-label="Grid object type" isCompact>
          {(['cluster', 'model'] as const).map((value) => (
            <ToggleGroupItem
              key={value}
              text={value === 'cluster' ? 'Clusters' : 'Models'}
              buttonId={`grid-type-${value}`}
              isSelected={mode === value}
              onChange={() => {
                setMode(value);
                setSearch('');
                reset();
              }}
            />
          ))}
        </ToggleGroup>
      </Flex>
    );

  const clusterDetails = (cluster: GridCluster) => (
    <Stack hasGutter>
      <DetailsSection title="Site and cluster" headingLevel="h3">
        <DetailsList
          termWidth={DRAWER_TERM_WIDTH}
          aria-label="Site and cluster"
          items={[
            { term: 'Site', value: cluster.siteName ?? cluster.site },
            { term: 'Site identifier', value: cluster.site },
            { term: 'Region', value: cluster.region },
            { term: 'Location', value: cluster.location },
            {
              term: 'Coordinates',
              value: hasCoordinates(cluster) ? `${cluster.latitude}, ${cluster.longitude}` : undefined,
            },
            { term: 'Provisioning', value: <StatusLabel isCompact status={cluster.provisioningStatus} /> },
          ]}
        />
      </DetailsSection>
      <DetailsSection
        title="Models at this location"
        headingLevel="h3"
        count={modelsAt(cluster).length}
        help="The models whose placement chose this cluster's location. A model listed here may still be starting."
      >
        {modelLinks(cluster)}
      </DetailsSection>
      <Link to="/clusters">View in Clusters</Link>
    </Stack>
  );

  const modelDetails = (model: ManagedModel) => (
    <Stack hasGutter>
      <DetailsSection title="Model configuration" headingLevel="h3">
        <DetailsList
          termWidth={DRAWER_TERM_WIDTH}
          aria-label="Model configuration"
          items={[
            { term: 'Resource name', value: model.name },
            { term: 'Model', value: model.modelName ?? model.modelRef.name },
            { term: 'Replicas', value: model.replicas },
            { term: 'Model URI', value: model.modelUri },
            { term: 'Runtime image', value: model.runtimeImage },
          ]}
        />
      </DetailsSection>
      <DetailsSection
        title="Sites and clusters"
        headingLevel="h3"
        count={clustersOf(model).length}
        help="The AI Grid clusters at the locations this model's placement chose. They are where it should run, not proof that it is serving there."
      >
        {clusterLinks(model)}
      </DetailsSection>
      <Link to={modelPath(model)}>View model</Link>
    </Stack>
  );

  const noResults = (
    <EmptyState variant="xs" titleText={`No ${objects} match`} headingLevel="h3" icon={SearchIcon}>
      <EmptyStateBody>Change the search or the filter to see more.</EmptyStateBody>
      <EmptyStateFooter>
        <EmptyStateActions>
          <Button variant="link" onClick={clearFilters}>
            Clear all filters
          </Button>
        </EmptyStateActions>
      </EmptyStateFooter>
    </EmptyState>
  );

  const withoutCoordinates = clusters.filter((c) => !hasCoordinates(c)).length;

  const list = (
    <Stack hasGutter>
      <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
        <Title headingLevel="h2" size="md">
          {mode === 'cluster' ? 'Clusters' : 'Models'}
        </Title>
        <Label isCompact>{mode === 'cluster' ? visibleClusters.length : visibleModels.length}</Label>
      </Flex>
      {mode === 'cluster' && (
        <ToggleGroup aria-label="Filter cluster availability" isCompact>
          {['all', ...availabilityFilters].map((value) => (
            <ToggleGroupItem
              key={value}
              text={value === 'all' ? 'All' : value}
              buttonId={`availability-${value}`}
              isSelected={availability === value}
              onChange={() => setAvailability(value)}
            />
          ))}
        </ToggleGroup>
      )}
      {(mode === 'cluster' ? visibleClusters.length : visibleModels.length) === 0 && noResults}
      <Stack hasGutter>
        {mode === 'cluster'
          ? visibleClusters.map((c) => {
              const at = modelsAt(c);
              return (
                <FleetCard
                  key={c.name}
                  id={c.name}
                  title={c.name}
                  status={c.status}
                  actionLabel={`View ${c.name} details`}
                  onOpen={() => open({ kind: 'cluster', name: c.name })}
                >
                  <span>{[siteOf(c), c.location].filter(Boolean).join(' · ')}</span>
                  <SubtleText>{at.length ? `Models: ${at.map(displayName).join(', ')}` : 'No models'}</SubtleText>
                </FleetCard>
              );
            })
          : visibleModels.map((m) => {
              const sites = clustersOf(m).map(siteOf);
              return (
                <FleetCard
                  key={modelKey(m)}
                  id={modelKey(m).replace(/\W/g, '-')}
                  title={displayName(m)}
                  status={m.phase ?? 'Pending'}
                  actionLabel={`View ${displayName(m)} details`}
                  onOpen={() => open({ kind: 'model', name: modelKey(m) })}
                >
                  <span>{m.modelName ?? m.modelRef.name}</span>
                  <SubtleText>{sites.length ? `Sites: ${sites.join(', ')}` : 'No sites'}</SubtleText>
                </FleetCard>
              );
            })}
      </Stack>
      {mode === 'cluster' && withoutCoordinates > 0 && (
        <SubtleText>
          {withoutCoordinates} {withoutCoordinates === 1 ? 'cluster has' : 'clusters have'} no site coordinates, so{' '}
          {withoutCoordinates === 1 ? 'it is' : 'they are'} listed here but not on the map.
        </SubtleText>
      )}
    </Stack>
  );

  const panel = (
    <DrawerPanelContent widths={{ default: 'width_33' }} className="fleet-drawer">
      <DrawerHead>{head}</DrawerHead>
      <DrawerPanelBody>
        <Stack hasGutter>
          {modelsError && (
            <Alert isInline variant="warning" title="Models unavailable">
              {modelsError}
            </Alert>
          )}
          {selectedCluster ? clusterDetails(selectedCluster) : selectedModel ? modelDetails(selectedModel) : list}
        </Stack>
      </DrawerPanelBody>
    </DrawerPanelContent>
  );

  const ready = clusters.filter((c) => c.status === 'Ready').length;
  const summary: [label: string, value: string, detail?: string][] = [
    ['Clusters', `${ready}/${clusters.length}`, 'Ready'],
    ['Sites', String(new Set(clusters.flatMap((c) => (c.site ? [c.site] : []))).size)],
    ['Models', String(relevantModels.length)],
  ];

  return (
    <Stack hasGutter>
      <Grid hasGutter md={4} role="region" aria-label="Fleet summary">
        {summary.map(([label, value, detail]) => (
          <StatCard key={label} label={label} value={value} detail={detail} />
        ))}
      </Grid>
      <Card className="fleet-region" role="region" aria-label="AI Grid map and drawer">
        <Drawer isExpanded isInline isStatic>
          <DrawerContent panelContent={panel}>
            <DrawerContentBody>
              <div className="fleet-map-area">
                <GridFleetMap
                  clusters={mapClusters}
                  selected={selectedCluster?.name ?? null}
                  onSelect={(name) => open({ kind: 'cluster', name })}
                  tiles={tiles}
                  isFiltered={isFiltered && !selectedModel}
                />
              </div>
            </DrawerContentBody>
          </DrawerContent>
        </Drawer>
      </Card>
    </Stack>
  );
};

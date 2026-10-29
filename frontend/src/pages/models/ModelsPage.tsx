// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/models/ModelsPage.tsx at 62319b8.
// Adapted from packages/model-serving/src/components/deployments/DeploymentsTable.tsx
// and components/global/GlobalDeploymentsView.tsx.
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The UX team's "models per cluster" design (jgiardino/ai-grid-provider-console@ada68ad): a model
// row expands to its locations and each one's status; the Locations cell shows up to five compact
// labels.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Label, LabelGroup, ToolbarItem } from '@patternfly/react-core';
import { ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ThProps } from '@patternfly/react-table';
import type { ManagedModel } from '../../api/types';
import { RefreshButton } from '../../components/RefreshButton';
import { PaginatedTable } from '../../components/PaginatedTable';
import { RelativeTime } from '../../components/RelativeTime';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { EmptyListState } from '../../components/states/EmptyListState';
import { PageStateSection } from '../../components/states/PageStateSection';
import { ToolbarSearch } from '../../components/ToolbarSearch';
import { TableEmptyRow } from '../../components/TableEmptyRow';
import { useConsoleSession } from '../../context/useConsoleSession';
import { useServiceData } from '../../hooks/useServiceData';
import { EMPTY_VALUE } from '../../utilities/format';
import { locationLabel, modelPath, siteNamesOf } from './modelUtils';
import { ModelLocationsTable } from './ModelLocationsTable';
import { NotPlaced } from './NotPlaced';
import { ModelSelectedClusters } from './ModelSelectedClusters';
import { ModelStatusLabel } from './ModelStatus';
import type { ModelDeleteService } from './useDeleteModel';
import { useDeleteModel } from './useDeleteModel';
import { useClusterList } from '../clusters/useClusters';

type Props = { service: ModelDeleteService };

type Column = { label: string; isNumber?: boolean; sort: (a: ManagedModel, b: ManagedModel) => number };

const columns: Column[] = [
  { label: 'Name', sort: (a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name) },
  { label: 'Model', sort: (a, b) => (a.modelName ?? a.modelRef.name).localeCompare(b.modelName ?? b.modelRef.name) },
  { label: 'Replicas', isNumber: true, sort: (a, b) => (a.replicas ?? 0) - (b.replicas ?? 0) },
  { label: 'Locations', sort: (a, b) => a.locations.length - b.locations.length },
  { label: 'Created', sort: (a, b) => (a.creationTimestamp ?? '').localeCompare(b.creationTimestamp ?? '') },
  { label: 'Status', sort: (a, b) => (a.phase ?? '').localeCompare(b.phase ?? '') },
];

const keyOf = (model: ManagedModel) => `${model.namespace}/${model.name}`;

export const ModelsPage: React.FC<Props> = ({ service }) => {
  const navigate = useNavigate();
  const [deployments, loaded, error, refresh] = useServiceData<ManagedModel[]>(() => service.listModels(), []);
  const { data: clusters } = useClusterList();
  const { user } = useConsoleSession();
  const siteNames = useMemo(() => siteNamesOf(clusters), [clusters]);
  const canWrite = !!user?.isProviderAdmin;
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<{ index: number; direction: 'asc' | 'desc' }>({ index: 0, direction: 'asc' });
  // The models whose rows show their locations.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const setRowExpanded = (key: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  const [confirmDelete, deleteModal] = useDeleteModel(service, {
    refresh: () => void refresh(),
    onDeleted: () => {
      // Replace, so the notice doesn't add a second Models entry to the browser's history.
      void navigate('.', { replace: true, state: { notice: 'Model deployment deleted' } });
      void refresh();
    },
  });

  const rows = useMemo(() => {
    const term = filter.toLowerCase();
    const compare = columns[sortBy.index].sort;
    return deployments
      .filter((d) =>
        `${d.displayName ?? ''} ${d.name} ${d.modelName} ${d.locations.join(' ')}`.toLowerCase().includes(term),
      )
      .sort((a, b) => (sortBy.direction === 'asc' ? compare(a, b) : compare(b, a)));
  }, [deployments, filter, sortBy]);

  const deployButton = canWrite ? (
    <Button component={(props) => <Link {...props} to="/models/deploy" />}>Deploy model</Button>
  ) : null;

  const sortParams = (index: number): ThProps['sort'] => ({
    sortBy,
    onSort: (_event, i, direction) => setSortBy({ index: i, direction }),
    columnIndex: index,
  });

  const body = () => {
    if (deployments.length === 0) {
      return (
        <EmptyListState title="No models" action={deployButton}>
          Deploy a model to serve it on AI Grid clusters.
        </EmptyListState>
      );
    }
    return (
      <PaginatedTable
        rows={rows}
        toolbar={
          <>
            <ToolbarSearch
              label="Filter models"
              placeholder="Filter by name or location"
              value={filter}
              onChange={setFilter}
            />
            {deployButton && <ToolbarItem>{deployButton}</ToolbarItem>}
            <ToolbarItem>
              <RefreshButton onRefresh={() => void refresh()} />
            </ToolbarItem>
          </>
        }
      >
        {(pageRows) => (
          <Table aria-label="Model deployments" isExpandable data-testid="model-deployments-table">
            <Thead>
              <Tr>
                <Th screenReaderText="Show locations" />
                {columns.map((c, i) => (
                  <Th
                    key={c.label}
                    sort={sortParams(i)}
                    modifier="wrap"
                    className={c.isNumber ? 'console-number' : undefined}
                  >
                    {c.label}
                  </Th>
                ))}
                {canWrite && <Th screenReaderText="Actions" />}
              </Tr>
            </Thead>
            {rows.length === 0 ? (
              <Tbody>
                <TableEmptyRow
                  colSpan={columns.length + 1 + (canWrite ? 1 : 0)}
                  body="Change the filter to see more models."
                  onClear={() => setFilter('')}
                />
              </Tbody>
            ) : (
              pageRows.map((deployment, rowIndex) => {
                const title = deployment.displayName ?? deployment.name;
                const key = keyOf(deployment);
                const works = deployment.works ?? [];
                const isExpanded = expanded.has(key);
                return (
                  <Tbody key={key} isExpanded={isExpanded}>
                    <Tr isContentExpanded={isExpanded}>
                      {/* Every row expands: to each location's status, to the clusters its placement chose
                            when no status is reported (git mode), or to why it has none. */}
                      <Td
                        expand={{
                          rowIndex,
                          isExpanded,
                          onToggle: () => setRowExpanded(key, !isExpanded),
                          expandId: `model-locations-toggle-${deployment.name}`,
                        }}
                      />
                      <Td dataLabel="Name">
                        <Link to={modelPath(deployment)}>{title}</Link>
                      </Td>
                      <Td dataLabel="Model" modifier="breakWord">
                        {deployment.modelName ?? deployment.modelRef.name}
                      </Td>
                      <Td dataLabel="Replicas" className="console-number">
                        {deployment.replicas ?? EMPTY_VALUE}
                      </Td>
                      <Td dataLabel="Locations" data-testid={`model-locations-${deployment.name}`}>
                        {deployment.locations.length ? (
                          <LabelGroup numLabels={5}>
                            {deployment.locations.map((location) => (
                              <Label key={location} color="grey" isCompact>
                                {locationLabel(location, siteNames)}
                              </Label>
                            ))}
                          </LabelGroup>
                        ) : (
                          EMPTY_VALUE
                        )}
                      </Td>
                      <Td dataLabel="Created" modifier="nowrap">
                        <RelativeTime time={deployment.creationTimestamp} />
                      </Td>
                      <Td dataLabel="Status">
                        <ModelStatusLabel model={deployment} />
                      </Td>
                      {canWrite && (
                        <Td isActionCell>
                          <SimpleMenuActions
                            testId={`model-actions-${deployment.name}`}
                            ariaLabel={`Actions for ${title}`}
                            dropdownItems={[
                              { key: 'view', label: 'View details', onClick: () => navigate(modelPath(deployment)) },
                              {
                                key: 'edit',
                                label: 'Edit',
                                onClick: () => navigate(`${modelPath(deployment)}/edit`),
                              },
                              { isSpacer: true },
                              {
                                key: 'delete',
                                label: 'Delete',
                                isDanger: true,
                                onClick: () => confirmDelete(deployment),
                              },
                            ]}
                          />
                        </Td>
                      )}
                    </Tr>
                    <Tr isExpanded={isExpanded}>
                      <Td />
                      <Td colSpan={columns.length + (canWrite ? 1 : 0)}>
                        <ExpandableRowContent>
                          {isExpanded &&
                            (works.length > 0 ? (
                              <ModelLocationsTable
                                model={deployment}
                                works={works}
                                clusters={clusters}
                                siteNames={siteNames}
                                onEdit={canWrite ? () => navigate(`${modelPath(deployment)}/edit`) : undefined}
                                isNested
                              />
                            ) : deployment.selectedClusters.length > 0 ? (
                              <ModelSelectedClusters model={deployment} clusters={clusters} siteNames={siteNames} />
                            ) : (
                              <NotPlaced
                                model={deployment}
                                onEdit={canWrite ? () => navigate(`${modelPath(deployment)}/edit`) : undefined}
                              />
                            ))}
                        </ExpandableRowContent>
                      </Td>
                    </Tr>
                  </Tbody>
                );
              })
            )}
          </Table>
        )}
      </PaginatedTable>
    );
  };

  return (
    <>
      <PageStateSection
        title="Models"
        description="Add and remove model deployments."
        loaded={loaded}
        error={error}
        onRetry={() => void refresh()}
        subject="Models"
        loadingLabel="Loading models"
      >
        {body()}
      </PageStateSection>
      {deleteModal}
    </>
  );
};

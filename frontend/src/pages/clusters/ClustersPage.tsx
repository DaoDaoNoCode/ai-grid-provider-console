import { useMemo, useState } from 'react';
import {
  Alert,
  AlertActionLink,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Icon,
  PageSection,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ThProps } from '@patternfly/react-table';
import { Link, useNavigate } from 'react-router-dom';
import type { ClustersService, GridMembership } from '../../api/clusters';
import type { UserService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import type { GridCluster } from '../../api/types';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { PageLoading } from '../../components/PageLoading';
import { PaginatedTable } from '../../components/PaginatedTable';
import { RefreshButton } from '../../components/RefreshButton';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { StatusLabel } from '../../components/StatusLabel';
import { ToolbarSearch } from '../../components/ToolbarSearch';
import { TableEmptyRow } from '../../components/TableEmptyRow';
import { useServiceData } from '../../hooks/useServiceData';
import { EMPTY_VALUE } from '../../utilities/format';
import type { MembershipChange } from './MembershipModal';
import { MembershipModal } from './MembershipModal';

// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/clusters/ClustersPage.tsx at 62319b8.
// The PoC's columns, labels, and enroll flow, plus the console's Hub and OpenShift columns,
// removal from AI Grid, and a confirmation both ways. Site and Region are left out until clusters
// carry them (ai-grid/site and ai-grid/region; nothing sets them yet). The Connection tooltip
// adds the ACM state behind Unknown (such as Importing) and the backend's message, which the
// PoC's three states don't have.

type Props = { service: ClustersService & UserService };

// A wide column shows from the 2xl breakpoint (1450 px) up; below it the table fits the
// content area without clipping the Action column.
type Column = { label: string; sort?: (a: GridCluster, b: GridCluster) => number; wide?: boolean };

const columns: Column[] = [
  { label: 'Cluster', sort: (a, b) => a.name.localeCompare(b.name) },
  { label: 'Location', sort: (a, b) => (a.location ?? '').localeCompare(b.location ?? '') },
  { label: 'Connection', sort: (a, b) => a.status.localeCompare(b.status) },
  { label: 'AI Grid', sort: (a, b) => membership(a).localeCompare(membership(b)) },
  { label: 'Hub', wide: true },
  { label: 'OpenShift' },
];

const wideOnly: ThProps['visibility'] = ['hidden', 'visibleOn2Xl'];

/** A member's provisioning, or nothing for a cluster outside AI Grid (sorts first). */
const membership = (c: GridCluster) => (c.aiGridEnabled ? c.provisioningStatus : '');

/** The Connection tooltip: the ACM state behind Unknown, then the backend's message. */
const statusReason = (c: GridCluster) => [c.state, c.statusMessage].filter(Boolean).join(': ') || undefined;

/** Why a cluster can't be added: the hub hasn't finished importing it (or is detaching it). */
const cannotAddReason = (c: GridCluster) =>
  c.state ? `The hub can add this cluster to AI Grid once it has imported it (now: ${c.state}).` : undefined;

export const ClustersPage: React.FC<Props> = ({ service }) => {
  const navigate = useNavigate();
  const [clusters, loaded, error, refresh] = useServiceData<GridCluster[]>(() => service.listClusters(), []);
  const [user] = useServiceData(() => service.getUser(), undefined, 0);
  const isProviderAdmin = !!user?.isProviderAdmin;
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<{ index: number; direction: 'asc' | 'desc' }>({ index: 0, direction: 'asc' });
  const [change, setChange] = useState<MembershipChange>();
  // Membership the backend confirmed, shown until the next list arrives (it applies only to
  // the list it was confirmed against).
  const [confirmed, setConfirmed] = useState<{ list: GridCluster[]; members: Map<string, boolean> }>();
  const overrides = confirmed?.list === clusters ? confirmed.members : undefined;

  const rows = useMemo(() => {
    const term = search.toLowerCase();
    const compare = columns[sortBy.index].sort!;
    return clusters
      .map((c) => (overrides?.has(c.name) ? { ...c, aiGridEnabled: overrides.get(c.name)! } : c))
      .filter((c) => c.name.toLowerCase().includes(term))
      .sort((a, b) => (sortBy.direction === 'asc' ? compare(a, b) : compare(b, a)));
  }, [clusters, overrides, search, sortBy]);

  const reload = () => {
    setConfirmed(undefined);
    void refresh();
  };

  /** Adds the cluster to AI Grid or removes it; throws for the modal to show. */
  const applyChange = async ({ cluster, join }: MembershipChange, membership?: GridMembership) => {
    const updated = membership
      ? await service.enrollCluster(cluster, membership)
      : await service.removeClusterFromGrid(cluster);
    if (updated.aiGridEnabled !== join) {
      throw new Error('The Hub did not confirm the change. Refresh and try again.');
    }
    setConfirmed({ list: clusters, members: new Map(overrides).set(updated.name, join) });
    setChange(undefined);
    navigate('.', { state: { notice: `${updated.name} ${join ? 'added to' : 'removed from'} AI Grid` } });
    void refresh();
  };

  const sortParams = (index: number): ThProps['sort'] =>
    columns[index].sort
      ? {
          sortBy,
          onSort: (_event, i, direction) => setSortBy({ index: i, direction }),
          columnIndex: index,
        }
      : undefined;

  const body = () => {
    if (error) {
      if (error instanceof ServiceError && error.isNotImplemented) {
        return <LoadError subject="Clusters" error={error} />;
      }
      return (
        <Alert
          isInline
          variant="danger"
          title="Error loading clusters"
          actionLinks={<AlertActionLink onClick={reload}>Retry</AlertActionLink>}
        >
          {error.message}
        </Alert>
      );
    }
    if (clusters.length === 0) {
      return (
        <EmptyState titleText="No managed clusters" headingLevel="h3">
          <EmptyStateBody>No ManagedClusters are available.</EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="link" onClick={reload}>
                Refresh
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      );
    }
    return (
      <>
        <PaginatedTable
          rows={rows}
          toolbar={
            <>
              <ToolbarSearch
                label="Search clusters"
                placeholder="Search clusters by name"
                value={search}
                onChange={setSearch}
              />
              <ToolbarItem>
                <RefreshButton onRefresh={reload} />
              </ToolbarItem>
            </>
          }
        >
          {(pageRows) => (
            <Table aria-label="AI Grid clusters" data-testid="clusters-table">
              <Thead>
                <Tr>
                  {columns.map((c, i) => (
                    <Th key={c.label} sort={sortParams(i)} modifier="wrap" visibility={c.wide ? wideOnly : undefined}>
                      {c.label}
                    </Th>
                  ))}
                  {isProviderAdmin && <Th screenReaderText="Actions" />}
                </Tr>
              </Thead>
              <Tbody>
                {rows.length === 0 ? (
                  <TableEmptyRow
                    colSpan={columns.length + 1}
                    body="Change the search to see more clusters."
                    onClear={() => setSearch('')}
                  />
                ) : (
                  pageRows.map((c) => (
                    <Tr key={c.name}>
                      <Td dataLabel="Cluster">
                        {c.aiGridEnabled ? (
                          <Link to={`/ai-grid?cluster=${encodeURIComponent(c.name)}`}>{c.name}</Link>
                        ) : (
                          c.name
                        )}
                      </Td>
                      <Td dataLabel="Location">
                        {c.location ??
                          (c.aiGridEnabled ? (
                            <Tooltip content="This member has no location label, so models can't be deployed to it.">
                              <span tabIndex={0} data-testid={`missing-location-${c.name}`}>
                                <Icon status="warning" isInline>
                                  <ExclamationTriangleIcon />
                                </Icon>{' '}
                                No location
                              </span>
                            </Tooltip>
                          ) : (
                            EMPTY_VALUE
                          ))}
                      </Td>
                      <Td dataLabel="Connection">
                        <StatusLabel isCompact status={c.status} reason={statusReason(c)} />
                      </Td>
                      <Td dataLabel="AI Grid">
                        {c.aiGridEnabled ? <StatusLabel isCompact status={c.provisioningStatus} /> : EMPTY_VALUE}
                      </Td>
                      <Td dataLabel="Hub" visibility={wideOnly}>
                        {c.hubAcceptsClient ? 'Accepted' : 'Pending'}
                      </Td>
                      <Td dataLabel="OpenShift">{c.openshiftVersion ?? EMPTY_VALUE}</Td>
                      {isProviderAdmin && (
                        <Td isActionCell>
                          <SimpleMenuActions
                            testId={`cluster-actions-${c.name}`}
                            ariaLabel={`Actions for ${c.name}`}
                            dropdownItems={
                              c.aiGridEnabled
                                ? [
                                    {
                                      key: 'remove',
                                      label: 'Remove from AI Grid',
                                      isDanger: true,
                                      onClick: () => setChange({ cluster: c, join: false }),
                                    },
                                  ]
                                : [
                                    {
                                      key: 'add',
                                      label: 'Add to AI Grid',
                                      disabledReason: cannotAddReason(c),
                                      onClick: () => setChange({ cluster: c, join: true }),
                                    },
                                  ]
                            }
                          />
                        </Td>
                      )}
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          )}
        </PaginatedTable>
      </>
    );
  };

  return (
    <>
      <PageHeader title="Clusters" description="Manage AI Grid membership and provisioning readiness." />
      {!error && !loaded ? <PageLoading label="Loading clusters" /> : <PageSection isFilled>{body()}</PageSection>}
      {change && (
        <MembershipModal
          {...change}
          onConfirm={(membership) => applyChange(change, membership)}
          onClose={() => setChange(undefined)}
        />
      )}
    </>
  );
};

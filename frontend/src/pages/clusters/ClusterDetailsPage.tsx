import { useState } from 'react';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Card,
  CardBody,
  Content,
  EmptyState,
  EmptyStateBody,
  Flex,
  Grid,
  GridItem,
  Label,
  LabelGroup,
  PageSection,
  Tooltip,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ClustersService, GridMembership } from '../../api/clusters';
import type { UserService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import type { GridCluster } from '../../api/types';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { PageLoading } from '../../components/PageLoading';
import { RelativeTime } from '../../components/RelativeTime';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { StatusLabel } from '../../components/StatusLabel';
import { useServiceData } from '../../hooks/useServiceData';
import { formatCores, formatGiB } from '../../utilities/quantity';
import { statusLabelProps } from '../../utilities/status';
import { gpuCount, membershipAction, statusReason } from './clusterInfo';
import type { MembershipChange } from './MembershipModal';
import { MembershipModal } from './MembershipModal';
import { MissingLabel } from './MissingLabel';
import { roleOf } from './roles';

type Props = { service: ClustersService & UserService };

/** The add-on states ACM writes in its `feature.open-cluster-management.io/addon-*` labels, as words. */
const addonStatus: Record<string, string> = {
  available: 'Available',
  unhealthy: 'Unhealthy',
  unreachable: 'Unreachable',
};

/** "68 cores, 65 allocatable", or only the capacity when the hub reports no allocatable value. */
const withAllocatable = (capacity?: string, allocatable?: string) =>
  capacity && allocatable && capacity !== allocatable ? `${capacity}, ${allocatable} allocatable` : capacity;

const aiGridItems = (c: GridCluster) => {
  const role = roleOf(c.labels);
  return [
    {
      term: 'Status',
      value: c.aiGridEnabled ? (
        <StatusLabel isCompact status={c.provisioningStatus} />
      ) : (
        <span className="pf-v6-u-text-color-subtle">Not added</span>
      ),
      'data-testid': 'cluster-membership',
    },
    {
      term: 'Role',
      value: !c.aiGridEnabled ? undefined : role ? (
        `${role.label}: ${role.description}`
      ) : (
        <MissingLabel
          testId="missing-role"
          reason="This member has no role, so the hub doesn't install OpenShift AI or MaaS on it, and it never finishes provisioning. Remove it from AI Grid and add it again to choose a role."
        >
          No role
        </MissingLabel>
      ),
    },
    {
      term: 'Location',
      value:
        c.location ??
        (c.aiGridEnabled ? (
          <MissingLabel
            testId="missing-location"
            reason="This member has no location label, so models can't be deployed to it."
          >
            No location
          </MissingLabel>
        ) : undefined),
    },
  ];
};

const clusterItems = (c: GridCluster) => [
  { term: 'OpenShift version', value: c.openshiftVersion },
  { term: 'Kubernetes version', value: c.kubernetesVersion },
  { term: 'Platform', value: c.platform },
  { term: 'Product', value: c.product },
  { term: 'Added to the hub', value: c.creationTimestamp && <RelativeTime time={c.creationTimestamp} /> },
];

const capacityItems = (c: GridCluster) => {
  const cap = c.capacity ?? {};
  const alloc = c.allocatable ?? {};
  return [
    { term: 'CPU', value: withAllocatable(formatCores(cap.cpu), formatCores(alloc.cpu)) },
    { term: 'Memory', value: withAllocatable(formatGiB(cap.memory), formatGiB(alloc.memory)) },
    { term: 'NVIDIA GPUs', value: gpuCount(c), 'data-testid': 'cluster-gpus' },
  ];
};

const NotReported: React.FC<{ what: string }> = ({ what }) => (
  <Content component="p" className="pf-v6-u-text-color-subtle">
    The backend doesn't report {what} yet.
  </Content>
);

const Section: React.FC<{ title: string; help?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  help,
  children,
}) => (
  <Card isFullHeight>
    <CardBody>
      <DetailsSection title={title} help={help}>
        {children}
      </DetailsSection>
    </CardBody>
  </Card>
);

/** A cluster at /clusters/:name: its AI Grid membership, what the hub knows about it, and its health. */
export const ClusterDetailsPage: React.FC<Props> = ({ service }) => {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [loadedCluster, loaded, error, refresh] = useServiceData<GridCluster | undefined>(
    () => service.getCluster(name),
    undefined,
  );
  const [user] = useServiceData(() => service.getUser(), undefined, 0);
  const [change, setChange] = useState<MembershipChange>();
  // The cluster as Add or Remove returned it, shown until a load started after that change
  // answers: a slow or failed reload can't bring back the membership (or the version) from before
  // it. Loads started earlier are dropped by useServiceData, so the next new load is a later one.
  const [confirmed, setConfirmed] = useState<GridCluster>();
  const [awaitingReload, setAwaitingReload] = useState(false);
  const [seen, setSeen] = useState(loadedCluster);
  if (loadedCluster !== seen) {
    setSeen(loadedCluster);
    if (awaitingReload) {
      setAwaitingReload(false);
      setConfirmed(undefined);
    }
  }
  const cluster = confirmed ?? loadedCluster;

  /** Adds the cluster to AI Grid or removes it, then reloads it; throws for the modal to show. */
  const applyChange = async ({ cluster: c, join }: MembershipChange, membership?: GridMembership) => {
    const updated = membership ? await service.enrollCluster(c, membership) : await service.removeClusterFromGrid(c);
    if (updated.aiGridEnabled !== join) {
      throw new Error('The Hub did not confirm the change. Refresh and try again.');
    }
    setConfirmed(updated);
    setAwaitingReload(true);
    setChange(undefined);
    navigate('.', { state: { notice: `${updated.name} ${join ? 'added to' : 'removed from'} AI Grid` } });
    void refresh();
  };

  const notFound = error instanceof ServiceError && error.status === 404;

  const actions = cluster && (
    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
      {cluster.consoleUrl && (
        <Button
          variant="secondary"
          component="a"
          href={cluster.consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          icon={<ExternalLinkAltIcon />}
          iconPosition="end"
        >
          OpenShift console
        </Button>
      )}
      {user?.isProviderAdmin && (
        <SimpleMenuActions
          toggleLabel="Actions"
          ariaLabel={`Actions for ${cluster.name}`}
          testId="cluster-actions"
          dropdownItems={[membershipAction(cluster, setChange)]}
        />
      )}
    </Flex>
  );

  const body = () => {
    if (notFound) {
      return (
        <EmptyState titleText="Cluster not found" headingLevel="h2">
          <EmptyStateBody>
            The hub has no managed cluster {name}. <Link to="/clusters">Go to Clusters</Link>
          </EmptyStateBody>
        </EmptyState>
      );
    }
    if (error && !cluster) {
      return <LoadError subject="Clusters" error={error} />;
    }
    if (!cluster) {
      return null;
    }
    return (
      <Grid hasGutter>
        {error && (
          <GridItem>
            <Alert isInline variant="warning" title="Showing the last loaded state">
              {error.message}
            </Alert>
          </GridItem>
        )}
        <GridItem md={6}>
          <Section
            title="AI Grid"
            help="A member has the ai-grid/enabled label. The hub then installs what its role needs, and the cluster is provisioned once the hub's ai-grid-ready Policy is compliant on it."
          >
            <DetailsList items={aiGridItems(cluster)} aria-label="AI Grid membership" />
          </Section>
        </GridItem>
        <GridItem md={6}>
          <Section title="Cluster">
            <DetailsList items={clusterItems(cluster)} aria-label="Cluster" />
          </Section>
        </GridItem>
        <GridItem md={6}>
          <Section title="Capacity" help="What the cluster's nodes provide, as the hub reports it.">
            {cluster.capacity ? (
              <DetailsList items={capacityItems(cluster)} aria-label="Capacity" />
            ) : (
              <NotReported what="this cluster's capacity" />
            )}
          </Section>
        </GridItem>
        <GridItem md={6}>
          <Section
            title="Add-ons"
            help="The ACM add-ons on this cluster, colored by their health as the hub reports it: green when available, red when unhealthy or unreachable. Hover over one for its state."
          >
            {Object.keys(cluster.addons).length ? (
              <LabelGroup aria-label="Add-ons" numLabels={20} data-testid="cluster-addons">
                {Object.entries(cluster.addons)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([addon, state]) => (
                    <Tooltip key={addon} content={addonStatus[state] ?? state}>
                      <Label {...statusLabelProps(addonStatus[state] ?? state)} variant="outline" tabIndex={0}>
                        {addon}
                      </Label>
                    </Tooltip>
                  ))}
              </LabelGroup>
            ) : (
              <Content component="p" className="pf-v6-u-text-color-subtle">
                The hub reports no add-ons on this cluster.
              </Content>
            )}
          </Section>
        </GridItem>
        <GridItem>
          <Section
            title="Conditions"
            help="The hub's conditions on this ManagedCluster: whether it accepted and imported the cluster, and whether the cluster's agent still reports in."
          >
            {cluster.conditions.length ? (
              <Table aria-label="Conditions" variant="compact" data-testid="cluster-conditions">
                <Thead>
                  <Tr>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Reason</Th>
                    <Th>Message</Th>
                    <Th>Last changed</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {cluster.conditions.map((cond) => (
                    <Tr key={cond.type}>
                      <Td dataLabel="Type">{cond.type}</Td>
                      <Td dataLabel="Status">{cond.status}</Td>
                      <Td dataLabel="Reason">{cond.reason}</Td>
                      <Td dataLabel="Message">{cond.message}</Td>
                      <Td dataLabel="Last changed">
                        <RelativeTime time={cond.lastTransitionTime} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <NotReported what="this cluster's conditions" />
            )}
          </Section>
        </GridItem>
      </Grid>
    );
  };

  return (
    <>
      <PageHeader
        title={name}
        status={
          cluster && (
            <StatusLabel
              status={cluster.status}
              reason={['Connection to the hub', statusReason(cluster)].filter(Boolean).join(': ')}
            />
          )
        }
        headerAction={actions}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/clusters">Clusters</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>{name}</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      {!loaded ? <PageLoading label="Loading cluster" /> : <PageSection isFilled>{body()}</PageSection>}
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

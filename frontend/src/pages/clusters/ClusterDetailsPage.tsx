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
  List,
  ListItem,
  PageSection,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ClustersService, GridMembership } from '../../api/clusters';
import type { UserService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import type { ClusterGPUs, GPUNode, GridCluster } from '../../api/types';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { TableRowTitleDescription } from '../../components/TableRowTitleDescription';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { PageLoading } from '../../components/PageLoading';
import { RelativeTime } from '../../components/RelativeTime';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { StatusLabel } from '../../components/StatusLabel';
import { useServiceData } from '../../hooks/useServiceData';
import { EMPTY_VALUE } from '../../utilities/format';
import { formatCores, formatGiB } from '../../utilities/quantity';
import { gpuCount, membershipAction, statusReason } from './clusterInfo';
import {
  capacityText,
  configurationText,
  gpuArchitecture,
  gpuCountText,
  gpuMemory,
  gpuModel,
  gpuSharing,
} from './gpuText';
import type { MembershipChange } from './MembershipModal';
import { MembershipModal } from './MembershipModal';
import { changeMembership } from './changeMembership';
import { MissingLabel } from './MissingLabel';
import { roleOf } from './roles';

type Props = { service: ClustersService & UserService };

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

/** Each distinct value once, in order. */
const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];

const gpuItems = (g: ClusterGPUs) => [
  { term: 'Capacity', value: capacityText(g), 'data-testid': 'cluster-gpu-capacity' },
  {
    term: g.configurations.length === 1 ? 'Configuration' : 'Configurations',
    value: (
      <List isPlain data-testid="cluster-gpu-configurations">
        {g.configurations.map((c, i) => (
          // Everything that tells two configurations apart, and the index for two the backend
          // sent alike.
          <ListItem
            key={[
              c.vendor,
              c.product,
              c.memoryMib,
              c.gpusPerNode,
              c.sharing.strategy,
              c.sharing.replicas,
              c.sharing.migStrategy,
              i,
            ].join('|')}
          >
            {[
              configurationText(c),
              gpuMemory(c.memoryMib) && `${gpuMemory(c.memoryMib)} each`,
              gpuSharing(c.sharing, c.product),
              `${c.nodeCount} ${c.nodeCount === 1 ? 'node' : 'nodes'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </ListItem>
        ))}
      </List>
    ),
  },
  { term: 'Manufacturer', value: distinct(g.nodes.map((n) => n.vendor)).join(', ') },
  {
    term: 'Architecture',
    value: distinct(g.nodes.map((n) => gpuArchitecture(n.family))).join(', ') || undefined,
  },
  {
    term: 'Driver',
    value: distinct(g.nodes.map((n) => driverText(n.driverVersion, n.cudaRuntimeVersion))).join(', ') || undefined,
  },
];

/** "580.105.08 (CUDA 13.0)", or whichever of the two the node reports. */
const driverText = (driver?: string, cuda?: string) =>
  driver && cuda ? `${driver} (CUDA ${cuda})` : driver || (cuda && `CUDA ${cuda}`) || undefined;

/** "Hopper (9.0)": the architecture with its compute capability, or whichever the node reports. */
const architectureText = (family?: string, compute?: string) => {
  const name = gpuArchitecture(family);
  if (name && compute) return `${name} (${compute})`;
  return name ?? compute;
};

/**
 * One row per GPU node: its name with the instance type under it, the model and its count,
 * memory, architecture, driver, sharing and readiness.
 */
const GPUNodesTable: React.FC<{ nodes: GPUNode[] }> = ({ nodes }) => (
  <Table aria-label="GPU nodes" variant="compact" data-testid="cluster-gpu-nodes">
    <Thead>
      <Tr>
        <Th width={25} modifier="wrap">
          Node
        </Th>
        <Th modifier="wrap">Model</Th>
        <Th modifier="wrap">GPUs</Th>
        <Th modifier="wrap">Memory</Th>
        <Th modifier="wrap">Architecture</Th>
        <Th modifier="wrap">Driver</Th>
        <Th modifier="wrap">Sharing</Th>
        <Th modifier="wrap">Status</Th>
      </Tr>
    </Thead>
    <Tbody>
      {nodes.map((n) => (
        <Tr key={n.name}>
          <Td dataLabel="Node" modifier="breakWord">
            <TableRowTitleDescription
              title={n.name}
              subtitle={
                n.instanceType && (
                  <Content component="small" className="pf-v6-u-text-color-subtle">
                    {n.instanceType}
                  </Content>
                )
              }
            />
          </Td>
          <Td dataLabel="Model">{gpuModel(n.product)}</Td>
          <Td dataLabel="GPUs">{n.count}</Td>
          <Td dataLabel="Memory">{gpuMemory(n.memoryMib) ?? EMPTY_VALUE}</Td>
          <Td dataLabel="Architecture">{architectureText(n.family, n.computeCapability) ?? EMPTY_VALUE}</Td>
          <Td dataLabel="Driver">{driverText(n.driverVersion, n.cudaRuntimeVersion) ?? EMPTY_VALUE}</Td>
          <Td dataLabel="Sharing">{gpuSharing(n.sharing, n.product) ?? 'None'}</Td>
          <Td dataLabel="Status">
            <StatusLabel isCompact status={n.ready ? 'Ready' : 'Not ready'} />
          </Td>
        </Tr>
      ))}
    </Tbody>
  </Table>
);

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
  const applyChange = async (change: MembershipChange, membership?: GridMembership) => {
    const { join } = change;
    // A 409 loads the cluster again into the open dialog, as on the Clusters list.
    const updated = await changeMembership(service, change, membership, {
      reload: (clusterName) => service.getCluster(clusterName),
      onConflict: (current) => {
        if (current) {
          setChange((open) => (open?.cluster.name === current.name ? { ...open, cluster: current } : open));
        }
        void refresh();
      },
    });
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
      return <LoadError subject="Clusters" error={error} onRetry={() => void refresh()} />;
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
            title="GPUs"
            help="What the cluster's GPU nodes report through their NVIDIA GPU Feature Discovery labels, which the hub's ACM Search indexes."
          >
            {cluster.gpus ? (
              <DetailsList items={gpuItems(cluster.gpus)} aria-label="GPUs" />
            ) : !cluster.capacity ? (
              <NotReported what="this cluster's GPUs" />
            ) : (
              <Content component="p" className="pf-v6-u-text-color-subtle" data-testid="cluster-gpus-not-reported">
                {gpuCount(cluster)
                  ? `The hub reports ${gpuCountText(gpuCount(cluster) ?? 0)} in this cluster's capacity, but no details for its GPU nodes: ACM Search hasn't indexed them, or the backend doesn't report them yet.`
                  : 'The hub reports no GPUs on this cluster.'}
              </Content>
            )}
          </Section>
        </GridItem>
        {cluster.gpus && (
          <GridItem>
            <Section title="GPU nodes">
              <GPUNodesTable nodes={cluster.gpus.nodes} />
            </Section>
          </GridItem>
        )}
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

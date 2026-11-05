// The model on each cluster its placement names. The design's table
// (jgiardino/ai-grid-provider-console@a4e6090 ModelLocationsTable.tsx) has Cluster, Location, Status
// and actions; here it is Cluster, Site, Region, Status and View, Site and Region in the glossary's
// words in place of Location (clusterPlaces.ts). Status is the backend's word for the cluster
// (ModelClusterStatus.state: Syncing, Synced, Starting, Ready, Failed, Stopped) and opens what the
// cluster reported; View opens OpenShift AI's model deployments there, or the OpenShift console where
// the cluster runs no dashboard (view_url). While no cluster has reported the model (the backend's
// SavedToGit), the rows are the clusters the placement chose, each Pending sync, opening nothing.
// The design's progress stepper isn't here: the backend doesn't report the LLMInferenceService's
// condition tree, so the dialog shows what it does report.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Stack,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { StatusLabel } from '../../components/StatusLabel';
import { EMPTY_VALUE } from '../../utilities/format';
import { statusLabelProps } from '../../utilities/status';
import { regionOf, siteOf, type ClusterPlaces } from './clusterPlaces';
import { gitStatusMessage } from './modelStatusInfo';
import { viewHref } from './modelUtils';
import { titleOf, type ModelClusterView, type ModelView } from './modelView';
import { statusModalLayout } from './statusModalLayout';

type Props = {
  model: ModelView;
  clusters: ClusterPlaces;
  /** Inside the Models page's expanded row, or a dialog. */
  isNested?: boolean;
  /**
   * Whether a cluster's status opens its dialog. Off inside another dialog: PatternFly's modals
   * don't stack (Escape closes both, and the outer one hides the inner from screen readers).
   */
  opensClusters?: boolean;
};

/** The word a cluster's row shows: the backend's, or Pending sync while it has none. */
const clusterStatus = (c: Pick<ModelClusterView, 'state'>) => c.state ?? 'Pending sync';

/** View: OpenShift AI's model deployments on the cluster, or the OpenShift console. */
const ViewLink: React.FC<{ status?: ModelClusterView; cluster: string }> = ({ status, cluster }) => {
  const href = viewHref(status?.viewUrl);
  if (!href) return <>{EMPTY_VALUE}</>;
  const where = status?.viewTarget === 'OpenShift AI' ? 'OpenShift AI' : 'the OpenShift console';
  return (
    <Tooltip content={`Open ${where} on ${cluster}`}>
      <Button
        variant="link"
        isInline
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        icon={<ExternalLinkAltIcon />}
        iconPosition="end"
        aria-label={`View on ${cluster} in ${where}`}
      >
        View
      </Button>
    </Tooltip>
  );
};

/** What one cluster reported about the model, opened from its status in the table. */
const ClusterStatusModal: React.FC<{
  model: ModelView;
  status: ModelClusterView;
  site: string;
  region: string;
  onClose: () => void;
}> = ({ model, status, site, region, onClose }) => {
  const word = clusterStatus(status);
  const gitMessage = gitStatusMessage[word as keyof typeof gitStatusMessage];
  const row = (term: string, value: React.ReactNode) => (
    <DescriptionListGroup>
      <DescriptionListTerm>{term}</DescriptionListTerm>
      <DescriptionListDescription>{value}</DescriptionListDescription>
    </DescriptionListGroup>
  );
  return (
    <Modal {...statusModalLayout} isOpen onClose={onClose} aria-label={`${titleOf(model)} on ${status.cluster}`}>
      <ModalHeader>
        <Title headingLevel="h1" size="2xl">
          <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{titleOf(model)} status</FlexItem>
            <FlexItem>
              <Label isCompact {...statusLabelProps(word)} variant="filled">
                {word}
              </Label>
            </FlexItem>
          </Flex>
        </Title>
        <p>
          <strong>Model status</strong> on cluster{' '}
          <Link to={`/clusters/${encodeURIComponent(status.cluster)}`}>{status.cluster}</Link>
        </p>
      </ModalHeader>
      <ModalBody>
        <Stack hasGutter>
          {gitMessage && <p>{gitMessage}</p>}
          <DescriptionList isCompact aria-label={`What ${status.cluster} reported`}>
            {row('Site', site)}
            {row('Region', region)}
            {row('Git sync', status.sync ?? 'No report')}
            {status.syncMessage && row('Sync message', status.syncMessage)}
            {row('Model on the cluster', status.deployment === 'Unknown' ? 'Not deployed yet' : status.deployment)}
            {status.deploymentMessage && row('Model message', status.deploymentMessage)}
            {row('Reported', status.message ?? EMPTY_VALUE)}
          </DescriptionList>
        </Stack>
      </ModalBody>
    </Modal>
  );
};

/** The model's clusters: each placed cluster's status and View link, or the clusters the placement chose. */
export const ModelClustersTable: React.FC<Props> = ({ model, clusters, isNested, opensClusters = true }) => {
  // The open dialog's cluster, not its entry: each poll brings new entries, and the dialog shows the
  // current one, or closes when the model no longer has the cluster or its state. Closing forgets
  // the cluster, so a poll that brings it back doesn't open the dialog again without a click.
  const [openCluster, setOpenCluster] = useState<string>();
  const open = model.clusters.find((c) => c.cluster === openCluster && c.state);
  if (openCluster && !open) {
    setOpenCluster(undefined);
  }
  const title = titleOf(model);
  const reported = model.clusters.length > 0;
  const rows: { cluster: string; status?: ModelClusterView }[] = reported
    ? model.clusters.map((status) => ({ cluster: status.cluster, status }))
    : model.selectedClusters.map((cluster) => ({ cluster }));

  return (
    <>
      <Table
        aria-label={`Clusters of ${title}`}
        variant="compact"
        isNested={isNested}
        borders={isNested ? false : undefined}
      >
        <Thead>
          {/* resetOffset: inside the Models page's expanded row, the nested table's first column lines
              up with the row's Name, as PatternFly's nested tables and the UX design do. */}
          <Tr resetOffset={isNested}>
            <Th>Cluster</Th>
            <Th>Site</Th>
            <Th>Region</Th>
            <Th>Status</Th>
            <Th modifier="fitContent" screenReaderText="View" />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ cluster, status }) => (
            <Tr key={cluster} resetOffset={isNested}>
              <Td dataLabel="Cluster">
                <Link to={`/clusters/${encodeURIComponent(cluster)}`}>{cluster}</Link>
              </Td>
              <Td dataLabel="Site">{siteOf(clusters, cluster)}</Td>
              <Td dataLabel="Region">{regionOf(clusters, cluster)}</Td>
              <Td dataLabel="Status">
                <div>
                  <StatusLabel
                    isCompact
                    status={status ? clusterStatus(status) : 'Pending sync'}
                    onClick={status?.state && opensClusters ? () => setOpenCluster(cluster) : undefined}
                    screenReaderSuffix={` on ${cluster}`}
                  />
                </div>
              </Td>
              <Td dataLabel="View" modifier="fitContent">
                <ViewLink status={status} cluster={cluster} />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {open && (
        <ClusterStatusModal
          model={model}
          status={open}
          site={siteOf(clusters, open.cluster)}
          region={regionOf(clusters, open.cluster)}
          onClose={() => setOpenCluster(undefined)}
        />
      )}
    </>
  );
};

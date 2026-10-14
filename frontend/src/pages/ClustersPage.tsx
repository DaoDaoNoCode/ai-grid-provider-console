import { useState } from 'react';
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateBody,
  Label,
  Spinner,
  Stack,
  StackItem,
  Title,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ConsoleService } from '../api/ConsoleService';
import type { GridCluster } from '../api/types';
import { useServiceData } from '../hooks/useServiceData';

type Props = { service: ConsoleService; canEdit: boolean };

const statusColor = (status: GridCluster['status']) =>
  status === 'Ready' ? 'green' : status === 'Offline' ? 'red' : 'grey';

export const ClustersPage: React.FC<Props> = ({ service, canEdit }) => {
  const [clusters, loaded, error, refresh] = useServiceData<GridCluster[]>(() => service.listClusters(), []);
  const [busy, setBusy] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const toggle = async (cluster: GridCluster) => {
    setBusy(cluster.name);
    setActionError(undefined);
    try {
      await service.updateCluster(cluster.name, { aiGridEnabled: !cluster.aiGridEnabled });
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h2">Clusters</Title>
      </StackItem>
      {error && (
        <StackItem>
          <Alert variant="danger" isInline title="Clusters could not be loaded">
            {error.message}
          </Alert>
        </StackItem>
      )}
      {actionError && (
        <StackItem>
          <Alert variant="danger" isInline title="The cluster could not be updated">
            {actionError}
          </Alert>
        </StackItem>
      )}
      <StackItem>
        {!loaded ? (
          <Spinner aria-label="Loading clusters" />
        ) : clusters.length === 0 ? (
          <EmptyState titleText="No clusters" headingLevel="h3">
            <EmptyStateBody>No ManagedClusters are visible to your account on this hub.</EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label="Clusters" variant="compact">
            <Thead>
              <Tr>
                <Th>Cluster</Th>
                <Th>Location</Th>
                <Th>Status</Th>
                <Th>AI Grid</Th>
                <Th>Provisioning</Th>
                <Th>OpenShift</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {clusters.map((c) => (
                <Tr key={c.name}>
                  <Td dataLabel="Cluster">
                    {c.consoleUrl ? (
                      <a href={c.consoleUrl} target="_blank" rel="noreferrer">
                        {c.name}
                      </a>
                    ) : (
                      c.name
                    )}
                  </Td>
                  <Td dataLabel="Location">{c.location ?? '-'}</Td>
                  <Td dataLabel="Status">
                    <Label color={statusColor(c.status)}>{c.status}</Label>
                  </Td>
                  <Td dataLabel="AI Grid">{c.aiGridEnabled ? 'Member' : 'Not enrolled'}</Td>
                  <Td dataLabel="Provisioning">{c.provisioningStatus}</Td>
                  <Td dataLabel="OpenShift">{c.openshiftVersion ?? '-'}</Td>
                  <Td dataLabel="Actions" isActionCell>
                    <Button
                      variant="secondary"
                      size="sm"
                      isDisabled={!canEdit || busy !== undefined}
                      isLoading={busy === c.name}
                      onClick={() => void toggle(c)}
                      aria-label={`${c.aiGridEnabled ? 'Remove' : 'Add'} ${c.name} ${c.aiGridEnabled ? 'from' : 'to'} AI Grid`}
                    >
                      {c.aiGridEnabled ? 'Remove from AI Grid' : 'Add to AI Grid'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </StackItem>
    </Stack>
  );
};

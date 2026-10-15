import { Alert, EmptyState, EmptyStateBody, Label, Spinner, Stack, StackItem, Title } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ConsoleService } from '../api/ConsoleService';
import type { GridCluster } from '../api/types';
import { useServiceData } from '../hooks/useServiceData';

type Props = { service: ConsoleService };

export const ClustersPage: React.FC<Props> = ({ service }) => {
  const [clusters, loaded, error] = useServiceData<GridCluster[]>(() => service.listClusters(), []);

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
      <StackItem>
        {!loaded ? (
          <Spinner aria-label="Loading clusters" />
        ) : error ? null : clusters.length === 0 ? (
          <EmptyState titleText="No clusters" headingLevel="h3">
            <EmptyStateBody>The AI Grid backend reports no ManagedClusters on this hub.</EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label="Clusters" variant="compact">
            <Thead>
              <Tr>
                <Th>Cluster</Th>
                <Th>Site</Th>
                <Th>Region</Th>
                <Th>Location</Th>
                <Th>AI Grid</Th>
                <Th>Provisioned</Th>
                <Th>Hub</Th>
                <Th>OpenShift</Th>
              </Tr>
            </Thead>
            <Tbody>
              {clusters.map((c) => (
                <Tr key={c.name}>
                  <Td dataLabel="Cluster">{c.name}</Td>
                  <Td dataLabel="Site">{c.site ?? '-'}</Td>
                  <Td dataLabel="Region">{c.region ?? '-'}</Td>
                  <Td dataLabel="Location">{c.location ?? '-'}</Td>
                  <Td dataLabel="AI Grid">
                    <Label color={c.aiGridEnabled ? 'green' : 'grey'}>{c.aiGridEnabled ? 'Member' : 'Not enrolled'}</Label>
                  </Td>
                  <Td dataLabel="Provisioned">{c.provisioned ? 'Yes' : 'No'}</Td>
                  <Td dataLabel="Hub">{c.hubAcceptsClient ? 'Accepted' : 'Pending'}</Td>
                  <Td dataLabel="OpenShift">{c.openshiftVersion ?? '-'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </StackItem>
    </Stack>
  );
};

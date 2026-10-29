// A model row expanded when its placement chose clusters but the backend reports no status per
// location: in git mode the backend saves the model to Git and the hub's Argo CD delivers it, so
// there are no works to read (a real hub's granite-4-tiny: selected site-b, works []).
import { Content, Stack } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ManagedModel } from '../../api/types';
import { SubtleText } from '../../components/SubtleText';
import type { ClusterView } from '../clusters/clusterView';
import { locationLabel } from './modelUtils';

type Props = {
  model: Pick<ManagedModel, 'name' | 'displayName' | 'selectedClusters'>;
  /** The hub's clusters, for each selected cluster's location. */
  clusters: Pick<ClusterView, 'name' | 'location'>[];
  siteNames: Map<string, string>;
};

/**
 * The clusters the placement chose, as ModelLocationsTable names them. One line says there is no
 * status per location; the table has no Status column to repeat it on every row.
 */
export const ModelSelectedClusters: React.FC<Props> = ({ model, clusters, siteNames }) => {
  const nameOf = (cluster: string) => {
    const location = clusters.find((c) => c.name === cluster)?.location;
    return location ? `${locationLabel(location, siteNames)} · ${cluster}` : cluster;
  };
  return (
    <Stack hasGutter data-testid={`model-selected-clusters-${model.name}`}>
      <Content component="p">
        <SubtleText>Status per location isn&apos;t reported for this model yet.</SubtleText>
      </Content>
      <Table aria-label={`Locations of ${model.displayName ?? model.name}`} variant="compact" isNested>
        <Thead>
          <Tr resetOffset>
            <Th>Location</Th>
          </Tr>
        </Thead>
        <Tbody>
          {model.selectedClusters.map((cluster) => (
            <Tr key={cluster} resetOffset data-testid="model-selected-cluster-row">
              <Td dataLabel="Location">{nameOf(cluster)}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Stack>
  );
};

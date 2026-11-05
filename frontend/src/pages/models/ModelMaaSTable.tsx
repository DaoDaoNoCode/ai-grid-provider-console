// The model's availability on each ingress cluster (ModelStatus.ingress): whether tenants can call
// it there, with MaaS's own message. A model can run on its clusters and still await a
// subscription, which this table and the Models list's Availability column show. The page adds no
// status of its own.
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { StatusLabel } from '../../components/StatusLabel';
import { EMPTY_VALUE } from '../../utilities/format';
import { regionOf, type ClusterRegions } from './clusterRegions';
import { titleOf, type ModelView } from './modelView';

type Props = {
  model: Pick<ModelView, 'id' | 'displayName' | 'ingress'>;
  clusters: ClusterRegions;
};

export const ModelMaaSTable: React.FC<Props> = ({ model, clusters }) => (
  <Table aria-label={`Availability of ${titleOf(model)}`} variant="compact">
    <Thead>
      <Tr>
        <Th>Ingress cluster</Th>
        <Th>Region</Th>
        <Th modifier="fitContent">Availability</Th>
        <Th>MaaS message</Th>
      </Tr>
    </Thead>
    <Tbody>
      {model.ingress.map((ingress) => (
        <Tr key={ingress.cluster}>
          <Td dataLabel="Ingress cluster">{ingress.cluster}</Td>
          <Td dataLabel="Region">{regionOf(clusters, ingress.cluster)}</Td>
          <Td dataLabel="Availability" modifier="fitContent">
            {ingress.maas ? (
              <div>
                <StatusLabel isCompact status={ingress.maas} screenReaderSuffix={` on ${ingress.cluster}`} />
              </div>
            ) : (
              EMPTY_VALUE
            )}
          </Td>
          <Td dataLabel="MaaS message" modifier="breakWord">
            {ingress.message ?? EMPTY_VALUE}
          </Td>
        </Tr>
      ))}
    </Tbody>
  </Table>
);

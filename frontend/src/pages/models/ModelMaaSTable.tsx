// The model's availability on each ingress cluster (ModelStatus.ingress): whether organizations'
// users can call it there, with MaaS's own message. Each ingress cluster links to its page, with its
// Site and Region as the clusters table shows them (clusterPlaces.ts). A model can run on its clusters and still await a
// subscription, which this table and the Models list's Availability column show. The page adds no
// status of its own.
import { Link } from 'react-router-dom';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { StatusLabel } from '../../components/StatusLabel';
import { EMPTY_VALUE } from '../../utilities/format';
import { regionOf, siteOf, type ClusterPlaces } from './clusterPlaces';
import { titleOf, type ModelView } from './modelView';

type Props = {
  model: Pick<ModelView, 'id' | 'displayName' | 'ingress'>;
  clusters: ClusterPlaces;
};

export const ModelMaaSTable: React.FC<Props> = ({ model, clusters }) => (
  <Table aria-label={`Availability of ${titleOf(model)}`} variant="compact">
    <Thead>
      <Tr>
        <Th>Ingress cluster</Th>
        <Th>Site</Th>
        <Th>Region</Th>
        <Th modifier="fitContent">Availability</Th>
        <Th>MaaS message</Th>
      </Tr>
    </Thead>
    <Tbody>
      {model.ingress.map((ingress) => (
        <Tr key={ingress.cluster}>
          <Td dataLabel="Ingress cluster">
            <Link to={`/clusters/${encodeURIComponent(ingress.cluster)}`}>{ingress.cluster}</Link>
          </Td>
          <Td dataLabel="Site">{siteOf(clusters, ingress.cluster)}</Td>
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

import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  EmptyState,
  EmptyStateBody,
  Flex,
  List,
  ListItem,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { UserService } from '../../api/ConsoleService';
import type { ClustersService } from '../../api/clusters';
import type { ManagedModel } from '../../api/types';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import { useServiceData } from '../../hooks/useServiceData';
import { formatDateTime } from '../../utilities/format';
import { locationLabel, siteNamesOf } from './modelUtils';
import { ModelStatusDetails, ModelStatusLabel } from './ModelStatus';
import { hasModelStatusDetails, modelPhase, modelStatusTitle } from './modelStatusInfo';
import type { ModelDeleteService } from './useDeleteModel';
import { useDeleteModel } from './useDeleteModel';

type Props = { service: ModelDeleteService & UserService & Pick<ClustersService, 'listClusters'> };

/** A model deployment at /models/:namespace/:name: its status explained, its configuration and its locations. */
export const ModelDetailsPage: React.FC<Props> = ({ service }) => {
  const { namespace = '', name = '' } = useParams();
  const navigate = useNavigate();
  const [models, loaded, error, refresh] = useServiceData<ManagedModel[]>(() => service.listModels(), []);
  const [clusters] = useServiceData(() => service.listClusters(), [], 0);
  const [user] = useServiceData(() => service.getUser(), undefined, 0);
  const model = models.find((m) => m.namespace === namespace && m.name === name);
  const [confirmDelete, deleteModal] = useDeleteModel(service, {
    models,
    refresh: () => void refresh(),
    onDeleted: () => navigate('/models', { state: { notice: 'Model deployment deleted' } }),
  });
  const title = model?.displayName ?? name;
  const siteNames = siteNamesOf(clusters);

  const body = () => {
    if (error && !model) {
      return <LoadError subject="Models" error={error} />;
    }
    if (!loaded) {
      return <Spinner aria-label="Loading model" />;
    }
    if (!model) {
      return (
        <EmptyState titleText="Model deployment not found" headingLevel="h2">
          <EmptyStateBody>
            There is no model deployment {name} in {namespace}. <Link to="/models">Go to Models</Link>
          </EmptyStateBody>
        </EmptyState>
      );
    }
    const phase = modelPhase(model);
    return (
      <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsXl' }}>
        {phase !== 'Ready' && hasModelStatusDetails(model) && (
          <Alert
            isInline
            variant={phase === 'Failed' ? 'danger' : 'info'}
            title={modelStatusTitle(model)}
            data-testid="model-status-alert"
          >
            <ModelStatusDetails model={model} />
          </Alert>
        )}
        <DetailsSection title="Deployment">
          <DetailsList
            aria-label="Deployment"
            items={[
              { term: 'Resource name', value: model.name },
              { term: 'Description', value: model.description },
              { term: 'Model', value: model.modelName ?? model.modelRef.name },
              { term: 'Model URI', value: model.modelUri },
              { term: 'Runtime image', value: model.runtimeImage },
              { term: 'Replicas', value: model.replicas },
              { term: 'Endpoint', value: model.endpoint },
              { term: 'Created', value: formatDateTime(model.creationTimestamp) },
            ]}
          />
        </DetailsSection>
        <DetailsSection title="Locations">
          {model.locations.length ? (
            <>
              <List data-testid="model-locations">
                {model.locations.map((location) => (
                  <ListItem key={location}>{locationLabel(location, siteNames)}</ListItem>
                ))}
              </List>
              <Link to={`/ai-grid?model=${encodeURIComponent(`${model.namespace}/${model.name}`)}`}>
                Show on the AI Grid map
              </Link>
            </>
          ) : (
            <p>The placement hasn’t chosen any locations yet.</p>
          )}
        </DetailsSection>
      </Flex>
    );
  };

  return (
    <>
      <PageHeader
        title={title}
        status={model && <ModelStatusLabel model={model} />}
        headerAction={
          model &&
          user?.isProviderAdmin && (
            <SimpleMenuActions
              toggleLabel="Actions"
              ariaLabel={`Actions for ${title}`}
              testId="model-actions"
              dropdownItems={[{ key: 'delete', label: 'Delete', isDanger: true, onClick: () => confirmDelete(model) }]}
            />
          )
        }
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/models">Models</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>{title}</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      <PageSection isFilled>{body()}</PageSection>
      {deleteModal}
    </>
  );
};

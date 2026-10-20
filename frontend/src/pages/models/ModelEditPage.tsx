import { Breadcrumb, BreadcrumbItem, EmptyState, EmptyStateBody, PageSection, Spinner } from '@patternfly/react-core';
import { Link, useParams } from 'react-router-dom';
import type { UserService } from '../../api/ConsoleService';
import type { ClustersService } from '../../api/clusters';
import type { ModelsService } from '../../api/models';
import type { ManagedModel } from '../../api/types';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { useServiceData } from '../../hooks/useServiceData';
import { modelPath } from './modelUtils';
import { ModelWizard } from './ModelWizard';

type Props = { service: ModelsService & UserService & Pick<ClustersService, 'listClusters'> };

/**
 * Edits a model deployment at /models/:namespace/:name/edit in the deploy wizard. It loads the
 * model once, as the details page does, so the wizard starts from the version the user saw.
 */
export const ModelEditPage: React.FC<Props> = ({ service }) => {
  const { namespace = '', name = '' } = useParams();
  const [models, loaded, error] = useServiceData<ManagedModel[]>(() => service.listModels(), [], 0);
  const model = models.find((m) => m.namespace === namespace && m.name === name);
  if (model) {
    return <ModelWizard key={`${namespace}/${name}`} service={service} model={model} />;
  }
  const detailsPath = modelPath({ namespace, name });
  return (
    <>
      <PageHeader
        title={`Edit ${name}`}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/models">Models</Link>
            </BreadcrumbItem>
            <BreadcrumbItem>
              <Link to={detailsPath}>{name}</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>Edit</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      <PageSection isFilled>
        {error ? (
          <LoadError subject="Models" error={error} />
        ) : !loaded ? (
          <Spinner aria-label="Loading model" />
        ) : (
          <EmptyState titleText="Model deployment not found" headingLevel="h2">
            <EmptyStateBody>
              There is no model deployment {name} in {namespace}. <Link to="/models">Go to Models</Link>
            </EmptyStateBody>
          </EmptyState>
        )}
      </PageSection>
    </>
  );
};

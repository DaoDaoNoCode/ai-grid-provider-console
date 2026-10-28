import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core';
import { Link, useParams } from 'react-router-dom';
import type { UserService } from '../../api/ConsoleService';
import type { ModelsService } from '../../api/models';
import type { ManagedModel } from '../../api/types';
import { PageStateSection } from '../../components/states/PageStateSection';
import { useServiceData } from '../../hooks/useServiceData';
import { modelNotFound, modelPath } from './modelUtils';
import { ModelWizard } from './ModelWizard';

type Props = { service: ModelsService & UserService };

/**
 * Edits a model deployment at /models/:namespace/:name/edit in the deploy wizard. It loads the
 * model once, as the details page does, so the wizard starts from the version the user saw.
 */
export const ModelEditPage: React.FC<Props> = ({ service }) => {
  const { namespace = '', name = '' } = useParams();
  const [model, loaded, error, refresh] = useServiceData<ManagedModel | undefined>(
    () => service.getModel(namespace, name),
    undefined,
    0,
  );
  if (model) {
    return <ModelWizard key={`${namespace}/${name}`} service={service} model={model} />;
  }
  const detailsPath = modelPath({ namespace, name });
  return (
    <>
      <PageStateSection
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
        loaded={loaded}
        error={error}
        onRetry={() => void refresh()}
        subject="Models"
        object="model"
        loadingLabel="Loading model"
        notFound={modelNotFound(namespace, name)}
      />
    </>
  );
};

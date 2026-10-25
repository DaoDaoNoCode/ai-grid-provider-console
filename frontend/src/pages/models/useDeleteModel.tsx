import { useState } from 'react';
import { Stack } from '@patternfly/react-core';
import { ServiceError } from '../../api/ConsoleService';
import type { ModelsService } from '../../api/models';
import type { SubscriptionsService } from '../../api/subscriptions';
import type { ManagedModel } from '../../api/types';
import { DeleteModal } from '../../components/DeleteModal';
import { ReferencingSubscriptions } from './ModelReferences';

export type ModelDeleteService = ModelsService & Pick<SubscriptionsService, 'listSubscriptions'>;

const keyOf = (model: ManagedModel) => `${model.namespace}/${model.name}`;

const deleteErrorOf = (err: unknown) =>
  err instanceof ServiceError && err.isNotImplemented
    ? new Error('Deleting models is not available on this backend yet.')
    : err instanceof Error
      ? err
      : new Error('The deployment could not be deleted.');

/**
 * Deleting a model deployment, the same from its list row and its page: returns `confirmDelete`
 * and the modal to render. `models` is the latest list, so a retry after a failed delete sends
 * the version the backend has now; `refresh` reloads it.
 */
export const useDeleteModel = (
  service: ModelDeleteService,
  { models, refresh, onDeleted }: { models: ManagedModel[]; refresh: () => void; onDeleted: () => void },
): [(model: ManagedModel) => void, React.ReactNode] => {
  const [selected, setSelected] = useState<ManagedModel>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<Error>();

  const confirmDelete = (model: ManagedModel) => {
    setSelected(model);
    setError(undefined);
  };

  const remove = async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setError(undefined);
    // The first attempt sends the version the user confirmed. After a failed delete the list
    // reloads, so a retry sends the version the backend has now.
    const current = error ? (models.find((m) => keyOf(m) === keyOf(selected)) ?? selected) : selected;
    try {
      await service.deleteModel(current.namespace, current.name, current.resourceVersion);
      setSelected(undefined);
      onDeleted();
    } catch (err) {
      setError(deleteErrorOf(err));
      refresh();
    } finally {
      setDeleting(false);
    }
  };

  const modal = selected && (
    <DeleteModal
      title="Delete model deployment?"
      deleteName={selected.displayName ?? selected.name}
      onClose={() => {
        if (!deleting) {
          setSelected(undefined);
          setError(undefined);
        }
      }}
      onDelete={() => void remove()}
      deleting={deleting}
      error={error}
      testId="delete-deployment-modal"
    >
      <Stack hasGutter>
        <p>
          Delete this model, its saved deployment, and its location placement resources? Remove references from
          subscriptions and authorization policies first.
        </p>
        <ReferencingSubscriptions service={service} model={selected} />
      </Stack>
    </DeleteModal>
  );

  return [confirmDelete, modal];
};

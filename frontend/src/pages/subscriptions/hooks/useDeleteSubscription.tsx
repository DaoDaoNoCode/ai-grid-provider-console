// Ported from krisv/ai-grid-cloud-provider-poc src/app/hooks/useDeleteSubscription.ts and
// src/app/pages/subscriptions/DeleteSubscriptionModal.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/DeleteSubscriptionModal.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// In the shape of the console's other deletes (useDeleteModel, useDeleteOrganization).
import { useState } from 'react';
import { Stack, StackItem } from '@patternfly/react-core';
import { ServiceError } from '../../../api/ConsoleService';
import type { SubscriptionsService } from '../../../api/subscriptions';
import type { MaaSSubscription } from '../../../api/types';
import { DeleteModal } from '../../../components/DeleteModal';

const deleteErrorOf = (err: unknown) =>
  err instanceof ServiceError && err.isNotImplemented
    ? new Error('Deleting subscriptions is not available on this backend yet.')
    : err instanceof ServiceError && err.status === 409
      ? new Error('This subscription changed since you opened this dialog. Check it and try again.')
      : err instanceof Error
        ? err
        : new Error('Unable to delete subscription.');

/**
 * Deleting a subscription, the same from its list row and its page: returns `confirmDelete`, which
 * opens the typed-name confirmation, and the dialog to render.
 */
export const useDeleteSubscription = (
  service: SubscriptionsService,
  { onDeleted }: { onDeleted: () => void },
): [(subscription: MaaSSubscription) => void, React.ReactNode] => {
  const [selected, setSelected] = useState<MaaSSubscription>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<Error>();
  const [reloadError, setReloadError] = useState<Error>();

  const confirmDelete = (subscription: MaaSSubscription) => {
    setSelected(subscription);
    setError(undefined);
    setReloadError(undefined);
  };

  const remove = async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setError(undefined);
    setReloadError(undefined);
    // After a failed delete the dialog loads the subscription again, so a retry sends the version
    // the backend has now (as a model's delete does) while the typed name stays. The dialog stays
    // busy until that reload is in, so a retry never sends the old version.
    try {
      await service.deleteSubscription(selected.name, selected.resourceVersion);
      setSelected(undefined);
      onDeleted();
    } catch (err) {
      setError(deleteErrorOf(err));
      try {
        setSelected((await service.getSubscriptionInfo(selected.name)).subscription);
      } catch (reloadErr) {
        setReloadError(reloadErr instanceof Error ? reloadErr : new Error(String(reloadErr)));
      }
    } finally {
      setDeleting(false);
    }
  };

  const name = selected && (selected.displayName || selected.name);
  const dialog = selected && name && (
    <DeleteModal
      title="Delete subscription?"
      onClose={() => {
        if (!deleting) {
          setSelected(undefined);
          setError(undefined);
        }
      }}
      deleting={deleting}
      onDelete={() => void remove()}
      deleteName={name}
      error={error}
      reloadError={reloadError}
      testId="delete-subscription-modal"
    >
      <Stack hasGutter>
        <StackItem data-testid="delete-modal-confirmation-message">
          Are you sure you want to delete the subscription <strong>{name}</strong>?
        </StackItem>
        <StackItem>The automatically created authorization policy will also be deleted.</StackItem>
      </Stack>
    </DeleteModal>
  );

  return [confirmDelete, dialog];
};

import { useState } from 'react';
import { ServiceError } from '../../api/ConsoleService';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization } from '../../api/types';
import { DeleteModal } from '../../components/DeleteModal';
import { ORGANIZATION_CHANGED } from './serverErrors';

const deleteError = (err: unknown) =>
  err instanceof ServiceError && err.isNotImplemented
    ? new Error('Deleting organizations is not available on this backend yet.')
    : err instanceof ServiceError && err.status === 409
      ? new Error(ORGANIZATION_CHANGED)
      : err instanceof Error
        ? err
        : new Error('The organization could not be deleted.');

/**
 * Deleting an organization, the same from its list row and its page: returns `confirmDelete`,
 * which opens the typed-name confirmation for an organization, and the modal to render.
 */
export const useDeleteOrganization = (
  service: OrganizationsService,
  onDeleted: () => void,
): [(organization: Organization) => void, React.ReactNode] => {
  const [selected, setSelected] = useState<Organization>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<Error>();

  const confirmDelete = (organization: Organization) => {
    setSelected(organization);
    setError(undefined);
  };

  const remove = async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setError(undefined);
    try {
      await service.deleteOrganization(selected.id, selected.resourceVersion);
      setSelected(undefined);
      onDeleted();
    } catch (err) {
      setError(deleteError(err));
    } finally {
      setDeleting(false);
    }
  };

  const modal = selected && (
    <DeleteModal
      title="Delete organization?"
      deleteName={selected.name}
      deleting={deleting}
      error={error}
      onClose={() => {
        if (!deleting) {
          setSelected(undefined);
          setError(undefined);
        }
      }}
      onDelete={() => void remove()}
      testId="delete-tenant-modal"
    >
      <p>Delete this organization and its saved identity provider configuration?</p>
    </DeleteModal>
  );

  return [confirmDelete, modal];
};

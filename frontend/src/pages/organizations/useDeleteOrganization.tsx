import { useState } from 'react';
import { ServiceError } from '../../api/ConsoleService';
import type { OrganizationsService } from '../../api/organizations';
import type { Organization } from '../../api/types';
import { DeleteModal } from '../../components/DeleteModal';

const deleteError = (err: unknown) =>
  err instanceof ServiceError && err.isNotImplemented
    ? new Error('Deleting organizations is not available on this backend yet.')
    : err instanceof ServiceError && err.isConflict
      ? new Error('This organization changed since you opened this dialog. Check it and try again.')
      : err instanceof Error
        ? err
        : new Error('The organization could not be deleted.');

/**
 * Deleting an organization, the same from its list row and its page: returns `confirmDelete`,
 * which opens the typed-name confirmation for an organization, and the modal to render.
 * `organizations` is the latest the page loaded, so a retry after a failed delete sends the
 * version the backend has now (as useDeleteModel does); `refresh` reloads them.
 */
export const useDeleteOrganization = (
  service: OrganizationsService,
  { organizations, refresh, onDeleted }: { organizations: Organization[]; refresh: () => void; onDeleted: () => void },
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
    // The first attempt sends the version the user confirmed. After a failed delete the page
    // reloads, so a retry sends the version the backend has now; the typed name stays.
    const current = error ? (organizations.find((o) => o.id === selected.id) ?? selected) : selected;
    try {
      await service.deleteOrganization(current.id, current.resourceVersion);
      setSelected(undefined);
      onDeleted();
    } catch (err) {
      setError(deleteError(err));
      refresh();
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

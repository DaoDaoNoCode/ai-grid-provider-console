import { useState } from 'react';
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Stack } from '@patternfly/react-core';
import { ServiceError } from '../../api/ConsoleService';
import type { GridCluster } from '../../api/types';

export type MembershipChange = { cluster: GridCluster; join: boolean };

type Props = MembershipChange & {
  /** Makes the change; the modal closes once it resolves and shows the error if it throws. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

const errorMessage = (err: unknown, join: boolean) => {
  if (err instanceof ServiceError && err.isNotImplemented) {
    return `${join ? 'Adding clusters to' : 'Removing clusters from'} AI Grid is not available on this backend yet.`;
  }
  return err instanceof Error ? err.message : 'The cluster could not be changed.';
};

/** Confirms adding a cluster to AI Grid or removing it, and keeps a failure in view. */
export const MembershipModal: React.FC<Props> = ({ cluster, join, onConfirm, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = join ? `Add ${cluster.name} to AI Grid?` : `Remove ${cluster.name} from AI Grid?`;

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err, join));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen variant="small" onClose={busy ? undefined : onClose} data-testid="cluster-membership-modal">
      <ModalHeader title={title} titleIconVariant={join ? undefined : 'warning'} />
      <ModalBody>
        <Stack hasGutter>
          <p>
            {join
              ? 'AI Grid provisions the cluster, and model placements can then choose its location.'
              : 'Model placements stop choosing this cluster, and models already placed on it are removed from it.'}
          </p>
          {join && !cluster.location && (
            <Alert isInline isPlain variant="warning" title="This cluster has no location label">
              Models can’t be deployed to it until it has one.
            </Alert>
          )}
          {error && (
            <Alert
              isInline
              variant="danger"
              title={join ? 'Unable to add the cluster' : 'Unable to remove the cluster'}
            >
              {error}
            </Alert>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button variant={join ? 'primary' : 'danger'} isLoading={busy} isDisabled={busy} onClick={() => void confirm()}>
          {join ? 'Add to AI Grid' : 'Remove'}
        </Button>
        <Button variant="link" isDisabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

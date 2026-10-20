import { useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core';

/**
 * Asks before throwing away a form's edits (PatternFly: an in-page wizard or form confirms before
 * Cancel discards unsaved changes). Returns `requestLeave`, to call where Cancel would leave, and
 * the modal to render. Without edits, `requestLeave` leaves at once.
 */
export const useConfirmDiscard = (isDirty: boolean, leave: () => void): [() => void, React.ReactNode] => {
  const [isOpen, setIsOpen] = useState(false);
  const requestLeave = () => (isDirty ? setIsOpen(true) : leave());
  const modal = (
    <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} variant="small" data-testid="discard-changes-modal">
      <ModalHeader title="Discard changes?" titleIconVariant="warning" />
      <ModalBody>The information you entered on this page will be lost.</ModalBody>
      <ModalFooter>
        <Button variant="danger" onClick={leave}>
          Discard
        </Button>
        <Button variant="link" onClick={() => setIsOpen(false)}>
          Keep editing
        </Button>
      </ModalFooter>
    </Modal>
  );
  return [requestLeave, modal];
};

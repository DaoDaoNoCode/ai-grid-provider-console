// The model's status dialog from the Models list, following
// jgiardino/ai-grid-provider-console@a4e6090 ModelStatusModal.tsx: Saved to Git and Syncing say what Git and Argo CD are doing; Partially ready
// lists each cluster's status. The design's Sync now button waits until after the 11-06 freeze.
import { Flex, FlexItem, Label, Modal, ModalBody, ModalHeader, Stack, Title } from '@patternfly/react-core';
import { statusLabelProps } from '../../utilities/status';
import type { ClusterRegions } from './clusterRegions';
import { ModelClustersTable } from './ModelClustersTable';
import { gitStatusMessage } from './modelStatusInfo';
import { titleOf, type ModelView } from './modelView';
import { statusModalLayout } from './statusModalLayout';

type Props = {
  model: ModelView;
  clusters: ClusterRegions;
  onClose: () => void;
};

export const ModelStatusModal: React.FC<Props> = ({ model, clusters, onClose }) => {
  const title = titleOf(model);
  const gitMessage = gitStatusMessage[model.state];
  return (
    <Modal
      {...statusModalLayout}
      isOpen
      onClose={onClose}
      aria-label={`${title} status`}
      data-testid="model-status-modal"
    >
      <ModalHeader>
        <Title headingLevel="h1" size="2xl">
          <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>{title}</FlexItem>
            <FlexItem>
              <Label isCompact {...statusLabelProps(model.state)} variant="filled">
                {model.state}
              </Label>
            </FlexItem>
          </Flex>
        </Title>
        <p>
          <strong>Model status</strong>
        </p>
      </ModalHeader>
      <ModalBody>
        {gitMessage ? (
          <p data-testid="model-status-modal-message">{gitMessage}</p>
        ) : (
          <Stack hasGutter>
            <p data-testid="model-status-modal-message">The model isn’t ready on one or more of its clusters.</p>
            <ModelClustersTable model={model} clusters={clusters} isNested opensClusters={false} />
          </Stack>
        )}
      </ModalBody>
    </Modal>
  );
};

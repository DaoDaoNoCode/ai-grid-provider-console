// The model's status dialog from the Models list, following
// jgiardino/ai-grid-provider-console@a4e6090 ModelStatusModal.tsx: Saved to Git and Syncing say what Git and Argo CD are doing; Partially ready
// lists each cluster's status. The design's Sync now button waits until after the 11-06 freeze.
import { Flex, FlexItem, Label, Modal, ModalBody, ModalHeader, Stack, Title } from '@patternfly/react-core';
import { statusLabelProps } from '../../utilities/status';
import type { ClusterPlaces } from './clusterPlaces';
import { ModelClustersTable } from './ModelClustersTable';
import { gitStatusMessage } from './modelStatusInfo';
import { titleOf, type ModelView } from './modelView';
import { statusModalLayout } from './statusModalLayout';

type Props = {
  model: ModelView;
  clusters: ClusterPlaces;
  onClose: () => void;
};

export const ModelStatusContent: React.FC<Pick<Props, 'model' | 'clusters'>> = ({ model, clusters }) => {
  const title = titleOf(model);
  const gitMessage = gitStatusMessage[model.state];
  return (
    <>
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
          <p>{gitMessage}</p>
        ) : (
          <Stack hasGutter>
            <p>The model isn’t ready on one or more of its clusters.</p>
            <ModelClustersTable model={model} clusters={clusters} isNested opensClusters={false} />
          </Stack>
        )}
      </ModalBody>
    </>
  );
};

export const ModelStatusModal: React.FC<Props> = ({ model, clusters, onClose }) => (
  <Modal {...statusModalLayout} isOpen onClose={onClose} aria-label={`${titleOf(model)} status`}>
    <ModelStatusContent model={model} clusters={clusters} />
  </Modal>
);

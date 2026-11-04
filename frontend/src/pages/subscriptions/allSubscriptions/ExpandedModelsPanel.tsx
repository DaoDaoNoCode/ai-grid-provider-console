// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/shared/ExpandedModelsPanel.tsx
// upstream commit: 6f47c0f775d19c89ef02f74d192b32dc7d3c669d
// The console adds the Clusters column (the clusters the model's placement chose, by name) and moves
// the model's description into a popover by its name.
import { Button, Flex, Label, LabelGroup, Popover, Skeleton, Tooltip } from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { TableRowTitleDescription } from '../../../components/TableRowTitleDescription';
import type { ModelView } from '../../models/modelView';
import type { SubscriptionModelRef } from '../../../gen/ai_grid/v1/subscription_type_pb';
import { EMPTY_VALUE } from '../../../utilities/format';
import { formatTokenRateLimitLine } from '../../../utilities/rateLimits';
import { modelForRef, refKey, refTitleOf } from '../subscriptionText';

/** Whether the models have loaded: until then, or when they fail, no clusters are known. */
export type ModelsState = 'loading' | 'loaded' | 'failed';

type Props = {
  modelRefs: SubscriptionModelRef[];
  /** The models, for each ref's clusters, display name and description. */
  models: ModelView[];
  modelsState: ModelsState;
};

/** Where the model is deployed: the clusters its placement chose, by name (status.placement.selected_clusters). */
const clustersCell = (model: ModelView | undefined, modelsState: ModelsState): React.ReactNode => {
  if (modelsState === 'loading') {
    return <Skeleton width="6rem" screenreaderText="Loading clusters" />;
  }
  if (modelsState === 'failed') {
    return (
      <Tooltip content="Unable to load models.">
        <span tabIndex={0}>{EMPTY_VALUE}</span>
      </Tooltip>
    );
  }
  const clusters = model?.selectedClusters ?? [];
  return clusters.length ? (
    <LabelGroup numLabels={4}>
      {clusters.map((cluster) => (
        <Label key={cluster} color="grey" isCompact>
          {cluster}
        </Label>
      ))}
    </LabelGroup>
  ) : (
    EMPTY_VALUE
  );
};

const tokenLimits = (ref: SubscriptionModelRef): string => {
  if (ref.unlimited) {
    return 'Unlimited';
  }
  return ref.tokenRateLimits.length
    ? ref.tokenRateLimits.map(({ limit, window }) => formatTokenRateLimitLine(Number(limit), window)).join(', ')
    : EMPTY_VALUE;
};

/** A subscription's models in its row's expansion: name, where each runs, and its token limits. */
export const ExpandedModelsPanel: React.FC<Props> = ({ modelRefs, models, modelsState }) => (
  <Table aria-label="Subscription models" variant="compact" data-testid="subscription-models-expanded-panel">
    <Thead>
      <Tr>
        <Th width={40}>Model name</Th>
        <Th width={30}>Clusters</Th>
        <Th width={30}>Token limits</Th>
      </Tr>
    </Thead>
    <Tbody>
      {modelRefs.length === 0 ? (
        <Tr>
          <Td colSpan={3}>No models</Td>
        </Tr>
      ) : (
        modelRefs.map((ref) => {
          const model = modelForRef(models, ref);
          const title = refTitleOf(ref, model);
          const description = ref.description || model?.description;
          return (
            <Tr key={refKey(ref)} data-testid="expanded-subscription-model-row">
              <Td dataLabel="Model name">
                <TableRowTitleDescription
                  title={
                    <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                      <strong>{title}</strong>
                      {description && (
                        <Popover headerContent={title} bodyContent={description}>
                          <Button
                            variant="plain"
                            hasNoPadding
                            aria-label={`About ${title}`}
                            icon={<OutlinedQuestionCircleIcon />}
                          />
                        </Popover>
                      )}
                    </Flex>
                  }
                  subtitle={<code>{ref.name}</code>}
                />
              </Td>
              <Td dataLabel="Clusters" data-testid="expanded-subscription-model-clusters">
                {clustersCell(model, modelsState)}
              </Td>
              <Td dataLabel="Token limits" data-testid="expanded-subscription-model-token-limits">
                {tokenLimits(ref)}
              </Td>
            </Tr>
          );
        })
      )}
    </Tbody>
  </Table>
);

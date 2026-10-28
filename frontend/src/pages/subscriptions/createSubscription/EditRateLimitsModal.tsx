// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/createSubscription/EditRateLimitsModal.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/createSubscription/EditRateLimitsModal.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import { useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import type { TokenRateLimit } from '../../../api/types';
import type { RateLimit } from '../../../utilities/rateLimits';
import {
  DEFAULT_RATE_LIMIT,
  getCountDigitError,
  getCountError,
  getTimeDigitError,
  getTimeError,
  parseWindow,
  rateLimitExceedsMaxDigits,
  rateLimitsSchema,
  toRateLimit,
  toTokenRateLimit,
} from '../../../utilities/rateLimits';
import { RateLimitRow } from './RateLimitRow';

type Props = {
  modelName: string;
  rateLimits: TokenRateLimit[];
  onSave: (rateLimits: TokenRateLimit[]) => void;
  onClose: () => void;
};

const title = 'Edit token limits';

/** Edits one model's token limits; a model without limits starts with 1,000 tokens per hour. */
export const EditRateLimitsModal: React.FC<Props> = ({ modelName, rateLimits, onSave, onClose }) => {
  const [localLimits, setLocalLimits] = useState<RateLimit[]>(() =>
    rateLimits.length > 0 ? rateLimits.map(toRateLimit) : [{ ...DEFAULT_RATE_LIMIT }],
  );
  const [submitted, setSubmitted] = useState(false);
  // Windows the form cannot show, such as one written in Git by hand: their rows start without a
  // time, so Save refuses them until the user enters one, instead of saving a guess.
  const unreadableWindows = rateLimits.map((l) => l.window).filter((window) => parseWindow(window) === undefined);

  const validation = rateLimitsSchema.safeParse(localLimits);
  const hasDigitLimitError = localLimits.some(rateLimitExceedsMaxDigits);
  const canSave = validation.success && !hasDigitLimitError;

  const handleSave = () => {
    setSubmitted(true);
    if (canSave) {
      onSave(localLimits.map(toTokenRateLimit));
    }
  };

  return (
    <Modal isOpen onClose={onClose} variant="medium" aria-label={title}>
      <ModalHeader
        title={title}
        description={
          <>
            Limit how many tokens each member of this subscription can use with <b>{modelName}</b>.
          </>
        }
      />
      <ModalBody>
        {/* A form, so the token limits' labels are PatternFly form labels. */}
        <Form onSubmit={(event) => event.preventDefault()}>
          <Stack hasGutter>
            {unreadableWindows.length > 0 && (
              <StackItem>
                <Alert
                  variant="warning"
                  isInline
                  title={`The console cannot read the saved window ${unreadableWindows.map((w) => `"${w}"`).join(', ')}`}
                >
                  A window is a whole number from 1 to 9999 followed by s, m or h, such as 30s, 5m or 24h. Enter a time
                  for that limit to replace it.
                </Alert>
              </StackItem>
            )}
            {localLimits.map((limit, index) => (
              <StackItem key={index}>
                <RateLimitRow
                  id={`edit-token-limit-${index}`}
                  rateLimit={limit}
                  onChange={(updated) =>
                    setLocalLimits((prev) => prev.map((item, i) => (i === index ? updated : item)))
                  }
                  onRemove={() => setLocalLimits((prev) => prev.filter((_, i) => i !== index))}
                  showRemove={localLimits.length > 1}
                  countError={submitted ? getCountError(limit) : undefined}
                  timeError={submitted ? getTimeError(limit) : undefined}
                  countDigitError={getCountDigitError(limit)}
                  timeDigitError={getTimeDigitError(limit)}
                />
              </StackItem>
            ))}
            <StackItem>
              <Button
                variant="link"
                icon={<PlusCircleIcon />}
                onClick={() => setLocalLimits((prev) => [...prev, { ...DEFAULT_RATE_LIMIT }])}
                data-testid="add-token-rate-limit"
              >
                Add token limit
              </Button>
            </StackItem>
          </Stack>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSave}
          isDisabled={hasDigitLimitError || (submitted && !canSave)}
          data-testid="save-rate-limits"
        >
          Save
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

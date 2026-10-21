// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/createSubscription/RateLimitRow.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/createSubscription/RateLimitRow.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import {
  Button,
  Flex,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  NumberInput,
  Stack,
  StackItem,
  ValidatedOptions,
} from '@patternfly/react-core';
import { MinusCircleIcon } from '@patternfly/react-icons';
import type { RateLimit } from '../../../utilities/rateLimits';
import { UNIT_OPTIONS } from '../../../utilities/rateLimits';

type Props = {
  id: string;
  rateLimit: RateLimit;
  onChange: (rateLimit: RateLimit) => void;
  onRemove?: () => void;
  showRemove: boolean;
  countError?: string;
  timeError?: string;
  countDigitError?: string;
  timeDigitError?: string;
};

const COUNT_STEP = 1000;

/** Parses a number input: empty is NaN (required), anything unparsable keeps the old value. */
const parsed = (value: string, previous: number): number => {
  if (value === '') return NaN;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? previous : Math.min(Number.MAX_SAFE_INTEGER, n);
};

/** One token limit, "<Tokens> per <time> <unit>", each part under a visible label. */
export const RateLimitRow: React.FC<Props> = ({
  id,
  rateLimit,
  onChange,
  onRemove,
  showRemove,
  countError,
  timeError,
  countDigitError,
  timeDigitError,
}) => {
  const countMessage = countDigitError ?? countError;
  const timeMessage = timeDigitError ?? timeError;

  return (
    <Stack hasGutter>
      <StackItem>
        <Flex alignItems={{ default: 'alignItemsFlexEnd' }} spaceItems={{ default: 'spaceItemsMd' }}>
          <FormGroup label="Tokens" fieldId={`${id}-count-input`}>
            <NumberInput
              validated={countMessage != null ? ValidatedOptions.error : ValidatedOptions.default}
              id={`${id}-count`}
              data-testid={`${id}-count`}
              inputName={`${id}-count-input`}
              inputProps={{ id: `${id}-count-input` }}
              inputAriaLabel="Tokens"
              value={Number.isNaN(rateLimit.count) ? '' : rateLimit.count}
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              widthChars={9}
              onMinus={() =>
                onChange({ ...rateLimit, count: Math.max(1, (rateLimit.count || COUNT_STEP) - COUNT_STEP) })
              }
              onPlus={() =>
                onChange({
                  ...rateLimit,
                  count: Math.min(Number.MAX_SAFE_INTEGER, (rateLimit.count || 0) + COUNT_STEP),
                })
              }
              onChange={(event: React.FormEvent<HTMLInputElement>) =>
                onChange({ ...rateLimit, count: parsed(event.currentTarget.value, rateLimit.count) })
              }
            />
          </FormGroup>
          <FormGroup label="Per" fieldId={`${id}-time-input`}>
            <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
              <NumberInput
                validated={timeMessage != null ? ValidatedOptions.error : ValidatedOptions.default}
                id={`${id}-time`}
                data-testid={`${id}-time`}
                inputName={`${id}-time-input`}
                inputProps={{ id: `${id}-time-input` }}
                inputAriaLabel="Per"
                value={Number.isNaN(rateLimit.time) ? '' : rateLimit.time}
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                widthChars={3}
                onMinus={() => onChange({ ...rateLimit, time: Math.max(1, (rateLimit.time || 1) - 1) })}
                onPlus={() =>
                  onChange({ ...rateLimit, time: Math.min(Number.MAX_SAFE_INTEGER, (rateLimit.time || 0) + 1) })
                }
                onChange={(event: React.FormEvent<HTMLInputElement>) =>
                  onChange({ ...rateLimit, time: parsed(event.currentTarget.value, rateLimit.time) })
                }
              />
              <FormSelect
                id={`${id}-unit`}
                data-testid={`${id}-unit`}
                aria-label="Time unit"
                value={rateLimit.unit}
                onChange={(_event, value) => onChange({ ...rateLimit, unit: value as RateLimit['unit'] })}
              >
                {UNIT_OPTIONS.map((option) => (
                  <FormSelectOption key={option.value} value={option.value} label={option.label} />
                ))}
              </FormSelect>
            </Flex>
          </FormGroup>
          {showRemove && (
            <Button
              variant="plain"
              aria-label="Remove token limit"
              onClick={onRemove}
              data-testid={`${id}-remove`}
              icon={<MinusCircleIcon />}
            />
          )}
        </Flex>
      </StackItem>
      <StackItem>
        <FormHelperText data-testid={`${id}-helper-text`}>
          <HelperText>
            {countMessage != null && <HelperTextItem variant="error">{countMessage}</HelperTextItem>}
            {timeMessage != null && <HelperTextItem variant="error">{timeMessage}</HelperTextItem>}
          </HelperText>
        </FormHelperText>
      </StackItem>
    </Stack>
  );
};

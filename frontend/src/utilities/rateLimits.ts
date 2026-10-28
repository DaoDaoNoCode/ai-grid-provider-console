// Ported from krisv/ai-grid-cloud-provider-poc src/app/utilities/rateLimits.ts at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/utilities/rateLimits.ts
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import { z } from 'zod';
import type { TokenRateLimit } from '../api/types';

/** A token limit as the form edits it: count tokens per time unit(s). */
export type RateLimit = { count: number; time: number; unit: 'hour' | 'minute' | 'second' };

const WINDOW_SUFFIX_TO_UNIT: Record<string, RateLimit['unit']> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
};

const UNIT_TO_WINDOW_SUFFIX: Record<RateLimit['unit'], string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
};

/**
 * The windows a MaaSSubscription accepts: a whole number from 1 to 9999 and one unit, s, m or h
 * ("Days (d) are not supported; use hours instead"). This is the CRD's pattern for
 * spec.modelRefs[].tokenRateLimits[].window (opendatahub-io/models-as-a-service
 * maas-controller/api/maas/v1alpha1/maassubscription_types.go at 4d71db2, as served by the
 * dev hub), and the backend refuses any other window on a write.
 */
const WINDOW_PATTERN = /^([1-9]\d{0,3})([smh])$/;

export const formatLocaleNumber = (value: number): string => value.toLocaleString('en-US');

export const UNIT_OPTIONS: { value: RateLimit['unit']; label: string }[] = [
  { value: 'hour', label: 'hour' },
  { value: 'minute', label: 'minute' },
  { value: 'second', label: 'second' },
];

/** Reads a window such as "24h" or "30m"; undefined for anything the CRD does not accept. */
export const parseWindow = (window: string): { time: number; unit: RateLimit['unit'] } | undefined => {
  const match = WINDOW_PATTERN.exec(window);
  return match ? { time: parseInt(match[1], 10), unit: WINDOW_SUFFIX_TO_UNIT[match[2]] } : undefined;
};

/** Shows a window as "1 hour" or "24 hours"; a window it cannot read is shown as it is. */
export const formatWindow = (window: string): string => {
  const parsed = parseWindow(window);
  if (!parsed) return window;
  return `${formatLocaleNumber(parsed.time)} ${parsed.unit}${parsed.time === 1 ? '' : 's'}`;
};

export const formatTokenRateLimitLine = (limit: number, window: string): string =>
  `${formatLocaleNumber(limit)} / ${formatWindow(window)}`;

/**
 * Converts a BFF TokenRateLimit to the UI's RateLimit form. A window the form cannot read gets no
 * time, so the form cannot save it until a time is entered.
 */
export const toRateLimit = (trl: TokenRateLimit): RateLimit => {
  const parsed = parseWindow(trl.window);
  return { count: trl.limit, time: parsed?.time ?? NaN, unit: parsed?.unit ?? 'hour' };
};

/** Converts the UI's RateLimit form back to a BFF TokenRateLimit. */
export const toTokenRateLimit = (rl: RateLimit): TokenRateLimit => ({
  limit: rl.count,
  window: `${rl.time}${UNIT_TO_WINDOW_SUFFIX[rl.unit]}`,
});

export const DEFAULT_RATE_LIMIT: RateLimit = { count: 1000, time: 1, unit: 'hour' };
export const MAX_VALUE = 1_000_000_000;
export const MAX_WINDOW_VALUE = 9_999;

export const exceedsTokenLimit = (n: number): boolean => !Number.isNaN(n) && Math.trunc(Math.abs(n)) > MAX_VALUE;

export const exceedsWindowLimit = (n: number): boolean =>
  !Number.isNaN(n) && Math.trunc(Math.abs(n)) > MAX_WINDOW_VALUE;

export const rateLimitExceedsMaxDigits = (limit: RateLimit): boolean =>
  exceedsTokenLimit(limit.count) || exceedsWindowLimit(limit.time);

export const rateLimitSchema = z.object({
  count: z
    .number()
    .int()
    .min(1, 'Token count must be greater than 0')
    .max(MAX_VALUE, 'Token count exceeds maximum allowed value'),
  time: z
    .number()
    .int()
    .min(1, 'Time value must be greater than 0')
    .max(MAX_WINDOW_VALUE, 'Time value exceeds maximum allowed value'),
  unit: z.enum(['hour', 'minute', 'second']),
});

export const rateLimitsSchema = z.array(rateLimitSchema).min(1, 'At least one token rate limit is required');

export const getCountError = (limit: RateLimit): string | undefined => {
  if (Number.isNaN(limit.count)) {
    return 'Token count is required';
  }
  const result = rateLimitSchema.shape.count.safeParse(limit.count);
  return result.success ? undefined : result.error.issues[0].message;
};

export const getTimeError = (limit: RateLimit): string | undefined => {
  if (Number.isNaN(limit.time)) {
    return 'Time value is required';
  }
  const result = rateLimitSchema.shape.time.safeParse(limit.time);
  return result.success ? undefined : result.error.issues[0].message;
};

export const getCountDigitError = (limit: RateLimit): string | undefined =>
  exceedsTokenLimit(limit.count) ? 'Token count exceeds maximum allowed value' : undefined;

export const getTimeDigitError = (limit: RateLimit): string | undefined =>
  exceedsWindowLimit(limit.time) ? 'Time value exceeds maximum allowed value' : undefined;

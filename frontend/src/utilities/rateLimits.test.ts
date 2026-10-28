import { describe, expect, it } from 'vitest';
import { formatTokenRateLimitLine, formatWindow, parseWindow, toRateLimit, toTokenRateLimit } from './rateLimits';

// Windows the MaaSSubscription CRD accepts, `^[1-9]\d{0,3}(s|m|h)$`: every unit, both ends of the range.
const accepted = ['1s', '30s', '9999s', '1m', '5m', '60m', '9999m', '1h', '24h', '100h', '8784h', '9999h'];

// Windows the CRD refuses: other units and Go durations, combined units, zero, leading zeros,
// more than four digits, upper case, spaces, fractions, signs and the human-readable form.
const refused = [
  '',
  'h',
  '1',
  '500ms',
  '2d',
  '1w',
  '1h30m',
  '0h',
  '0s',
  '01h',
  '10000h',
  '1H',
  ' 1h',
  '1h ',
  '1 h',
  '1.5h',
  '-1h',
  '+1h',
  '1 hour',
  '24 hours',
];

describe('parseWindow', () => {
  it.each([
    ['1s', 1, 'second'],
    ['30m', 30, 'minute'],
    ['24h', 24, 'hour'],
    ['9999h', 9999, 'hour'],
  ] as const)('reads %s as %d %s', (window, time, unit) => {
    expect(parseWindow(window)).toEqual({ time, unit });
  });

  it.each(refused)('does not read %j', (window) => {
    expect(parseWindow(window)).toBeUndefined();
  });
});

describe('the token limit form', () => {
  it.each(accepted)('saves %s back unchanged', (window) => {
    expect(toTokenRateLimit(toRateLimit({ limit: 1000, window }))).toEqual({ limit: 1000, window });
  });

  it.each(refused)('leaves the time of %j empty instead of guessing one', (window) => {
    const limit = toRateLimit({ limit: 1000, window });
    expect(limit.count).toBe(1000);
    expect(limit.time).toBeNaN();
  });
});

describe('formatWindow', () => {
  it.each([
    ['1s', '1 second'],
    ['30s', '30 seconds'],
    ['1m', '1 minute'],
    ['1h', '1 hour'],
    ['24h', '24 hours'],
    ['9999m', '9,999 minutes'],
  ])('shows %s as %s', (window, want) => {
    expect(formatWindow(window)).toBe(want);
  });

  it.each(['500ms', '2d', '1h30m', '0h', '1 hour'])('shows %s as it is', (window) => {
    expect(formatWindow(window)).toBe(window);
  });

  it('shows a token limit line', () => {
    expect(formatTokenRateLimitLine(100000, '1h')).toBe('100,000 / 1 hour');
    expect(formatTokenRateLimitLine(5, '1h30m')).toBe('5 / 1h30m');
  });
});

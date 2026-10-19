import { EMPTY_VALUE, formatDateTime, formatRelative, hasValue } from './format';

describe('hasValue', () => {
  it.each([undefined, null, '', []])('%j has nothing to show', (value) => expect(hasValue(value)).toBe(false));
  it.each([0, false, 'x', ['a']])('%j has something to show', (value) => expect(hasValue(value)).toBe(true));
});

describe('formatRelative', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  it.each([
    ['2026-10-19T11:59:30Z', 'just now'],
    ['2026-10-19T11:20:00Z', '40 minutes ago'],
    ['2026-10-16T12:00:00Z', '3 days ago'],
    ['2026-09-19T12:00:00Z', 'last month'],
  ])('%s reads %s', (iso, text) => expect(formatRelative(iso, now)).toBe(text));
});

it('formatDateTime leaves a missing time missing', () => {
  expect(formatDateTime(undefined)).toBeUndefined();
  expect(formatDateTime('2026-09-01T09:00:00Z')).toMatch(/2026/);
  expect(EMPTY_VALUE).toBe('—');
});

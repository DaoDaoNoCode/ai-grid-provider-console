/** What every page shows for a value that isn't set. */
export const EMPTY_VALUE = '—';

/** True when a value has something to show (not undefined, null, an empty string or an empty list). */
export const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

/** A date and time in the reader's locale, the same size and style as the text around it. */
export const formatDateTime = (iso: string | undefined): string | undefined =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : undefined;

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** How long ago a time was, for example "3 days ago"; "just now" under a minute. */
export const formatRelative = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
};

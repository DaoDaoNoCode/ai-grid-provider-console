/** What every page shows for a value that isn't set. */
export const EMPTY_VALUE = '—';

/** True when a value has something to show (not undefined, null, an empty string or an empty list). */
export const hasValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

/** A date and time in the reader's locale, the same size and style as the text around it. */
export const formatDateTime = (iso: string | undefined): string | undefined =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : undefined;

import type { GetStorage } from '../utilities/signInAgain';

/**
 * Reads a JSON array kept in the tab's session storage. Every access is guarded: storage can be
 * blocked (a private window, a policy), full, or hold something another version of the console
 * wrote. Without it the console still works, it only forgets on reload.
 */
export const readRecords = <T>(storage: GetStorage, key: string, isRecord: (value: unknown) => value is T): T[] => {
  try {
    const raw = storage().getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

/** Keeps the array in the tab's session storage; an empty one removes the key. */
export const writeRecords = <T>(storage: GetStorage, key: string, records: T[]) => {
  try {
    if (records.length === 0) {
      storage().removeItem(key);
    } else {
      storage().setItem(key, JSON.stringify(records));
    }
  } catch {
    // Storage is blocked or full: the records live until the page reloads.
  }
};

/** Removes the key, as for a user who is no longer signed in to this tab. */
export const removeRecords = (storage: GetStorage, key: string) => {
  try {
    storage().removeItem(key);
  } catch {
    // Storage is blocked: nothing was kept there.
  }
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

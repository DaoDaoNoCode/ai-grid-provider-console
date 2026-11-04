import type { GetStorage } from '../utilities/signInAgain';

/** A session storage of a test's own, which it can read, seed, or make fail. */
export const memoryStorage = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
  const get: GetStorage = () => storage;
  return { get, values };
};

/** A storage the browser refuses: reaching it throws, as window.sessionStorage can when blocked. */
export const blockedStorage: GetStorage = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};

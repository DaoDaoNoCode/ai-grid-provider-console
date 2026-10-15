import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data from the service and optionally re-polls it.
 * Returns [data, loaded, error, refresh].
 */
export const useServiceData = <T,>(
  request: () => Promise<T>,
  initial: T,
  pollIntervalMs = 30000,
): [T, boolean, Error | undefined, () => Promise<void>] => {
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const requestRef = useRef(request);
  requestRef.current = request;

  const refresh = useCallback(async () => {
    try {
      const result = await requestRef.current();
      setData(result);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await refresh();
      }
    };
    void run();
    if (pollIntervalMs <= 0) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void run(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh, pollIntervalMs]);

  return [data, loaded, error, refresh];
};

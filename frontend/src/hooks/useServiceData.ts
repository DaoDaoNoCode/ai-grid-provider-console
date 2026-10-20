import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Loads data from the service and optionally re-polls it.
 * Returns [data, loaded, error, refresh].
 */
export const useServiceData = <T>(
  request: () => Promise<T>,
  initial: T,
  pollIntervalMs = 30000,
): [T, boolean, Error | undefined, () => Promise<void>] => {
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const requestRef = useRef(request);
  // Numbers each request, so a response that arrives after a newer request was started is dropped.
  const latestRef = useRef(0);
  // True while the newest request is unanswered. A poll waits for it rather than replacing it, so a
  // backend slower than the poll interval still gets its answers shown.
  const pendingRef = useRef(false);
  // Keep the latest request without re-running the effect; refs are written after render, not during it.
  useLayoutEffect(() => {
    requestRef.current = request;
  });

  const refresh = useCallback(async () => {
    const id = ++latestRef.current;
    pendingRef.current = true;
    try {
      const result = await requestRef.current();
      if (id !== latestRef.current) return;
      setData(result);
      setError(undefined);
    } catch (e) {
      if (id !== latestRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    }
    pendingRef.current = false;
    setLoaded(true);
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
    const timer = window.setInterval(() => {
      if (!pendingRef.current) void run();
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh, pollIntervalMs]);

  return [data, loaded, error, refresh];
};

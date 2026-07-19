import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/services/apiClient';

interface AsyncState<T> {
  data: T | null;
  error: ApiClientError | null;
  loading: boolean;
}

/**
 * Runs an async fetch on mount and whenever `deps` change, with abort on
 * cleanup so a stale response can't overwrite a newer one. Returns a `refetch`
 * for retry buttons.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    fnRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as Error).name === 'AbortError') return;
        const error =
          err instanceof ApiClientError
            ? err
            : new ApiClientError(0, 'UNKNOWN', 'Something went wrong.');
        setState((s) => ({ ...s, error, loading: false }));
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, refetch };
}

/** Debounces a rapidly-changing value (e.g. a search box) by `delay` ms. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

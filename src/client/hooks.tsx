import { Alert, Snackbar } from '@mui/material';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads data on mount and whenever `deps` change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Bilinmeyen hata');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

type Severity = 'success' | 'error' | 'info' | 'warning';
const ToastContext = createContext<(message: string, severity?: Severity) => void>(() => undefined);
export const useToast = (): ((message: string, severity?: Severity) => void) => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toast, setToast] = useState<{ message: string; severity: Severity; key: number } | null>(null);
  const show = useCallback((message: string, severity: Severity = 'success') => setToast({ message, severity, key: Date.now() }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={toast?.key}
        open={toast !== null}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

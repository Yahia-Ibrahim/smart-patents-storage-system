import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
} from '@/components/icons';
import '@/components/ui/Toast.css';

type ToastTone = 'info' | 'success' | 'warning' | 'danger';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastOptions {
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (tone: ToastTone, title: string, options?: ToastOptions) => void;
  success: (title: string, options?: ToastOptions) => void;
  error: (title: string, options?: ToastOptions) => void;
  info: (title: string, options?: ToastOptions) => void;
  warning: (title: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, tone, title, description: options.description }]);
      const duration = options.duration ?? (tone === 'danger' ? 6500 : 4500);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, options) => toast('success', title, options),
      error: (title, options) => toast('danger', title, options),
      info: (title, options) => toast('info', title, options),
      warning: (title, options) => toast('warning', title, options),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-live="polite" aria-label="Notifications">
          {toasts.map((t) => {
            const IconCmp = ICONS[t.tone];
            return (
              <div key={t.id} className={`toast toast--${t.tone}`} role="status">
                <span className="toast__icon">
                  <IconCmp size={20} />
                </span>
                <div className="toast__body">
                  <p className="toast__title">{t.title}</p>
                  {t.description && <p className="toast__desc">{t.description}</p>}
                </div>
                <button
                  type="button"
                  className="toast__close"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

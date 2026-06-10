import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning" | "cancelled";

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastRow = ToastInput & {
  id: string;
  tone: ToastTone;
  createdAt: number;
  isLeaving?: boolean;
};

const TOAST_LEAVE_DURATION_MS = 220;

type ToastContextValue = {
  toasts: ToastRow[];
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  success: (title: string, body?: string) => string;
  error: (title: string, body?: string) => string;
  info: (title: string, body?: string) => string;
  warning: (title: string, body?: string) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const defaultDurationByTone: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  cancelled: 4200,
  warning: 6000,
  error: 7000,
};

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <AlertCircle size={16} />,
  info: <Info size={16} />,
  warning: <AlertCircle size={16} />,
  cancelled: <XCircle size={16} />,
};

let toastCounter = 0;
const nextToastId = () => {
  toastCounter += 1;
  return `toast-${Date.now().toString(36)}-${toastCounter.toString(36)}`;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastRow[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    // Mark leaving first so the CSS keyframe runs, then remove after the animation finishes.
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, isLeaving: true } : toast)));
    const removeTimer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timersRef.current.delete(`${id}:leave`);
    }, TOAST_LEAVE_DURATION_MS);
    timersRef.current.set(`${id}:leave`, removeTimer);
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextToastId();
      const tone = input.tone ?? "info";
      const duration = input.durationMs ?? defaultDurationByTone[tone];
      const row: ToastRow = {
        id,
        tone,
        title: input.title,
        body: input.body,
        durationMs: duration,
        createdAt: Date.now(),
      };

      setToasts((current) => [...current, row]);

      if (duration > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      show,
      dismiss,
      success: (title, body) => show({ title, body, tone: "success" }),
      error: (title, body) => show({ title, body, tone: "error" }),
      info: (title, body) => show({ title, body, tone: "info" }),
      warning: (title, body) => show({ title, body, tone: "warning" }),
    }),
    [dismiss, show, toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const ToastContainer = ({ toasts, onDismiss }: { toasts: ToastRow[]; onDismiss: (id: string) => void }) => {
  if (!toasts.length) {
    return null;
  }

  return (
    <div aria-live="polite" className="toast-stack" role="status">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone}${toast.isLeaving ? " is-leaving" : ""}`}
          role="alert"
        >
          <span className={`toast-icon toast-icon-${toast.tone}`}>{toneIcon[toast.tone]}</span>
          <div className="toast-copy">
            <strong className="toast-title">{toast.title}</strong>
            {toast.body ? <p className="toast-body">{toast.body}</p> : null}
          </div>
          <button
            aria-label="Dismiss notification"
            className="toast-dismiss"
            onClick={() => onDismiss(toast.id)}
            type="button"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};

export const useToast = () => {
  const value = useContext(ToastContext);

  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return value;
};

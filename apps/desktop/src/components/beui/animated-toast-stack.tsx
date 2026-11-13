// Adapted from beUI animated-toast-stack (MIT), https://beui.dev/components/motion/animated-toast-stack.
// See ./LICENSE. Foliune uses its toast state/timer and stack composition with
// direct unmount, visible CSS entrance, and the app's shared desktop materials.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CircleAlert, Check, Info, X } from 'lucide-react';

export interface ToastInput {
  title: string;
  status?: 'success' | 'error' | 'info';
  duration?: number | null;
  dismissible?: boolean;
  action?: { label: string; onClick: () => void };
}
interface AnimatedToast extends ToastInput { id: string; createdAt: number }
let idSeed = 0;

export function useAnimatedToastStack() {
  const [toasts, setToasts] = useState<AnimatedToast[]>([]);
  const timers = useRef(new Map<string, { timer: number; signature: string }>());
  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((input: ToastInput) => {
    const toast: AnimatedToast = {
      duration: input.status === 'error' ? 6000 : 3000,
      dismissible: true, ...input,
      id: `toast-${idSeed++}`, createdAt: Date.now(),
    };
    // A fresh ID restarts the full lifetime even for two calls in one millisecond.
    setToasts((current) => [...current.filter((item) => item.title !== toast.title || item.status !== toast.status || item.dismissible !== toast.dismissible), toast]);
    return () => dismissToast(toast.id);
  }, [dismissToast]);
  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));
    timers.current.forEach((entry, id) => {
      if (!activeIds.has(id)) { window.clearTimeout(entry.timer); timers.current.delete(id); }
    });
    toasts.forEach((toast) => {
      const duration = toast.duration;
      if (duration == null) return;
      const signature = `${toast.createdAt}:${duration}`;
      if (timers.current.get(toast.id)?.signature === signature) return;
      const timer = window.setTimeout(() => {
        timers.current.delete(toast.id);
        dismissToast(toast.id);
      }, Math.max(duration - (Date.now() - toast.createdAt), 0));
      timers.current.set(toast.id, { timer, signature });
    });
  }, [dismissToast, toasts]);
  useEffect(() => {
    const activeTimers = timers.current;
    return () => { activeTimers.forEach(({ timer }) => window.clearTimeout(timer)); activeTimers.clear(); };
  }, []);
  return useMemo(() => ({ toasts, showToast, dismissToast }), [toasts, showToast, dismissToast]);
}

export function AnimatedToastStack({ toasts, onDismiss }: {
  toasts: AnimatedToast[]; onDismiss: (id: string) => void;
}) {
  return <>{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}</>;
}

function ToastItem({ toast, onDismiss }: { toast: AnimatedToast; onDismiss: (id: string) => void }) {
  const item = useRef<HTMLLIElement>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => () => {
    if (item.current?.contains(document.activeElement) && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  }, []);
  const status = toast.status ?? 'success';
  const Icon = toast.action ? ArrowDownToLine : status === 'error' ? CircleAlert : status === 'info' ? Info : Check;
  return <li ref={item} className={`toast-item toast-${status}${toast.action ? ' toast-with-action' : ''}`} onFocusCapture={(event) => {
    if (event.relatedTarget instanceof HTMLElement && !event.relatedTarget.closest('.toast-viewport')) previousFocus.current = event.relatedTarget;
  }}>
    <div className="toast-content" role={status === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="toast-icon" aria-hidden="true" />
      <span>{toast.title}</span>
    </div>
    {toast.action && <button type="button" className="button button-primary toast-action" aria-haspopup="dialog" onClick={toast.action.onClick}>{toast.action.label}</button>}
    {toast.dismissible && <button type="button" className="toast-close" aria-label="关闭提示" onPointerDown={(event) => event.preventDefault()} onClick={() => onDismiss(toast.id)}><X size={14} aria-hidden="true" /></button>}
  </li>;
}

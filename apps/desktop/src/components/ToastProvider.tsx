import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatedToastStack, useAnimatedToastStack, type ToastInput } from './beui/animated-toast-stack';
import { currentModalHost, subscribeModalStack } from '../lib/modal-stack';
import './toast.css';

// Foliune supports macOS 11; manual popovers only exist in newer WebViews.
const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';

const ToastContext = createContext<((input: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const host = useSyncExternalStore(subscribeModalStack, currentModalHost);
  const viewport = useRef<HTMLOListElement>(null);
  // The manual popover escapes dialog clipping; its host follows actual
  // showModal order so its controls remain in the active, non-inert subtree.
  useLayoutEffect(() => {
    // A dialog can be removed in this commit before its passive cleanup
    // updates the modal stack. Wait for that notification to move the portal
    // to a connected host before entering the native top layer.
    if (supportsPopover && toasts.length && viewport.current?.isConnected && !viewport.current.matches(':popover-open')) viewport.current.showPopover();
  }, [host, toasts]);
  return <ToastContext.Provider value={showToast}>
    {children}
    {!!toasts.length && createPortal(<ol ref={viewport} popover={supportsPopover ? 'manual' : undefined} className={`toast-viewport ${supportsPopover ? '' : 'toast-viewport-legacy'}`} aria-label="操作提示"><AnimatedToastStack toasts={toasts} onDismiss={dismissToast} /></ol>, host)}
  </ToastContext.Provider>;
}

export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('useToast 必须在 ToastProvider 内使用');
  return showToast;
}

import { useLayoutEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

type Mode = 'windowed' | 'entering' | 'fullscreen' | 'exiting';
type Operation = { target: boolean; issued: boolean; deadlineReached: boolean };

// The window command can resolve before the system Space finishes resizing.
// Reconcile after its resize settles, with a bounded check if none was emitted.
const resizeQuietMs = 120;
const transitionLimitMs = 1600;
const macTransitionLimitMs = 4000;

export function useReviewFullscreen(entry: 'direct' | 'available' | undefined, onExit: (direct: boolean) => void) {
  const available = entry !== undefined && isTauri();
  const [mode, setMode] = useState<Mode>(() => available && entry === 'direct' ? 'entering' : 'windowed');
  const [error, setError] = useState('');
  const finishExit = useRef(onExit);
  const controls = useRef<{ toggle: () => void; exit: () => boolean } | null>(null);
  useLayoutEffect(() => { finishExit.current = onExit; }, [onExit]);
  useLayoutEffect(() => {
    if (!available) return;
    const host = getCurrentWindow();
    const waitsForAppKit = window.navigator.userAgent.includes('Macintosh');
    let disposed = false;
    let direct = entry === 'direct';
    let nativeFullscreen = false;
    let ownsFullscreen = false;
    let exitAfterEntry = false;
    let restoringFocus = false;
    let operation: Operation | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let transitionTimer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let issued: Promise<void> | undefined;
    let checkId = 0;

    function settle(fullscreen: boolean) {
      clearTimeout(transitionTimer);
      const requestedExit = operation?.target === false;
      operation = null;
      const wasFullscreen = nativeFullscreen;
      nativeFullscreen = fullscreen;
      if (!fullscreen) ownsFullscreen = false;
      if (wasFullscreen && !fullscreen) {
        restoringFocus = true;
        void restoreAfterExit(requestedExit);
        return;
      }
      setMode(fullscreen ? 'fullscreen' : 'windowed');
      if (fullscreen && exitAfterEntry) change(false);
      exitAfterEntry = false;
    }
    async function restoreAfterExit(requestedExit: boolean) {
      // AppKit can make the window itself first responder after leaving a Space.
      try {
        if ((requestedExit || await host.isFocused()) && !disposed) await getCurrentWebview().setFocus();
      } catch (cause) {
        console.error('无法恢复照片预览的键盘焦点：', cause);
      }
      if (disposed) return;
      restoringFocus = false;
      setMode('windowed');
      finishExit.current(direct);
    }
    function fail(target: boolean) {
      if (disposed) return;
      if (target) direct = false;
      exitAfterEntry = false;
      setError(target ? '无法进入全屏。' : '无法退出全屏。');
      settle(nativeFullscreen);
    }
    async function reconcile() {
      const current = operation;
      if (disposed || restoringFocus || (current && !current.issued)) return;
      const id = ++checkId;
      try {
        const actual = await host.isFullscreen();
        if (disposed || current !== operation || id !== checkId) return;
        if (!current || current.target === actual) settle(actual);
        else if (current.deadlineReached) fail(current.target);
      } catch {
        if (!disposed && current === operation && id === checkId && (current?.deadlineReached || !current)) {
          if (current) fail(current.target);
          else setError('无法读取窗口的全屏状态。');
        }
      }
    }
    const ready = (async () => {
      const stop = waitsForAppKit
        ? await host.listen<boolean>('review-fullscreen-changed', ({ payload }) => {
            if (!disposed) settle(payload);
          })
        : await host.onResized(() => {
            if (disposed) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => void reconcile(), resizeQuietMs);
          });
      if (disposed) { stop(); return; }
      unlisten = stop;
      nativeFullscreen = await host.isFullscreen();
      if (!disposed && !operation) settle(nativeFullscreen);
    })();

    function change(target: boolean) {
      if (disposed || restoringFocus || operation) return;
      const next = { target, issued: false, deadlineReached: false };
      operation = next;
      setError('');
      setMode(target ? 'entering' : 'exiting');
      void ready.then(async () => {
        if (disposed) return;
        if (nativeFullscreen === target) { settle(target); return; }
        if (target) ownsFullscreen = true;
        issued = host.setFullscreen(target);
        await issued;
        if (disposed || operation !== next) return;
        next.issued = true;
        transitionTimer = waitsForAppKit
          ? setTimeout(() => fail(target), macTransitionLimitMs)
          : setTimeout(() => { next.deadlineReached = true; void reconcile(); }, transitionLimitMs);
      }).catch(() => fail(target));
    }
    controls.current = {
      toggle: () => { if (!operation) change(!nativeFullscreen); },
      exit: () => {
        if (restoringFocus) return true;
        if (operation?.target === true) exitAfterEntry = true;
        else if (nativeFullscreen && !operation) change(false);
        else if (!operation) return false;
        return true;
      },
    };
    if (direct) change(true);
    else void ready.catch(() => { if (!disposed) setError('无法读取窗口的全屏状态。'); });

    return () => {
      disposed = true;
      controls.current = null;
      unlisten?.();
      clearTimeout(resizeTimer);
      clearTimeout(transitionTimer);
      // An unexpected teardown must not strand the app in a Space it created.
      if (ownsFullscreen && operation?.target !== false) {
        void issued?.then(() => host.setFullscreen(false)).catch((cause) => console.error('无法恢复窗口模式：', cause));
      }
    };
  }, [available, entry]);

  return {
    available, fullscreen: mode !== 'windowed', transitioning: mode === 'entering' || mode === 'exiting', error,
    toggle: () => controls.current?.toggle(),
    exit: () => controls.current?.exit() ?? false,
  };
}

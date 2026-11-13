import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isDesktop } from '../lib/api';
import { appUpdateInfo, checkAppUpdate, installAppUpdate, type AppUpdateInfo, type UpdateProgress } from '../lib/app-update-api';

type FailureStage = 'check' | 'busy' | 'download' | 'install' | 'restart';
export type UpdateAttempt =
  | { type: 'updating'; version: string; progress: UpdateProgress }
  | { type: 'updateError'; version: string; stage: FailureStage; error: string };

type Status = UpdateAttempt
  | { type: 'idle' | 'checking' | 'current' }
  | { type: 'checkError'; error: string }
  | { type: 'available'; version: string; checkError?: string };

export const retryUpdateLabel: Record<FailureStage, string> = {
  check: '重新检查', busy: '重试更新', download: '重试下载', install: '重试安装', restart: '重试启动',
};

export function useAppUpdate() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const current = useRef<Status>(status);
  const initial = useRef<Promise<AppUpdateInfo> | null>(null);
  const change = useCallback((next: Status) => {
    current.current = next;
    setStatus(next);
  }, []);

  const check = useCallback(async () => {
    const previous = current.current;
    if (!['idle', 'current', 'checkError', 'available'].includes(previous.type)) return;
    change({ type: 'checking' });
    try {
      const version = await checkAppUpdate();
      change(version ? { type: 'available', version } : { type: 'current' });
    } catch (cause) {
      const error = errorMessage(cause);
      change(previous.type === 'available' ? { ...previous, checkError: error } : { type: 'checkError', error });
    }
  }, [change]);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    initial.current ??= appUpdateInfo();
    void initial.current.then((value) => {
      if (!active) return;
      setInfo(value);
      if (value.enabled) void check();
    }).catch(() => {});
    return () => { active = false; };
  }, [check]);

  async function start() {
    const previous = current.current;
    if (previous.type !== 'available' && previous.type !== 'updateError') return;
    if (previous.type === 'updateError' && previous.stage === 'check') {
      setDialogOpen(false);
      change({ type: 'idle' });
      void check();
      return;
    }
    const { version } = previous;
    const initialProgress: UpdateProgress = previous.type === 'updateError' && previous.stage === 'restart' ? { stage: 'restarting' }
      : previous.type === 'updateError' && previous.stage === 'install' ? { stage: 'installing' }
      : { stage: 'downloading', downloaded: 0, total: null };
    // Commit the modal and close guard before invoking the native updater.
    flushSync(() => {
      setDialogOpen(true);
      change({ type: 'updating', version, progress: initialProgress });
    });
    let active = true;
    try {
      await installAppUpdate(version, (progress) => {
        if (active) change({ type: 'updating', version, progress });
      });
    } catch (cause) {
      const failure = updateFailure(cause);
      change({ type: 'updateError', version, stage: failure.stage, error: failure.message });
    } finally {
      active = false;
    }
  }

  function closeDialog() {
    if (current.current.type === 'updateError') setDialogOpen(false);
  }

  return { info, status, check, start, dialogOpen, closeDialog };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function updateFailure(cause: unknown): { stage: FailureStage; message: string } {
  if (cause && typeof cause === 'object' && 'stage' in cause && 'message' in cause && typeof cause.message === 'string') {
    const stage = cause.stage;
    if (stage === 'check' || stage === 'busy' || stage === 'download' || stage === 'install' || stage === 'restart') {
      return { stage, message: cause.message };
    }
  }
  return { stage: 'install', message: errorMessage(cause) };
}

export function rememberUpdateNotice(version: string): boolean {
  try {
    const key = `foliune:app-update:notice:${version}`;
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, 'shown');
  } catch {
    // The caller also remembers the notice in memory for this app session.
  }
  return true;
}

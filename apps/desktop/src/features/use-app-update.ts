import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isDesktop } from '../lib/api';
import { appUpdateInfo, checkAppUpdate, downloadAppUpdate, installAppUpdate, type AppUpdateInfo, type UpdateProgress } from '../lib/app-update-api';

type Status =
  | { type: 'idle' | 'checking' | 'current' }
  | { type: 'checkError'; error: string }
  | { type: 'available' | 'downloaded' | 'restart'; version: string; error?: string }
  | { type: 'downloading'; version: string; progress: UpdateProgress }
  | { type: 'installing'; version: string };

export function useAppUpdate() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const current = useRef<Status>(status);
  const initial = useRef<Promise<AppUpdateInfo> | null>(null);
  const change = useCallback((next: Status) => {
    current.current = next;
    setStatus(next);
  }, []);

  const check = useCallback(async () => {
    if (!['idle', 'current', 'checkError', 'available'].includes(current.current.type)) return;
    change({ type: 'checking' });
    try {
      const version = await checkAppUpdate();
      change(version ? { type: 'available', version } : { type: 'current' });
    } catch (cause) {
      change({ type: 'checkError', error: errorMessage(cause) });
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

  async function download() {
    const previous = current.current;
    if (previous.type !== 'available') return;
    const { version } = previous;
    change({ type: 'downloading', version, progress: { downloaded: 0, total: null } });
    try {
      await downloadAppUpdate(version, (progress) => {
        if (current.current.type === 'downloading') change({ type: 'downloading', version, progress });
      });
      change({ type: 'downloaded', version });
    } catch (cause) {
      change({ type: 'available', version, error: errorMessage(cause) });
    }
  }

  async function install() {
    const previous = current.current;
    if (previous.type !== 'downloaded' && previous.type !== 'restart') return;
    const { version } = previous;
    // Make the modal and close guard effective before issuing the restart IPC.
    flushSync(() => change({ type: 'installing', version }));
    try {
      await installAppUpdate(version);
    } catch (cause) {
      const failure = installFailure(cause);
      change({
        type: previous.type === 'restart' || failure.stage === 'restart' ? 'restart' : 'downloaded',
        version,
        error: failure.message,
      });
    }
  }

  return { info, status, check, download, install };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function installFailure(cause: unknown): { stage: unknown; message: string } {
  if (cause && typeof cause === 'object' && 'stage' in cause && 'message' in cause && typeof cause.message === 'string') {
    return { stage: cause.stage, message: cause.message };
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

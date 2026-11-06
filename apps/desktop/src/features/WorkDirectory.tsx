import { useEffect, useState, useSyncExternalStore } from 'react';
import { useToast } from '../components/ToastProvider';
import { Modal } from '../components/ui';
import { currentModalHost, subscribeModalStack } from '../lib/modal-stack';
import * as api from '../lib/work-directory-api';
import { WorkDirectorySourceIcon } from './WorkDirectorySourceIcon';
import { isContextMenuTracking, subscribeContextMenu } from './use-context-menu';
import type { useWorkDirectory } from './use-work-directory';
import './work-directory.css';

type Directory = ReturnType<typeof useWorkDirectory>;

export function WorkDirectorySettings({ directory, disabled }: { directory: Directory; disabled: boolean }) {
  const [error, setError] = useState('');
  const toast = useToast();
  const { state, busy, run } = directory;
  const path = state?.path;
  const syncBlocksChanges = !!directory.retrying?.size || directory.jobs.some((job) =>
    job.status === 'running' || (job.status === 'queued' && state?.status === 'connected'));
  const canChange = !!state && !disabled && !busy && !syncBlocksChanges;

  async function choose(relink: boolean) {
    setError('');
    try {
      const next = await run(async () => {
        const selected = await api.selectWorkDirectory(relink);
        if (!selected) return null;
        return relink ? api.relinkWorkDirectory(selected) : api.bindWorkDirectory(selected);
      }, relink);
      if (next && !next.candidates.length) toast({ title: relink ? '已更新作品目录位置' : '已绑定作品目录' });
    } catch (cause) { setError(message(cause)); }
  }

  async function unbind() {
    setError('');
    try {
      const next = await run(api.unbindWorkDirectory, true);
      if (!next) return;
      toast({ title: '已解除作品目录绑定' });
    } catch (cause) { setError(message(cause)); }
  }

  return <section className="settings-content" aria-labelledby="settings-work-directory-title">
    <h2 id="settings-work-directory-title">作品目录</h2>
    <p className="muted">绑定存放作品的总目录后，一级子文件夹可同步为作品相簿，照片数量后会显示 <WorkDirectorySourceIcon /> 标识。发现新照片时，确认后即可加入对应相簿，原片留在原处。</p>
    {path ? <p className="file-path">{path}</p> : <p className="muted" role="status">{state ? '尚未绑定' : '正在读取作品目录…'}</p>}
    {state?.status === 'unavailable' && <p className="muted" role="status">作品目录离线。可重新连接设备，或选择目录的新位置。</p>}
    {syncBlocksChanges && <p className="muted" role="status">同步完成后可更改目录。</p>}
    {busy && <p className="muted" role="status">正在处理作品目录…</p>}
    {error && <p className="form-error settings-error" role="alert">{error}</p>}
    <div className="settings-actions">
      {path ? <>
        <button type="button" className="button" title="选择原作品目录的新位置" disabled={!canChange} onClick={() => void choose(true)}>选择新目录…</button>
        <button type="button" className="button button-quiet" disabled={!canChange} onClick={() => void unbind()}>解除绑定</button>
      </> : <button type="button" className="button" disabled={!canChange} onClick={() => void choose(false)}>选择目录…</button>}
      {directory.retryPending && <button type="button" className="button button-primary" disabled={disabled || busy || !!directory.retrying?.size} onClick={directory.retryFailedBatch}>重试同步</button>}
    </div>
  </section>;
}

export function WorkDirectoryDiscovery({ directory, idle }: { directory: Directory; idle: boolean }) {
  const [shown, setShown] = useState<api.WorkDirectoryCandidate[] | null>(null);
  const toast = useToast();
  const modalOpen = useSyncExternalStore(subscribeModalStack, () => currentModalHost() !== document.body);
  const menuOpen = useSyncExternalStore(subscribeContextMenu, isContextMenuTracking);
  const { state, run, retryPending, blockFailedBatch } = directory;
  const busy = directory.busy || !!directory.retrying?.size;
  const candidates = state?.status === 'connected' ? state.candidates : undefined;

  useEffect(() => {
    if (shown || !idle || busy || modalOpen || menuOpen || retryPending || !candidates?.length) return;
    if (document.querySelector('dialog[open]') || isContextMenuTracking()) return;
    setShown(candidates);
  }, [shown, idle, busy, modalOpen, menuOpen, candidates, retryPending]);

  useEffect(() => {
    if (shown && !busy && state?.status === 'unavailable') {
      setShown(null);
      toast({ title: '作品目录离线', status: 'info' });
    }
  }, [busy, shown, state?.status, toast]);

  async function resolve(decision: api.WorkDirectoryDecision) {
    if (!shown || busy) return;
    if (decision === 'sync') setShown(null);
    try {
      const next = await run(() => api.resolveWorkDirectory(shown.map((candidate) => candidate.id), decision), false, decision === 'ignore');
      if (!next) return;
      if (decision === 'ignore') {
        setShown(null);
        toast({ title: '已忽略本批发现' });
      }
    } catch (cause) {
      blockFailedBatch(shown);
      setShown(null);
      toast({ title: `${message(cause)} 可在作品目录中重试。`, status: 'error' });
    }
  }

  if (!shown) return null;
  const hasNew = shown.some((candidate) => candidate.albumId === null);
  const hasExisting = shown.some((candidate) => candidate.albumId !== null);
  const ignoreScope = hasNew && hasExisting ? '忽略后，新目录不再提示，已有相簿只忽略本批照片。'
    : hasNew ? '忽略后，这些新目录不再提示。' : '忽略仅适用于本批照片。';
  return <Modal title="发现新的作品照片">
    <div className="work-directory-batch" role="region" tabIndex={0} aria-label="待同步目录" aria-busy={busy}>
      {shown.map((candidate) => <details key={candidate.id}>
        <summary><span>{candidate.folderName}</span><span className="work-directory-count">{candidate.albumId === null ? '新相簿 · ' : '新增 '}{candidate.fileNames.length.toLocaleString()} 张</span></summary>
        <ul>{candidate.fileNames.map((file) => <li key={file}>{file}</li>)}</ul>
      </details>)}
    </div>
    <p className="muted">{ignoreScope}</p>
    <div className="form-actions">
      <button type="button" className="button" disabled={busy} onClick={() => void resolve('ignore')}>忽略</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void resolve('sync')}>{busy ? '处理中…' : '同步'}</button>
    </div>
  </Modal>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

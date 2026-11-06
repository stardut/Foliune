import { useEffect, useState, useSyncExternalStore } from 'react';
import { Folder, FolderX } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { IconButton, Modal } from '../components/ui';
import { currentModalHost, subscribeModalStack } from '../lib/modal-stack';
import * as api from '../lib/work-directory-api';
import { isContextMenuTracking, subscribeContextMenu } from './use-context-menu';
import type { useWorkDirectory } from './use-work-directory';
import './work-directory.css';

type Directory = ReturnType<typeof useWorkDirectory>;

export function WorkDirectoryControl({ directory, disabled }: { directory: Directory; disabled: boolean }) {
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const { state, busy, run } = directory;
  const path = state?.path;
  const unavailable = state?.status === 'unavailable';
  const syncBlocksChanges = !!directory.retrying?.size || directory.jobs.some((job) =>
    job.status === 'running' || (job.status === 'queued' && state?.status === 'connected'));
  const canChange = !busy && !syncBlocksChanges;
  const label = unavailable ? '作品目录不可用' : path ? '管理作品目录' : '绑定作品目录';

  async function choose(relink: boolean) {
    setError('');
    try {
      const next = await run(async () => {
        const selected = await api.selectWorkDirectory(relink);
        if (!selected) return null;
        return relink ? api.relinkWorkDirectory(selected) : api.bindWorkDirectory(selected);
      }, relink);
      if (!next) return;
      setManaging(false);
      if (!next.candidates.length) toast({ title: relink ? '已重新定位作品目录' : '已绑定作品目录' });
    } catch (cause) {
      if (relink) setError(message(cause));
      else toast({ title: message(cause), status: 'error' });
    }
  }

  async function unbind() {
    setError('');
    try {
      const next = await run(api.unbindWorkDirectory, true);
      if (!next) return;
      setManaging(false);
      toast({ title: '已解除作品目录绑定' });
    } catch (cause) { setError(message(cause)); }
  }

  return <>
    <IconButton label={label} disabled={disabled || busy || !state} onClick={() => {
      if (!path) { void choose(false); return; }
      setError(''); setManaging(true);
    }}>{unavailable ? <FolderX size={16} /> : <Folder size={16} />}</IconButton>
    {managing && path && <Modal title="作品目录" onClose={busy ? undefined : () => setManaging(false)}>
      <p className="replacement-path">{path}</p>
      {unavailable && <p role="status">目录当前不可用。可重新连接设备或选择目录的新位置。</p>}
      {syncBlocksChanges && <p className="muted" role="status">同步完成后可更改目录。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button button-quiet" disabled={!canChange} onClick={() => void unbind()}>解除绑定</button>
        <button type="button" className="button" disabled={!canChange} onClick={() => void choose(true)}>重新定位</button>
        {directory.retryPending && <button type="button" className="button button-primary" disabled={busy} onClick={() => {
          setManaging(false); directory.retryFailedBatch();
        }}>重试同步</button>}
      </div>
    </Modal>}
  </>;
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

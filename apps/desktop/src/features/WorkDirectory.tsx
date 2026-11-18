import { photoCount, t } from '../lib/i18n';
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
      if (next && !next.candidates.length) toast({ title: relink ? t('已更新作品目录位置', 'Work folder location updated') : t('已绑定作品目录', 'Work folder linked') });
    } catch (cause) { setError(message(cause)); }
  }

  async function unbind() {
    setError('');
    try {
      const next = await run(api.unbindWorkDirectory, true);
      if (!next) return;
      toast({ title: t('已解除作品目录绑定', 'Work folder unlinked') });
    } catch (cause) { setError(message(cause)); }
  }

  return <section className="settings-content" aria-labelledby="settings-work-directory-title">
    <h2 id="settings-work-directory-title">{t('作品目录', 'Work Folder')}</h2>
    <p className="muted">{t('绑定存放作品的总目录后，一级子文件夹可同步为作品相簿，照片数量后会显示', 'Link your work folder to sync its immediate subfolders as Work albums. An icon appears next to the photo count:')} <WorkDirectorySourceIcon /> {t('标识。发现新照片时，确认后即可加入对应相簿，原片留在原处。', '. Confirm new photos to add them to their albums. Originals stay in the source folder.')}</p>
    {path ? <p className="file-path">{path}</p> : <p className="muted" role="status">{state ? t('尚未绑定', 'No folder linked') : t('正在读取作品目录…', 'Loading work folder…')}</p>}
    {state?.status === 'unavailable' && <p className="muted" role="status">{t('作品目录离线。可重新连接设备，或选择目录的新位置。', 'The work folder is offline. Reconnect the device or choose the folder’s new location.')}</p>}
    {syncBlocksChanges && <p className="muted" role="status">{t('同步完成后可更改目录。', 'The folder can be changed after syncing.')}</p>}
    {busy && <p className="muted" role="status">{t('正在处理作品目录…', 'Working with the work folder…')}</p>}
    {error && <p className="form-error settings-error" role="alert">{error}</p>}
    <div className="settings-actions">
      {path ? <>
        <button type="button" className="button" title={t('选择原作品目录的新位置', 'Choose the new location of the existing work folder')} disabled={!canChange} onClick={() => void choose(true)}>{t('选择新目录…', 'Choose New Folder…')}</button>
        <button type="button" className="button button-quiet" disabled={!canChange} onClick={() => void unbind()}>{t('解除绑定', 'Unlink Folder')}</button>
      </> : <button type="button" className="button" disabled={!canChange} onClick={() => void choose(false)}>{t('选择目录…', 'Choose Folder…')}</button>}
      {directory.retryPending && <button type="button" className="button button-primary" disabled={disabled || busy || !!directory.retrying?.size} onClick={directory.retryFailedBatch}>{t('重试同步', 'Retry Sync')}</button>}
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
      toast({ title: t('作品目录离线', 'Work folder offline'), status: 'info' });
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
        toast({ title: t('已忽略本批发现', 'Ignored this batch') });
      }
    } catch (cause) {
      blockFailedBatch(shown);
      setShown(null);
      toast({ title: t(`${message(cause)} 可在作品目录中重试。`, `${message(cause)} Retry from Work Folder settings.`), status: 'error' });
    }
  }

  if (!shown) return null;
  const hasNew = shown.some((candidate) => candidate.albumId === null);
  const hasExisting = shown.some((candidate) => candidate.albumId !== null);
  const ignoreScope = hasNew && hasExisting ? t('忽略后，新目录不再提示，已有相簿只忽略本批照片。', 'Ignoring skips prompts for new folders and skips only this batch for existing albums.')
    : hasNew ? t('忽略后，这些新目录不再提示。', 'Ignoring skips future prompts for these new folders.') : t('忽略仅适用于本批照片。', 'Ignoring applies only to this batch.');
  return <Modal title={t('发现新的作品照片', 'New Work Photos Found')}>
    <div className="work-directory-batch" role="region" tabIndex={0} aria-label={t('待同步目录', 'Folders to Sync')} aria-busy={busy}>
      {shown.map((candidate) => <details key={candidate.id}>
        <summary><span>{candidate.folderName}</span><span className="work-directory-count">{candidate.albumId === null ? t(`新相簿 · ${candidate.fileNames.length.toLocaleString('zh-CN')} 张`, `New Album · ${photoCount(candidate.fileNames.length)}`) : t(`新增 ${candidate.fileNames.length.toLocaleString('zh-CN')} 张`, `${photoCount(candidate.fileNames.length)} added`)}</span></summary>
        <ul>{candidate.fileNames.map((file) => <li key={file}>{file}</li>)}</ul>
      </details>)}
    </div>
    <p className="muted">{ignoreScope}</p>
    <div className="form-actions">
      <button type="button" className="button" disabled={busy} onClick={() => void resolve('ignore')}>{t('忽略', 'Ignore')}</button>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void resolve('sync')}>{busy ? t('处理中…', 'Working…') : t('同步', 'Sync')}</button>
    </div>
  </Modal>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

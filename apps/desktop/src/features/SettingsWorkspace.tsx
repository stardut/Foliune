import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArchiveRestore, Download, LoaderCircle } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { Modal, WorkspaceHeader } from '../components/ui';
import * as backup from '../lib/backup-api';
import type { LibrarySnapshot } from '../lib/types';
import type { OptionalWorkspace, WorkspaceVisibility } from '../lib/workspace-visibility';
import { WorkDirectorySettings } from './WorkDirectory';
import { AppUpdateSettings } from './AppUpdateSettings';
import type { useAppUpdate } from './use-app-update';
import type { useWorkDirectory } from './use-work-directory';
import './settings.css';

type BackupOperation = 'export' | 'choose' | 'restore';

export function SettingsWorkspace({ snapshot, directory, onRestored, onBusyChange, workspaceVisibility, onWorkspaceVisibilityChange, update, installBlocked, onInstall }: {
  snapshot: LibrarySnapshot;
  directory: ReturnType<typeof useWorkDirectory>;
  onRestored: (snapshot: LibrarySnapshot) => void;
  onBusyChange: (busy: boolean) => void;
  workspaceVisibility: WorkspaceVisibility;
  onWorkspaceVisibilityChange: (workspace: OptionalWorkspace, visible: boolean) => void;
  update: ReturnType<typeof useAppUpdate>;
  installBlocked: boolean;
  onInstall: () => void;
}) {
  const [operation, setOperation] = useState<BackupOperation | null>(null);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [exportError, setExportError] = useState('');
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const locked = useRef(false);
  const toast = useToast();
  const directoryBusy = directory.busy || !!directory.retrying?.size;
  const backupBusy = operation !== null || exportOptionsOpen || restorePath !== null;

  async function run(next: BackupOperation, task: () => Promise<void>) {
    if (locked.current || directoryBusy) return;
    locked.current = true;
    setOperation(next);
    onBusyChange(true);
    try { await task(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (next === 'restore') setRestoreError(`恢复失败。${message}`);
      else if (next === 'export') {
        setExportError(`导出备份失败。${message}`);
        setExportOptionsOpen(true);
      } else toast({ title: `无法选择备份文件。${message}`, status: 'error' });
    } finally {
      locked.current = false;
      setOperation(null);
      onBusyChange(false);
    }
  }

  function openExportOptions() {
    if (backupBusy || directoryBusy) return;
    setExportError('');
    setExportOptionsOpen(true);
  }

  function exportBackup(mode: backup.BackupMode) {
    void run('export', async () => {
      // Dismiss the WebView modal before presenting the native save panel.
      flushSync(() => {
        setExportOptionsOpen(false);
        setExportError('');
      });
      const result = await backup.createBackup(mode);
      if (result) toast({ title: `图库备份已保存至 ${result.path}` });
      else setExportOptionsOpen(true);
    });
  }

  function chooseBackup() {
    void run('choose', async () => {
      setRestoreError('');
      setRestorePath(await backup.selectBackup());
    });
  }

  function restoreBackup(path: string) {
    void run('restore', async () => {
      setRestoreError('');
      const result = await backup.restoreBackup(path);
      onRestored(result.snapshot);
      setRestorePath(null);
      const summary = result.photoCount ? `恢复完成，新增 ${result.photoCount} 张照片` : '恢复完成，未新增照片';
      const notices = [];
      if (result.skippedMembershipCount) notices.push(`${result.skippedMembershipCount} 条相簿关系未恢复`);
      if (result.skippedDocumentCount) notices.push(`${result.skippedDocumentCount} 份资料未恢复`);
      if (result.unresolvedWorkPhotoCount) notices.push(`${result.unresolvedWorkPhotoCount} 张作品照片只恢复了索引和缩略图`);
      toast(notices.length ? { title: [summary, ...notices].join('\n'), status: 'info', duration: 8000 } : { title: summary });
    });
  }

  function closeRestore() {
    if (!locked.current) setRestorePath(null);
  }

  return <section>
    <WorkspaceHeader title="设置" count={`${snapshot.photos.length} 张照片 · ${snapshot.groups.length} 个相簿`} />
    <AppUpdateSettings update={update} installBlocked={installBlocked || backupBusy || directoryBusy} onInstall={onInstall} />
    <WorkDirectorySettings directory={directory} disabled={backupBusy} />
    <section className="settings-content" aria-labelledby="settings-workspace-title">
      <h2 id="settings-workspace-title">工作区</h2>
      <div className="settings-visibility-options">
        <label><input type="checkbox" checked={workspaceVisibility.models} onChange={(event) => onWorkspaceVisibilityChange('models', event.currentTarget.checked)} />显示模特</label>
        <label><input type="checkbox" checked={workspaceVisibility.planning} onChange={(event) => onWorkspaceVisibilityChange('planning', event.currentTarget.checked)} />显示策划</label>
      </div>
    </section>
    <section className="settings-content" aria-labelledby="settings-backup-title">
      <h2 id="settings-backup-title">备份与恢复</h2>
      <p className="muted">导出 ZIP 备份时，可仅保存图库资料与缩略图，也可一并保存全部原片。</p>
      <div className="settings-actions">
        <button type="button" className="button" disabled={directoryBusy || restorePath !== null || operation === 'choose' || operation === 'restore'}
          aria-haspopup="dialog" aria-disabled={exportOptionsOpen || operation === 'export'} onClick={openExportOptions}>
          {operation === 'export' ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
          {operation === 'export' ? <span role="status">正在导出…</span> : '导出备份'}
        </button>
        <button type="button" className="button" disabled={directoryBusy || (backupBusy && operation !== 'choose')} aria-disabled={operation === 'choose'} onClick={chooseBackup}>
          {operation === 'choose' ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />}
          {operation === 'choose' ? <span role="status">正在选择…</span> : '恢复备份'}
        </button>
      </div>
    </section>
    {exportOptionsOpen && <Modal title="选择备份范围" onClose={() => setExportOptionsOpen(false)}>
      <div className="settings-backup-options">
        <button type="button" className="button" disabled={directoryBusy || operation !== null} onClick={() => exportBackup('metadata')}>
          <span>仅图库资料</span><span className="muted">包含图库资料和缩略图。</span>
        </button>
        <button type="button" className="button" disabled={directoryBusy || operation !== null} onClick={() => exportBackup('full')}>
          <span>包含全部原片</span><span className="muted">也备份从本地导入和作品目录引用的原片。所有原片须可读取。</span>
        </button>
      </div>
      {exportError && <p className="form-error settings-error" role="alert">{exportError}</p>}
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={() => setExportOptionsOpen(false)}>取消</button>
      </div>
    </Modal>}
    {restorePath && <Modal title="恢复备份" onClose={operation === 'restore' ? undefined : closeRestore}>
      <p className="replacement-copy">备份会合并到当前图库，保留已有内容，只补入缺少的资料。</p>
      <p className="replacement-path">{restorePath}</p>
      {restoreError && <p className="form-error settings-error" role="alert">{restoreError}</p>}
      <div className="form-actions">
        <button type="button" className="button" autoFocus disabled={operation !== null} onClick={closeRestore}>取消</button>
        <button type="button" className="button button-primary" disabled={directoryBusy || operation !== null} onClick={() => restoreBackup(restorePath)}>
          {operation === 'restore' ? <><LoaderCircle size={14} className="spin" /><span role="status">正在恢复…</span></> : '确认恢复'}
        </button>
      </div>
    </Modal>}
  </section>;
}

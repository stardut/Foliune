import { albumCount, photoCount, readLanguagePreference, saveLanguagePreference, t, type LanguagePreference } from '../lib/i18n';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArchiveRestore, Download, LoaderCircle } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { DropdownSelect } from '../components/DropdownSelect';
import { Modal, WorkspaceHeader } from '../components/ui';
import * as backup from '../lib/backup-api';
import type { LibrarySnapshot } from '../lib/types';
import type { OptionalWorkspace, WorkspaceVisibility } from '../lib/workspace-visibility';
import { WorkDirectorySettings } from './WorkDirectory';
import { AppUpdateSettings } from './AppUpdateSettings';
import { CliInstallSettings } from './CliInstallSettings';
import type { useAppUpdate } from './use-app-update';
import type { useCliInstall } from './use-cli-install';
import type { useWorkDirectory } from './use-work-directory';
import './settings.css';

type BackupOperation = 'export' | 'choose' | 'restore';
const languages: readonly { value: LanguagePreference; label: string; lang?: string }[] = [
  { value: 'system', label: t('跟随系统', 'Follow System') },
  { value: 'zh-CN', label: '简体中文', lang: 'zh-CN' },
  { value: 'en', label: 'English', lang: 'en' },
];

export function LanguageSettings({ disabled }: { disabled: boolean }) {
  const [language, setLanguage] = useState(readLanguagePreference);
  const toast = useToast();

  function changeLanguage(preference: LanguagePreference) {
    try {
      saveLanguagePreference(preference);
      setLanguage(preference);
    } catch {
      toast({ title: t('无法保存界面语言', 'Could not save the interface language'), status: 'error' });
    }
  }

  return <section className="settings-content settings-row settings-language" aria-labelledby="settings-language-title">
    <h2 id="settings-language-title">{t('界面语言', 'Language')}</h2>
    <DropdownSelect label={t('界面语言', 'Language')} value={language} options={languages}
      disabled={disabled} onChange={changeLanguage} />
  </section>;
}

export function SettingsWorkspace({ snapshot, directory, onRestored, onBusyChange, workspaceVisibility, onWorkspaceVisibilityChange, update, updateBlocked, onUpdate, cli, cliBlocked, onInstallCli }: {
  snapshot: LibrarySnapshot;
  directory: ReturnType<typeof useWorkDirectory>;
  onRestored: (snapshot: LibrarySnapshot) => void;
  onBusyChange: (busy: boolean) => void;
  workspaceVisibility: WorkspaceVisibility;
  onWorkspaceVisibilityChange: (workspace: OptionalWorkspace, visible: boolean) => void;
  update: ReturnType<typeof useAppUpdate>;
  updateBlocked: boolean;
  onUpdate: () => void;
  cli: ReturnType<typeof useCliInstall>;
  cliBlocked: boolean;
  onInstallCli: () => void;
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
  const installingCli = cli.state.type === 'installing';

  async function run(next: BackupOperation, task: () => Promise<void>) {
    if (locked.current || directoryBusy || installingCli) return;
    locked.current = true;
    setOperation(next);
    onBusyChange(true);
    try { await task(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (next === 'restore') setRestoreError(t(`恢复失败。${message}`, `Could not restore the backup: ${message}`));
      else if (next === 'export') {
        setExportError(t(`导出备份失败。${message}`, `Could not export the backup: ${message}`));
        setExportOptionsOpen(true);
      } else toast({ title: t(`无法选择备份文件。${message}`, `Could not select the backup file: ${message}`), status: 'error' });
    } finally {
      locked.current = false;
      setOperation(null);
      onBusyChange(false);
    }
  }

  function openExportOptions() {
    if (backupBusy || directoryBusy || installingCli) return;
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
      if (result) toast({ title: t(`图库备份已保存至 ${result.path}`, `Library backup saved to ${result.path}`) });
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
      const summary = result.photoCount ? t(`恢复完成，新增 ${result.photoCount} 张照片`, `Restored ${result.photoCount} ${result.photoCount === 1 ? 'photo' : 'photos'}`) : t('恢复完成，未新增照片', 'Restore complete. No new photos were added.');
      const notices = [];
      if (result.skippedMembershipCount) notices.push(t(`${result.skippedMembershipCount} 条相簿关系未恢复`, `Album memberships skipped: ${result.skippedMembershipCount}`));
      if (result.skippedDocumentCount) notices.push(t(`${result.skippedDocumentCount} 份资料未恢复`, `Records skipped: ${result.skippedDocumentCount}`));
      if (result.unresolvedWorkPhotoCount) notices.push(t(`${result.unresolvedWorkPhotoCount} 张作品照片只恢复了索引和缩略图`, `Work photos restored as records and thumbnails only: ${result.unresolvedWorkPhotoCount}`));
      toast(notices.length ? { title: [summary, ...notices].join('\n'), status: 'info', duration: 8000 } : { title: summary });
    });
  }

  function closeRestore() {
    if (!locked.current) setRestorePath(null);
  }

  return <section>
    <WorkspaceHeader title={t('设置', 'Settings')} count={`${photoCount(snapshot.photos.length)} · ${albumCount(snapshot.groups.length)}`} />
    <LanguageSettings disabled={updateBlocked || backupBusy || directoryBusy || installingCli} />
    <AppUpdateSettings update={update} updateBlocked={updateBlocked || backupBusy || directoryBusy} onUpdate={onUpdate} />
    <CliInstallSettings cli={cli} blocked={cliBlocked || backupBusy || directoryBusy} onInstall={onInstallCli} />
    <WorkDirectorySettings directory={directory} disabled={backupBusy || installingCli} />
    <section className="settings-content" aria-labelledby="settings-workspace-title">
      <h2 id="settings-workspace-title">{t('工作区', 'Workspaces')}</h2>
      <div className="settings-visibility-options">
        <label><input type="checkbox" checked={workspaceVisibility.models} onChange={(event) => onWorkspaceVisibilityChange('models', event.currentTarget.checked)} />{t('显示模特', 'Show Models')}</label>
        <label><input type="checkbox" checked={workspaceVisibility.planning} onChange={(event) => onWorkspaceVisibilityChange('planning', event.currentTarget.checked)} />{t('显示策划', 'Show Shoot Plans')}</label>
      </div>
    </section>
    <section className="settings-content" aria-labelledby="settings-backup-title">
      <h2 id="settings-backup-title">{t('备份与恢复', 'Backup and Restore')}</h2>
      <p className="muted">{t('导出 ZIP 备份时，可仅保存图库资料与缩略图，也可一并保存全部原片。', 'A ZIP backup can include just library data and thumbnails, or all original photos as well.')}</p>
      <div className="settings-actions">
        <button type="button" className="button" disabled={installingCli || directoryBusy || restorePath !== null || operation === 'choose' || operation === 'restore'}
          aria-haspopup="dialog" aria-disabled={exportOptionsOpen || operation === 'export'} onClick={openExportOptions}>
          {operation === 'export' ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
          {operation === 'export' ? <span role="status">{t('正在导出…', 'Exporting…')}</span> : t('导出备份', 'Export Backup')}
        </button>
        <button type="button" className="button" disabled={installingCli || directoryBusy || (backupBusy && operation !== 'choose')} aria-disabled={operation === 'choose'} onClick={chooseBackup}>
          {operation === 'choose' ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />}
          {operation === 'choose' ? <span role="status">{t('正在选择…', 'Selecting…')}</span> : t('恢复备份', 'Restore Backup')}
        </button>
      </div>
    </section>
    {exportOptionsOpen && <Modal title={t('选择备份范围', 'Choose What to Back Up')} onClose={() => setExportOptionsOpen(false)}>
      <div className="settings-backup-options">
        <button type="button" className="button" disabled={directoryBusy || operation !== null} onClick={() => exportBackup('metadata')}>
          <span>{t('仅图库资料', 'Library Data Only')}</span><span className="muted">{t('包含图库资料和缩略图。', 'Includes library data and thumbnails.')}</span>
        </button>
        <button type="button" className="button" disabled={directoryBusy || operation !== null} onClick={() => exportBackup('full')}>
          <span>{t('包含全部原片', 'Include All Originals')}</span><span className="muted">{t('也备份从本地导入和作品目录引用的原片。所有原片须可读取。', 'Also includes originals from local imports and the work folder. All originals must be readable.')}</span>
        </button>
      </div>
      {exportError && <p className="form-error settings-error" role="alert">{exportError}</p>}
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={() => setExportOptionsOpen(false)}>{t('取消', 'Cancel')}</button>
      </div>
    </Modal>}
    {restorePath && <Modal title={t('恢复备份', 'Restore Backup')} onClose={operation === 'restore' ? undefined : closeRestore}>
      <p className="replacement-copy">{t('备份会合并到当前图库，保留已有内容，只补入缺少的资料。', 'The backup will add missing items to the current library and preserve existing content.')}</p>
      <p className="replacement-path">{restorePath}</p>
      {restoreError && <p className="form-error settings-error" role="alert">{restoreError}</p>}
      <div className="form-actions">
        <button type="button" className="button" autoFocus disabled={operation !== null} onClick={closeRestore}>{t('取消', 'Cancel')}</button>
        <button type="button" className="button button-primary" disabled={directoryBusy || operation !== null} onClick={() => restoreBackup(restorePath)}>
          {operation === 'restore' ? <><LoaderCircle size={14} className="spin" /><span role="status">{t('正在恢复…', 'Restoring…')}</span></> : t('确认恢复', 'Restore')}
        </button>
      </div>
    </Modal>}
  </section>;
}

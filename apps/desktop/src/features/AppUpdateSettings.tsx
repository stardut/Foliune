import { t } from '../lib/i18n';
import { LoaderCircle } from 'lucide-react';
import { retryUpdateLabel, type useAppUpdate } from './use-app-update';

export function AppUpdateSettings({ update, updateBlocked, onUpdate }: {
  update: ReturnType<typeof useAppUpdate>;
  updateBlocked: boolean;
  onUpdate: () => void;
}) {
  const { info, status, check } = update;
  if (!info) return null;

  const canUpdate = status.type === 'available' || status.type === 'updateError';
  const checking = status.type === 'checking';
  const updating = status.type === 'updating';
  const checkError = status.type === 'checkError' ? status.error : status.type === 'available' ? status.checkError : undefined;
  const label = status.type === 'available' ? t('立即更新', 'Update Now')
    : status.type === 'updateError' ? retryUpdateLabel[status.stage]
    : updating ? t('正在更新…', 'Updating…')
    : checking ? t('正在检查…', 'Checking…')
    : status.type === 'checkError' ? t('重试检查', 'Retry Check') : t('检查更新', 'Check for Updates');

  return <section className="settings-content settings-update" aria-labelledby="settings-update-title">
    <div className="settings-row">
      <div>
        <h2 id="settings-update-title">{t('应用更新', 'App Updates')}</h2>
        <p className="muted">{t(`当前版本 ${info.currentVersion}`, `Current version ${info.currentVersion}`)}</p>
      </div>
      {info.enabled && <div className="settings-actions">
        {status.type === 'available' && <button type="button" className="button button-quiet" onClick={() => { void check(); }}>{checkError ? t('重试检查', 'Retry Check') : t('检查更新', 'Check for Updates')}</button>}
        <button type="button" className={`button${canUpdate ? ' button-primary' : ''}`}
          aria-haspopup={canUpdate ? 'dialog' : undefined}
          aria-disabled={updating || (canUpdate && updateBlocked)} disabled={checking}
          onClick={(event) => {
            if (updating || (canUpdate && updateBlocked)) return;
            if (!canUpdate) { void check(); return; }
            event.currentTarget.focus({ preventScroll: true });
            onUpdate();
          }}>
          {checking && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {label}
        </button>
      </div>}
    </div>
    {status.type === 'current' && <p className="muted" role="status">{t('已是最新版本', 'You’re up to date')}</p>}
    {'version' in status && <p className="muted" role="status">
      {status.type === 'updateError' && status.stage === 'restart' ? t(`版本 ${status.version} 已安装，等待重启`, `Version ${status.version} installed. Restart pending.`) : t(`新版本 ${status.version}`, `Version ${status.version} available`)}
    </p>}
    {canUpdate && updateBlocked && <p className="muted">{t('请先完成当前编辑或图库操作。', 'Finish the current edit or library operation first.')}</p>}
    {checkError && <p className="form-error settings-error" role="alert">{checkError}</p>}
  </section>;
}

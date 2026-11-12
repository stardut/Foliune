import { LoaderCircle } from 'lucide-react';
import type { useAppUpdate } from './use-app-update';

export function AppUpdateSettings({ update, installBlocked, onInstall }: {
  update: ReturnType<typeof useAppUpdate>;
  installBlocked: boolean;
  onInstall: () => void;
}) {
  const { info, status, check, download } = update;
  if (!info) return null;

  const error = 'error' in status ? status.error : undefined;
  const progress = status.type === 'downloading' ? status.progress : undefined;
  const percent = progress?.total ? Math.min(100, Math.floor(progress.downloaded / progress.total * 100)) : undefined;
  const action = status.type === 'available' ? {
    label: error ? '重试下载' : '下载更新', run: download,
  } : status.type === 'downloaded' || status.type === 'restart' ? {
    label: status.type === 'restart' ? '重试重新启动' : '安装并重启',
    run: onInstall,
    disabled: installBlocked,
    primary: true,
  } : status.type === 'downloading' || status.type === 'checking' || status.type === 'installing' ? {
    label: status.type === 'downloading' ? '正在下载…' : status.type === 'checking' ? '正在检查…' : '正在安装…',
    disabled: true,
    working: true,
  } : {
    label: status.type === 'checkError' ? '重试检查' : '检查更新', run: check,
  };

  return <section className="settings-content settings-update" aria-labelledby="settings-update-title">
    <div className="settings-update-row">
      <div>
        <h2 id="settings-update-title">应用更新</h2>
        <p className="muted">当前版本 {info.currentVersion}</p>
      </div>
      {info.enabled && <div className="settings-actions">
        {status.type === 'available' && <button type="button" className="button button-quiet" onClick={() => { void check(); }}>检查更新</button>}
        <button type="button" className={`button${action.primary ? ' button-primary' : ''}`} disabled={action.disabled}
          onClick={() => { void action.run?.(); }}>
          {action.working && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {action.label}
        </button>
      </div>}
    </div>
    {status.type === 'current' && <p className="muted" role="status">已是最新版本</p>}
    {'version' in status && <p className="muted" role="status">
      {status.type === 'restart' ? `版本 ${status.version} 已安装，等待重启`
        : status.type === 'downloaded' ? `版本 ${status.version} 已下载` : `新版本 ${status.version}`}
    </p>}
    {progress && <div className="settings-update-progress">
      <progress aria-label="更新下载进度" max={100} value={percent} />
      {percent !== undefined && <span aria-hidden="true">{percent}%</span>}
    </div>}
    {installBlocked && (status.type === 'downloaded' || status.type === 'restart') &&
      <p className="muted">请先完成当前编辑或图库操作。</p>}
    {error && <p className="form-error settings-error" role="alert">{error}</p>}
  </section>;
}

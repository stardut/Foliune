import { useEffect, useRef } from 'react';
import { Modal } from '../components/ui';
import type { UpdateProgress } from '../lib/app-update-api';
import { retryUpdateLabel, type UpdateAttempt } from './use-app-update';

const stageLabel: Record<UpdateProgress['stage'], string> = {
  downloading: '正在下载更新…',
  verifying: '正在验证更新包…',
  installing: '正在安装更新…',
  restarting: '正在重启 Foliune…',
};

export function AppUpdateDialog({ status, retryBlocked, onRetry, onClose }: {
  status: UpdateAttempt;
  retryBlocked: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const failed = status.type === 'updateError';
  useEffect(() => {
    (failed ? closeRef.current : statusRef.current)?.focus({ preventScroll: true });
  }, [failed]);

  return <Modal title="更新 Foliune">
    <div className="app-update-status">
      <p ref={statusRef} tabIndex={-1} role="status">{failed
        ? status.stage === 'restart' ? '更新已安装' : '更新未完成'
        : stageLabel[status.progress.stage]}</p>
      <span className="muted">版本 {status.version}</span>
    </div>
    {failed ? <>
      <p className="form-error settings-error app-update-error" role="alert">{status.error}</p>
      <div className="form-actions">
        <button ref={closeRef} type="button" className="button" onClick={onClose}>关闭</button>
        <button type="button" className="button button-primary" disabled={retryBlocked} onClick={onRetry}>{retryUpdateLabel[status.stage]}</button>
      </div>
    </> : <DownloadProgress progress={status.progress} />}
  </Modal>;
}

function DownloadProgress({ progress }: { progress: UpdateProgress }) {
  const downloading = progress.stage === 'downloading';
  const percent = downloading
    ? progress.total ? Math.min(100, Math.floor(progress.downloaded / progress.total * 100)) : undefined
    : 100;
  return <div className="app-update-progress" aria-hidden={downloading ? undefined : true}>
    <div className="app-update-progress-track" role={downloading ? 'progressbar' : undefined}
      aria-label={downloading ? '更新下载进度' : undefined} aria-valuenow={downloading ? percent : undefined}>
      <span className={percent === undefined ? 'app-update-progress-indeterminate' : undefined}
        style={percent === undefined ? undefined : { width: `${percent}%` }} />
    </div>
    {downloading && percent !== undefined && <span aria-hidden="true">{percent}%</span>}
  </div>;
}

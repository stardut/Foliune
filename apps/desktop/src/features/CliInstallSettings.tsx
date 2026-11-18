import { t } from '../lib/i18n';
import { useLayoutEffect, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cliExample, cliHelp, type useCliInstall } from './use-cli-install';

export function CliInstallSettings({ cli, blocked, onInstall }: {
  cli: ReturnType<typeof useCliInstall>;
  blocked: boolean;
  onInstall: () => void;
}) {
  const { state, check } = cli;
  const statusText = useRef<HTMLParagraphElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (state.type === 'installing' || state.type === 'checking') return;
    if (restoreFocus.current && document.activeElement === document.body) statusText.current?.focus({ preventScroll: true });
    restoreFocus.current = false;
  }, [state.type]);
  if (state.type === 'unavailable') return null;

  const installed = state.type === 'installed';
  const busy = state.type === 'checking' || state.type === 'installing';
  const recheck = state.type === 'conflict' || state.type === 'checkError';
  const error = state.type === 'checkError' || state.type === 'installError' ? state.error : null;
  const status = installed ? <>{t('已安装', 'Installed')} · <code>foliune-cli</code></>
    : state.type === 'conflict' ? <><code>/usr/local/bin/foliune-cli</code> {t('已被占用', 'Path in use')}</>
    : state.type === 'available' && state.cancelled ? t('已取消安装', 'Installation canceled')
    : state.type === 'checkError' ? t('无法读取安装状态', 'Could not read installation status') : null;
  const label = state.type === 'checking' ? t('正在检查…', 'Checking…')
    : state.type === 'installing' ? t('正在安装…', 'Installing…')
    : recheck ? t('重新检查', 'Check Again') : state.type === 'installError' ? t('重试安装', 'Retry Installation') : t('安装', 'Install');

  return <section className="settings-content settings-cli" aria-labelledby="settings-cli-title">
    <div className="settings-row">
      <div>
        <h2 id="settings-cli-title">{t('命令行工具', 'Command-Line Tool')}</h2>
        <p className="muted">{t('在终端或通过支持调用终端的 AI 助手，查询和编辑照片、相簿、画册、拍摄策划和模特档案。', 'Browse and edit photos, albums, photo books, shoot plans, and model profiles from the terminal or an AI assistant with terminal access.')}</p>
      </div>
      {!installed && <button type="button" className="button" aria-disabled={busy || blocked}
        onClick={(event) => {
          if (busy || blocked) return;
          event.currentTarget.focus({ preventScroll: true });
          restoreFocus.current = true;
          if (recheck) void check();
          else onInstall();
        }}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
        {label}
      </button>}
    </div>
    <p className="muted" role="status" ref={statusText} tabIndex={-1} hidden={status === null}>{status}</p>
    {installed && <div className="settings-cli-example">
      <p>{t('试着对 AI 助手说', 'Try asking an AI assistant')}</p>
      <p className="settings-cli-copy">{cliExample}</p>
      <p className="muted">{t('终端帮助', 'Terminal Help')} <code className="settings-cli-copy">{cliHelp}</code></p>
    </div>}
    {error && <p className="form-error settings-error" role="alert">{error}</p>}
  </section>;
}

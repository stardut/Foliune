import { t } from '../lib/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useToast } from '../components/ToastProvider';
import { cliInstallStatus, installCli, type CliInstallStatus } from '../lib/cli-install-api';

type State = { type: Exclude<CliInstallStatus, 'available'> | 'checking' | 'installing' }
  | { type: 'available'; cancelled?: boolean }
  | { type: 'checkError' | 'installError'; error: string };

const noticeKey = 'foliune:cli-install:notice';
export const cliExample = t('用 foliune-cli 找出标了『窗光』的照片，加入一个新相簿。', 'Use foliune-cli to find photos tagged “window light” and add them to a new album.');
export const cliHelp = 'foliune-cli --help';

export function useCliInstall(ready: boolean) {
  const [state, setState] = useState<State>({ type: 'checking' });
  const running = useRef(false);
  const toast = useToast();

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState({ type: 'checking' });
    try {
      const { status } = await cliInstallStatus();
      setState({ type: status });
    } catch (cause) {
      setState({ type: 'checkError', error: message(cause) });
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => { if (ready) void check(); }, [ready, check]);

  async function start(fromNotice: boolean) {
    if (running.current || (state.type !== 'available' && state.type !== 'installError')) return;
    running.current = true;
    // Commit the close and update guards before opening native authorization.
    flushSync(() => setState({ type: 'installing' }));
    const dismiss = fromNotice ? toast({ title: t('正在安装命令行工具…', 'Installing the command-line tool…'), status: 'info', duration: null }) : undefined;
    try {
      const { status } = await installCli();
      if (status === 'installed') {
        setState({ type: 'installed' });
        if (fromNotice) toast({
          title: t('命令行工具已安装', 'Command-line tool installed'),
          description: t(`试着对 AI 助手说\n${cliExample}\n\n终端帮助  ${cliHelp}`, `Try asking an AI assistant
${cliExample}

Terminal help  ${cliHelp}`),
          duration: 12000,
        });
      } else {
        setState({ type: 'available', cancelled: true });
        if (fromNotice) toast({ title: t('已取消安装，可在设置中重试', 'Installation canceled. Retry in Settings.'), status: 'info' });
      }
    } catch (cause) {
      const error = message(cause);
      setState({ type: 'installError', error });
      if (fromNotice) toast({ title: t(`安装命令行工具失败：${error}`, `Could not install the command-line tool: ${error}`), status: 'error' });
    } finally {
      dismiss?.();
      running.current = false;
    }
  }

  return { state, check, start };
}

export function useCliInstallNotice(offer: boolean, keep: boolean, onInstall: () => void) {
  const toast = useToast();
  const offered = useRef(false);
  const dismiss = useRef<(() => void) | undefined>(undefined);
  const install = useRef(onInstall);
  useLayoutEffect(() => { install.current = onInstall; }, [onInstall]);

  useEffect(() => {
    if (!keep) {
      dismiss.current?.();
      dismiss.current = undefined;
    }
    if (!offer || offered.current) return;
    offered.current = true;
    try { if (localStorage.getItem(noticeKey)) return; } catch { /* Remember it for this session. */ }
    dismiss.current = toast({
      title: t('让 AI 助手帮你整理图库', 'Organize your library with an AI assistant'),
      description: t('支持调用终端的 AI 助手可以帮你查找照片、整理相簿，编辑画册和拍摄策划。', 'AI assistants with terminal access can find photos, organize albums, and edit photo books and shoot plans.'),
      status: 'info',
      duration: null,
      action: { label: t('安装命令行工具', 'Install Command-Line Tool'), onClick: () => install.current() },
      dismissLabel: t('暂不安装', 'Not Now'),
    });
    try { localStorage.setItem(noticeKey, 'shown'); } catch { /* Remember it for this session. */ }
  }, [offer, keep, toast]);
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

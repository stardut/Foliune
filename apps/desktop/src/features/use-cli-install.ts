import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useToast } from '../components/ToastProvider';
import { cliInstallStatus, installCli, type CliInstallStatus } from '../lib/cli-install-api';

type State = { type: Exclude<CliInstallStatus, 'available'> | 'checking' | 'installing' }
  | { type: 'available'; cancelled?: boolean }
  | { type: 'checkError' | 'installError'; error: string };

const noticeKey = 'foliune:cli-install:notice';
export const cliExample = '用 foliune-cli 找出标了『窗光』的照片，加入一个新相簿。';
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
    const dismiss = fromNotice ? toast({ title: '正在安装命令行工具…', status: 'info', duration: null }) : undefined;
    try {
      const { status } = await installCli();
      if (status === 'installed') {
        setState({ type: 'installed' });
        if (fromNotice) toast({
          title: '命令行工具已安装',
          description: `试着对 AI 助手说\n${cliExample}\n\n终端帮助  ${cliHelp}`,
          duration: 12000,
        });
      } else {
        setState({ type: 'available', cancelled: true });
        if (fromNotice) toast({ title: '已取消安装，可在设置中重试', status: 'info' });
      }
    } catch (cause) {
      const error = message(cause);
      setState({ type: 'installError', error });
      if (fromNotice) toast({ title: `安装命令行工具失败：${error}`, status: 'error' });
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
      title: '让 AI 助手帮你整理图库',
      description: '支持调用终端的 AI 助手可以帮你查找照片、整理相簿，编辑画册和拍摄策划。',
      status: 'info',
      duration: null,
      action: { label: '安装命令行工具', onClick: () => install.current() },
      dismissLabel: '暂不安装',
    });
    try { localStorage.setItem(noticeKey, 'shown'); } catch { /* Remember it for this session. */ }
  }, [offer, keep, toast]);
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

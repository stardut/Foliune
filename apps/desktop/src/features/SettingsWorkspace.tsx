import { useEffect, useState, type FormEvent } from 'react';
import { ArchiveRestore, Check, Download, KeyRound, RefreshCw } from 'lucide-react';
import type { LibrarySnapshot } from '../lib/types';
import type { AiProviderSettings, AiSettings } from '../lib/ai-types';
import { loadAiSettings, saveAiSettings } from '../lib/ai-api';
import * as backup from '../lib/backup-api';
import { useToast } from '../components/ToastProvider';
import { Busy, Modal } from '../components/ui';
import { providerName } from './AiAnalysisPanel';
import './settings.css';

type Libraries = Awaited<ReturnType<typeof backup.listLibraries>>;
type Restored = NonNullable<Awaited<ReturnType<typeof backup.restoreBackup>>>;
export function SettingsWorkspace({ snapshot, onLibraryChanged, onBusyChange }: { snapshot: LibrarySnapshot; onLibraryChanged: (snapshot: LibrarySnapshot) => void; onBusyChange?: (busy: boolean) => void }) {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [libraries, setLibraries] = useState<Libraries | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [restored, setRestored] = useState<Restored | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  async function reload() {
    setLoading(true); setError('');
    const results = await Promise.allSettled([loadAiSettings(), backup.listLibraries()]);
    if (results[0].status === 'fulfilled') setAi(results[0].value); else setError(message(results[0].reason));
    if (results[1].status === 'fulfilled') setLibraries(results[1].value); else { const failure = message(results[1].reason); setError((previous) => [previous, failure].filter(Boolean).join('；')); }
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task(); } catch (cause) { if (restoreConfirm || restored) setError(message(cause)); else toast({ title: message(cause), status: 'error' }); } finally { setBusy(false); } }
  async function switchTo(id: string) {
    onBusyChange?.(true);
    try { const next = await backup.switchLibrary(id); onLibraryChanged(next); setAi(null); setLibraries(await backup.listLibraries()); setAi(await loadAiSettings()); setRestored(null); }
    finally { onBusyChange?.(false); }
  }
  return <section className="settings-workspace"><section className="workspace-intro"><div><h1>设置</h1></div><button type="button" className="text-button" disabled={busy || loading} onClick={() => void reload()}><RefreshCw size={13} />重新读取</button></section>{error && <div className="settings-feedback" role="alert">{error}</div>}{loading ? <Busy label="正在读取设置" /> : <div className="settings-sections"><section><div className="settings-section-title"><h2>图库与存储</h2><span>{snapshot.photos.length} 张照片 · {snapshot.groups.length} 个分组</span></div><div className="library-options">{libraries?.libraries.map((library) => <article key={library.id}><div><h3>{library.name}{library.id === libraries.currentId && <span>当前图库</span>}</h3><p className="library-path">{library.path}</p></div>{library.id === libraries.currentId ? <Check size={16} /> : <button className="button" type="button" disabled={busy} onClick={() => void run(() => switchTo(library.id))}>切换</button>}</article>)}</div></section><section><div className="settings-section-title"><h2>备份与恢复</h2></div><p className="muted">备份包含当前图库、照片与画册。恢复会建立新图库，现有图库保留。</p><div className="backup-actions"><button type="button" className="button" disabled={busy} onClick={() => void run(async () => { const result = await backup.createBackup(); if (result) toast({ title: `已备份 ${result.photoCount} 张照片至 ${result.path}` }); })}><Download size={14} />导出备份</button><button type="button" className="button" disabled={busy} onClick={() => setRestoreConfirm(true)}><ArchiveRestore size={14} />恢复为新图库</button></div></section><section><div className="settings-section-title"><h2>AI 接入</h2><span>可选 · 自备 API Key</span></div><p className="muted">Key 保存在系统凭据中。只有你主动触发分析时才会发送照片预览，人工标注独立保留。</p>{ai?.providers.map((provider) => <AiProviderForm key={`${provider.provider}:${provider.model}:${provider.hasKey}`} settings={provider} disabled={busy} onSave={async (input) => { const next = await saveAiSettings(input); setAi(next); toast({ title: '已保存 AI 设置' }); }} />)}<p className="capability-source">图像能力按所选模型启用。DeepSeek Flash 支持视觉；Pro 等纯文本模型不能用于照片分析。<a href="https://api-docs.deepseek.com/guides/vision/" target="_blank" rel="noreferrer">官方能力说明</a></p></section></div>}
    {restoreConfirm && <Modal title="恢复为新图库" onClose={() => { if (!busy) setRestoreConfirm(false); }}><p className="replacement-copy">接下来选择本地备份文件。Foliune 将恢复到新的图库目录，现有图库不会被覆盖。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setRestoreConfirm(false)}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void run(async () => { const result = await backup.restoreBackup(); setRestoreConfirm(false); if (result) { setRestored(result); setLibraries(await backup.listLibraries()); toast({ title: `已恢复 ${result.photoCount} 张照片至新图库` }); } })}>选择备份文件</button></div></Modal>}
    {restored && <Modal title="新图库已恢复" onClose={() => setRestored(null)}><p className="replacement-copy">{restored.library.name} · {restored.photoCount} 张照片</p><p className="replacement-path">{restored.library.path}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => setRestored(null)}>继续使用当前图库</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void run(() => switchTo(restored.library.id))}>切换到新图库</button></div></Modal>}
  </section>;
}

function AiProviderForm({ settings, disabled, onSave }: { settings: AiProviderSettings; disabled: boolean; onSave: (input: Parameters<typeof saveAiSettings>[0]) => Promise<void> }) {
  const [model, setModel] = useState(settings.model);
  const [vision, setVision] = useState(settings.vision);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const textOnly = settings.provider === 'deepseek' && ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'].includes(model.trim());
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onSave({ provider: settings.provider, model: model.trim(), vision: !textOnly && vision, ...(key.trim() ? { apiKey: key.trim() } : {}) }); setKey(''); } catch (cause) { toast({ title: message(cause), status: 'error' }); } finally { setBusy(false); } }
  return <form className="provider-form" onSubmit={(event) => void save(event)}><div className="provider-heading"><h3>{providerName(settings.provider)}</h3><span><KeyRound size={11} />{settings.hasKey ? 'Key 已保存' : '未配置 Key'}</span></div><div className="provider-fields"><label>模型<input required value={model} disabled={disabled || busy} onChange={(event) => setModel(event.target.value)} /></label><label>API Key<input type="password" autoComplete="off" value={key} disabled={disabled || busy} onChange={(event) => setKey(event.target.value)} placeholder={settings.hasKey ? '留空保留已保存的 Key' : '输入提供方的 API Key'} /></label></div><div className="provider-actions"><label><input type="checkbox" checked={!textOnly && vision} disabled={disabled || busy || textOnly} onChange={(event) => setVision(event.target.checked)} />此模型支持图像输入</label>{settings.hasKey && <button type="button" className="text-button" disabled={disabled || busy} onClick={() => { setBusy(true); void onSave({ provider: settings.provider, model: settings.model, vision: settings.vision, removeKey: true }).catch((cause) => toast({ title: message(cause), status: 'error' })).finally(() => setBusy(false)); }}>删除 Key</button>}<button className="button" type="submit" disabled={disabled || busy}>{busy ? '保存中…' : '保存'}</button></div></form>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

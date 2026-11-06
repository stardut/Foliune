import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Check, Download, RefreshCw } from 'lucide-react';
import { isLocalPhoto } from '../lib/photo-availability';
import type { LibrarySnapshot } from '../lib/types';
import * as backup from '../lib/backup-api';
import { useToast } from '../components/ToastProvider';
import { Busy, Modal, WorkspaceHeader } from '../components/ui';
import './settings.css';

type Libraries = Awaited<ReturnType<typeof backup.listLibraries>>;
type Restored = NonNullable<Awaited<ReturnType<typeof backup.restoreBackup>>>;
export function SettingsWorkspace({ snapshot, onLibraryChanged, onBusyChange }: { snapshot: LibrarySnapshot; onLibraryChanged: (snapshot: LibrarySnapshot) => void; onBusyChange?: (busy: boolean) => void }) {
  const [libraries, setLibraries] = useState<Libraries | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  function setWorking(value: boolean) { locked.current = value; setBusy(value); onBusyChange?.(value); }
  const [error, setError] = useState('');
  const toast = useToast();
  const [restored, setRestored] = useState<Restored | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  async function reload() {
    if (locked.current) return;
    setWorking(true); setLoading(true); setError(''); setLibraries(null);
    try {
      setLibraries(await backup.listLibraries());
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); setWorking(false); }
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function run(task: () => Promise<void>) {
    if (locked.current) return;
    setWorking(true); setError('');
    try { await task(); }
    catch (cause) { if (restoreConfirm || restored) setError(message(cause)); else toast({ title: message(cause), status: 'error' }); }
    finally { setWorking(false); }
  }
  async function switchTo(id: string) {
    const next = await backup.switchLibrary(id); onLibraryChanged(next);
    setLibraries(await backup.listLibraries()); setRestored(null);
  }
  return <section>
    <WorkspaceHeader title="设置">
      <button type="button" className="text-button" disabled={busy || loading} onClick={() => void reload()}><RefreshCw size={13} />重新读取</button>
    </WorkspaceHeader>
    <div className="settings-content">
      {error && <div className="settings-feedback" role="alert">{error}</div>}
      {loading ? <Busy label="正在读取设置" /> : <div className="settings-sections"><section><div className="settings-section-title"><h2>图库与存储</h2><span>{snapshot.photos.length} 张照片 · {snapshot.groups.length} 个分组</span></div><div className="library-options">{libraries?.libraries.map((library) => <article key={library.id}><div><h3>{library.name}{library.id === libraries.currentId && <span>当前图库</span>}</h3><p className="library-path">{library.path}</p></div>{library.id === libraries.currentId ? <Check size={16} /> : <button className="button" type="button" disabled={busy} onClick={() => void run(() => switchTo(library.id))}>切换</button>}</article>)}</div></section><section><div className="settings-section-title"><h2>备份与恢复</h2></div><p className="muted">备份包含当前图库、应用内照片与画册。恢复会建立新图库，现有图库保留。{snapshot.photos.some((photo) => photo.availability || isLocalPhoto(photo)) && '图库备份只保留外部照片的索引和缩略图，源文件需单独备份。'}</p><div className="backup-actions"><button type="button" className="button" disabled={busy} onClick={() => void run(async () => { const result = await backup.createBackup(); if (result) toast({ title: `图库备份已保存至 ${result.path}` }); })}><Download size={14} />导出备份</button><button type="button" className="button" disabled={busy} onClick={() => setRestoreConfirm(true)}><ArchiveRestore size={14} />恢复为新图库</button></div></section></div>}
    </div>
    {restoreConfirm && <Modal title="恢复为新图库" onClose={() => { if (!busy) setRestoreConfirm(false); }}><p className="replacement-copy">接下来选择本地备份文件。Foliune 将恢复到新的图库目录，现有图库不会被覆盖。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setRestoreConfirm(false)}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void run(async () => { const result = await backup.restoreBackup(); setRestoreConfirm(false); if (result) { setRestored(result); setLibraries(await backup.listLibraries()); toast({ title: `已恢复 ${result.photoCount} 张照片至新图库` }); } })}>选择备份文件</button></div></Modal>}
    {restored && <Modal title="新图库已恢复" onClose={() => setRestored(null)}><p className="replacement-copy">{restored.library.name} · {restored.photoCount} 张照片</p><p className="replacement-path">{restored.library.path}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => setRestored(null)}>继续使用当前图库</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void run(() => switchTo(restored.library.id))}>切换到新图库</button></div></Modal>}
  </section>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

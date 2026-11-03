import { useMemo, useState } from 'react';
import { Check, FolderPlus, Search } from 'lucide-react';
import { PhotoImage } from '../../components/PhotoImage';
import { libraryAlbums } from '../library-albums';
import { COLLAGE_MAX_EDGE, collageOutputProblem, resizeCollage, type CollageLayout } from './collage-layout';
import { Modal } from '../../components/ui';
import * as api from '../../lib/api';
import type { LibraryKind, LibrarySnapshot } from '../../lib/types';

export function CollageSaveDialog({ snapshot, library, sourceGroupId, layout, busy, error, onSnapshot, onBusyChange, onClose, onSave }: {
  snapshot: LibrarySnapshot; library: LibraryKind; sourceGroupId: string | null; layout: CollageLayout;
  busy: boolean; error: string; onSnapshot: (snapshot: LibrarySnapshot) => void; onBusyChange: (busy: boolean) => void; onClose: () => void;
  onSave: (title: string, groupId: string, longEdge: number) => Promise<void>;
}) {
  const originalLongEdge = Math.max(layout.width, layout.height);
  const [longEdge, setLongEdge] = useState(originalLongEdge);
  const output = resizeCollage(layout, longEdge || 1);
  const sizeProblem = !Number.isInteger(longEdge) || longEdge < 1 ? '请输入有效像素尺寸' : collageOutputProblem(output);
  const { albums } = useMemo(() => libraryAlbums(snapshot, library), [snapshot, library]);
  const [title, setTitle] = useState('拼图');
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState(sourceGroupId || '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const disabled = busy || localBusy;
  const groups = snapshot.groups.filter((group) => group.library === library && group.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  async function create() {
    setLocalError(''); setLocalBusy(true); onBusyChange(true);
    try {
      const next = await api.createGroup({ library, name: newName.trim() });
      const created = next.groups.find((group) => !snapshot.groups.some((old) => old.id === group.id));
      onSnapshot(next);
      if (created) setGroupId(created.id);
      setCreating(false); setNewName(''); setQuery('');
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLocalBusy(false); onBusyChange(false); }
  }
  return <Modal title="保存到相簿" onClose={() => { if (!disabled) onClose(); }}>
    <form className="collage-save-form" onSubmit={(event) => { event.preventDefault(); if (!disabled && title.trim() && groupId && !sizeProblem) void onSave(title.trim(), groupId, longEdge); }}>
      <label>名称<input autoFocus maxLength={120} value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="collage-save-dimensions"><span>PNG</span><span>{output.width.toLocaleString()} × {output.height.toLocaleString()} px</span></div>
      <label className="collage-output-size"><span>输出长边</span><div><input type="number" min="1" max={COLLAGE_MAX_EDGE} step="1" aria-label="输出长边像素" value={longEdge || ''} disabled={disabled} onChange={(event) => setLongEdge(Number(event.target.value))} /><span>px</span></div></label>
      {longEdge !== originalLongEdge && <div className="collage-save-album-heading"><span className="muted">{longEdge < originalLongEdge ? '已降低分辨率' : '放大不会增加原图细节'}</span><button type="button" className="text-button" disabled={disabled} onClick={() => setLongEdge(originalLongEdge)}>恢复原图尺寸</button></div>}
      {sizeProblem && <p className="form-error" role="alert">{sizeProblem}</p>}
      <div className="collage-save-album-heading"><span>相簿</span><button type="button" className="text-button" disabled={disabled} onClick={() => { setCreating(!creating); setLocalError(''); }}><FolderPlus size={14} />新建</button></div>
      {creating && <div className="collage-new-album"><input aria-label="新相簿名称" placeholder="相簿名称" value={newName} maxLength={120} disabled={disabled} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (newName.trim() && !disabled) void create(); } }} /><button type="button" className="button" disabled={disabled || !newName.trim()} onClick={() => void create()}>创建</button></div>}
      <div className="search-field"><Search size={15} /><input aria-label="搜索保存相簿" placeholder="搜索相簿" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="collage-save-albums" role="group" aria-label="选择保存相簿">{groups.map((group) => {
        const count = snapshot.memberships.filter((member) => member.groupId === group.id && member.status === 'active').length;
        const cover = albums.find((album) => album.group.id === group.id)?.photos[0];
        return <button type="button" key={group.id} disabled={disabled} aria-pressed={groupId === group.id} className={groupId === group.id ? 'is-selected' : ''} onClick={() => setGroupId(group.id)}><span className="collage-save-cover">{cover ? <PhotoImage photo={cover} lazy /> : <FolderPlus size={18} />}</span><span>{group.name}</span><small>{count}{group.capacity === null ? ' 张' : ` / ${group.capacity}`}</small>{groupId === group.id && <Check size={14} />}</button>;
      })}{!groups.length && <p className="muted">{snapshot.groups.some((group) => group.library === library) ? '没有匹配的相簿' : '新建相簿以保存拼图'}</p>}</div>
      {(error || localError) && <p className="form-error" role="alert">{localError || error}</p>}
      <div className="form-actions"><button type="button" className="button" disabled={disabled} onClick={onClose}>取消</button><button type="submit" className="button button-primary" disabled={disabled || !title.trim() || !groupId || !!sizeProblem}>{busy ? '正在生成…' : '保存'}</button></div>
    </form>
  </Modal>;
}

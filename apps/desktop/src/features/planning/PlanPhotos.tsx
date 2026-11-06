import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react';
import type { PlanReference } from '../../lib/planning-types';
import { PLAN_MAX_TEXT } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { PhotoImage } from '../../components/PhotoImage';
import { PhotoSourceDialog } from '../../components/PhotoSourceDialog';
import { IconButton } from '../../components/ui';
import { moved } from './plan-content';
import { PlanTextarea } from './PlanFields';

export function PlanPhotos({ references, photos, editing = false, disabled = false, maxSelection, onChange, onSnapshot, onBusyChange, layout = 'default' }: {
  references: PlanReference[]; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onBusyChange: (busy: boolean) => void; editing?: boolean; disabled?: boolean; maxSelection: number;
  onChange: (references: PlanReference[]) => void; layout?: 'default' | 'scene' | 'shot';
}) {
  const [picking, setPicking] = useState(false);
  const photoMap = new Map(photos.map((photo) => [photo.id, photo]));
  const refs = useRef(new Map<string, HTMLElement>());
  function move(index: number, offset: number) {
    if (disabled) return;
    onChange(moved(references, index, offset));
    requestAnimationFrame(() => refs.current.get(references[index].id)?.focus());
  }
  return <div className={`plan-reference-group is-${layout} count-${Math.min(references.length, 3)}`}>
    {!!references.length && <div className={`plan-photos ${editing ? 'is-editing' : ''}`}>{references.map((reference, index) => {
      const photo = photoMap.get(reference.photoId);
      return <figure className="plan-photo" key={reference.id} ref={(node) => { if (node) refs.current.set(reference.id, node); else refs.current.delete(reference.id); }}
        tabIndex={editing ? 0 : undefined} aria-label={editing ? `参考图 ${index + 1}，Alt 加方向键调整顺序` : undefined}
        onKeyDown={(event) => { if (editing && event.target === event.currentTarget && event.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(index, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1); } }}>
        <div className="plan-photo-image">{photo ? <PhotoImage photo={photo} lazy /> : <div className="plan-photo-missing" role="status">照片记录缺失</div>}</div>
        <figcaption>{editing && <div className="plan-photo-controls"><span>参考 {String(index + 1).padStart(2, '0')}</span><div className="workspace-tools"><IconButton label={`前移参考图 ${index + 1}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowLeft size={14} /></IconButton><IconButton label={`后移参考图 ${index + 1}`} disabled={disabled || index === references.length - 1} onClick={() => move(index, 1)}><ArrowRight size={14} /></IconButton><IconButton label={`移除参考图 ${index + 1}`} disabled={disabled} onClick={() => onChange(references.filter((ref) => ref.id !== reference.id))}><X size={14} /></IconButton></div></div>}
          {editing ? <label className="plan-field plan-reference-intent"><span>参考意图</span><PlanTextarea aria-label={`参考图 ${index + 1} 的参考意图`} rows={1} maxLength={PLAN_MAX_TEXT} value={reference.intent} placeholder="这张图借鉴什么" disabled={disabled} onChange={(event) => onChange(references.map((ref) => ref.id === reference.id ? { ...ref, intent: event.target.value } : ref))} /></label> : reference.intent.trim() && <p>{reference.intent}</p>}
        </figcaption>
      </figure>;
    })}</div>}
    {editing && <button type="button" className="button plan-add-photos" disabled={disabled || maxSelection === 0} onClick={() => setPicking(true)}><ImagePlus size={14} />{references.length ? '调整参考图' : '添加参考图'}</button>}
    {picking && createPortal(<PhotoSourceDialog library="collection" onBusyChange={onBusyChange} title={layout === 'scene' ? '选择场景参考 · 最多 3 张' : '选择参考图'} photos={photos} selectedIds={references.map((ref) => ref.photoId)} maxSelection={maxSelection} onClose={() => setPicking(false)} onConfirm={({ photoIds, snapshot }) => { if (snapshot) onSnapshot(snapshot); onChange(photoIds.map((photoId) => references.find((ref) => ref.photoId === photoId) ?? { id: crypto.randomUUID(), photoId, intent: '' })); setPicking(false); }} />, document.body)}
  </div>;
}

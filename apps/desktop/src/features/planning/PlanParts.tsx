import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PLAN_MAX_DATE, PLAN_MAX_PARTS, PLAN_MAX_REFERENCES, PLAN_MAX_SCENE_REFERENCES, PLAN_MAX_SHOTS, PLAN_MAX_TITLE, type PlanPart, type PlanShot, type ShootPlanInput } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { Modal } from '../../components/ui';
import { PlanField, PlanOrder, PlanTextarea } from './PlanFields';
import { PlanPhotos } from './PlanPhotos';
import { PlanShotList } from './PlanShots';
import { hasContent, moved, newPart, newShot, partFields, partName, referenceCount, shotCount, shotName } from './plan-content';

function reveal(id: string, focus = false) {
  const previous = document.activeElement;
  requestAnimationFrame(() => {
    const input = document.getElementById(`plan-name-${id}`);
    if (focus || !(previous instanceof HTMLElement) || !previous.isConnected || previous.matches(':disabled')) input?.focus({ preventScroll: true });
    else previous.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'nearest' });
  });
}

export function PlanParts({ value, snapshot, photos, editing, disabled, onChange, onSnapshot, onSourceBusyChange }: { value: ShootPlanInput; snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onSourceBusyChange: (busy: boolean) => void; editing: boolean; disabled: boolean; onChange: (value: ShootPlanInput) => void }) {
  const [deleting, setDeleting] = useState<{ label: string; remove: () => void } | null>(null);
  const [legacyStyling, setLegacyStyling] = useState(() => ({ editing, ids: new Set(value.parts.filter((part) => part.styling.trim()).map((part) => part.id)) }));
  // Keep an existing field mounted while its text is cleared and replaced during this edit.
  if (legacyStyling.editing !== editing) setLegacyStyling({ editing, ids: new Set(value.parts.filter((part) => part.styling.trim()).map((part) => part.id)) });
  const remainingReferences = PLAN_MAX_REFERENCES - referenceCount(value);
  const totalShots = shotCount(value);
  function addPart() {
    const part = newPart();
    onChange({ ...value, parts: [...value.parts, part] });
    reveal(part.id, true);
  }
  function addShot(part: PlanPart) {
    const shot = newShot();
    update({ ...part, shots: [...part.shots, shot] });
    reveal(shot.id, true);
  }
  function update(part: PlanPart) { onChange({ ...value, parts: value.parts.map((item) => item.id === part.id ? part : item) }); }
  function confirm(item: PlanPart | PlanShot, label: string, remove: () => void) { if (disabled) return; if (hasContent(item)) setDeleting({ label, remove }); else remove(); }
  return <section className="plan-parts" aria-label="拍摄场景">
    <header className="plan-section-heading"><h2>拍摄安排</h2>{editing && <button type="button" className="button" disabled={disabled || value.parts.length >= PLAN_MAX_PARTS} onClick={addPart}><Plus size={14} />添加场景</button>}</header>
    {!value.parts.length && <p className="plan-empty">{editing ? '添加第一个拍摄场景' : '暂无拍摄场景'}</p>}
    {value.parts.map((part, partIndex) => <section className="plan-part" key={part.id} aria-label={partName(part, partIndex)}>
      <header className="plan-part-heading"><span className="plan-scene-number">{String(partIndex + 1).padStart(2, '0')}</span><div className="plan-part-heading-content"><div className="plan-part-title"><div className="plan-scene-heading">{editing ? <PlanTextarea id={`plan-name-${part.id}`} rows={1} className="plan-inline-title" maxLength={PLAN_MAX_TITLE} aria-label={`场景 ${partIndex + 1} 名称`} placeholder="场景名称" value={part.title} onChange={(event) => update({ ...part, title: event.target.value })} /> : <h2>{partName(part, partIndex)}</h2>}
        {editing ? <label className="plan-field plan-scene-time-field"><span>拍摄时段</span><PlanTextarea rows={1} aria-label={`场景 ${partIndex + 1} 拍摄时段`} maxLength={PLAN_MAX_DATE} placeholder="16:30–17:15，日落前" value={part.timeWindow} onChange={(event) => update({ ...part, timeWindow: event.target.value })} /></label> : part.timeWindow.trim() && <span className="plan-scene-time">{part.timeWindow}</span>}</div>
        {editing && <PlanOrder label={`场景 ${partIndex + 1}`} index={partIndex} length={value.parts.length} disabled={disabled} move={(offset) => { onChange({ ...value, parts: moved(value.parts, partIndex, offset) }); reveal(part.id); }} remove={() => confirm(part, partName(part, partIndex), () => onChange({ ...value, parts: value.parts.filter((item) => item.id !== part.id) }))} />}</div>
        {(editing || part.description.trim()) && <div className="plan-part-context"><PlanField label="拍摄要点" value={part.description} onChange={editing ? (description) => update({ ...part, description }) : undefined} placeholder="这个场景的拍摄方向与共同安排" /></div>}</div></header>
      <div className={`plan-scene-overview scene-reference-count-${Math.min(part.references.length, 3)} ${!editing && !part.references.length ? 'without-references' : ''}`}>
        {(editing || !!part.references.length) && <section className="plan-part-references" aria-label="场景参考"><h3 className="plan-scene-section-title">参考图</h3><PlanPhotos snapshot={snapshot} layout="scene" references={part.references} photos={photos} onSnapshot={onSnapshot} onBusyChange={onSourceBusyChange} editing={editing} disabled={disabled} maxSelection={Math.min(PLAN_MAX_SCENE_REFERENCES, remainingReferences + part.references.length)} onChange={(references) => update({ ...part, references })} />{part.references.length > PLAN_MAX_SCENE_REFERENCES && <p className="form-error" role="alert">此场景已有 {part.references.length} 张参考，请移除至最多 3 张后保存。</p>}</section>}
        {(editing || partFields.some(([key]) => part[key].trim())) && <aside className="plan-part-facts" aria-label="场景参数"><h3 className="plan-scene-section-title">拍摄参数</h3><div className="plan-part-fact-fields">{partFields.filter(([key]) => key !== 'styling' || !!part.styling.trim() || (editing && legacyStyling.ids.has(part.id))).map(([key, label]) => <PlanField key={key} label={label} value={part[key]} onChange={editing ? (text) => update({ ...part, [key]: text }) : undefined} />)}</div></aside>}
      </div>
      <PlanShotList part={part} editing={editing} disabled={disabled} canAdd={totalShots < PLAN_MAX_SHOTS} onChange={update} onAdd={() => addShot(part)}
        onMove={(index, offset) => { update({ ...part, shots: moved(part.shots, index, offset) }); reveal(part.shots[index].id); }}
        onRemove={(shot, index) => confirm(shot, shotName(shot, index), () => update({ ...part, shots: part.shots.filter((item) => item.id !== shot.id) }))} />
    </section>)}
    {editing && value.parts.length > 0 && <button type="button" className="button plan-add-part" disabled={disabled || value.parts.length >= PLAN_MAX_PARTS} onClick={addPart}><Plus size={14} />添加场景</button>}
    {deleting && <Modal title={`删除“${deleting.label}”？`} onClose={() => { if (!disabled) setDeleting(null); }}><p>其中的拍摄内容与参考意图将一并移除，图库照片保留。</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={disabled} onClick={() => setDeleting(null)}>取消</button><button type="button" className="button button-danger" disabled={disabled} onClick={() => { deleting.remove(); setDeleting(null); }}>删除</button></div></Modal>}
  </section>;
}

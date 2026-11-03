import { Plus } from 'lucide-react';
import { PLAN_MAX_TITLE, type PlanPart, type PlanShot } from '../../lib/planning-types';
import { PlanField, PlanOrder } from './PlanFields';
import { priorityLabels, shotName } from './plan-content';

function Shot({ value, index, length, editing, disabled, onChange, onMove, onRemove }: {
  value: PlanShot; index: number; length: number; editing: boolean; disabled: boolean;
  onChange: (shot: PlanShot) => void; onMove: (offset: number) => void; onRemove: () => void;
}) {
  function field(key: 'description' | 'composition' | 'pose' | 'lighting' | 'mood', label: string, placeholder?: string) {
    return <PlanField label={label} value={value[key]} onChange={editing ? (text) => onChange({ ...value, [key]: text }) : undefined} placeholder={placeholder} />;
  }
  return <li className="plan-shot" aria-label={shotName(value, index)}>
    <span className="plan-sequence">{String(index + 1).padStart(2, '0')}</span>
    <div className="plan-shot-body">
      <header className="plan-shot-heading"><div className="plan-shot-name">
        {editing ? <input id={`plan-name-${value.id}`} className="plan-inline-title" aria-label={`镜头 ${index + 1} 名称`} maxLength={PLAN_MAX_TITLE} placeholder="镜头名称" value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /> : <><h4>{shotName(value, index)}</h4>{value.priority !== 'normal' && <span className={`plan-priority is-${value.priority}`}>{priorityLabels[value.priority]}</span>}</>}</div>
        {editing && <div className="plan-shot-controls"><select aria-label={`镜头 ${index + 1} 优先级`} value={value.priority} onChange={(event) => onChange({ ...value, priority: event.target.value as PlanShot['priority'] })}>{Object.entries(priorityLabels).map(([priority, label]) => <option value={priority} key={priority}>{label}</option>)}</select><PlanOrder label={`镜头 ${index + 1}`} index={index} length={length} disabled={disabled} move={onMove} remove={onRemove} /></div>}
      </header>
      {(editing || value.description.trim()) && <div className="plan-shot-method">{field('description', '关键拍法', '动作与抓拍时机')}</div>}
      {(editing || [value.composition, value.pose, value.lighting, value.mood].some((text) => text.trim())) && <div className="plan-shot-detail">{field('composition', '构图')}{field('pose', '姿态')}{field('lighting', '光线')}{field('mood', '情绪')}</div>}
      {value.references.some((reference) => reference.intent.trim()) && <div className="plan-reference-notes plan-shot-reference-notes"><span>参考要点</span><div>{value.references.filter((reference) => reference.intent.trim()).map((reference) => <p key={reference.id}>{reference.intent}</p>)}</div></div>}
    </div>
  </li>;
}

export function PlanShotList({ part, editing, disabled, canAdd, onChange, onAdd, onMove, onRemove }: {
  part: PlanPart; editing: boolean; disabled: boolean; canAdd: boolean;
  onChange: (part: PlanPart) => void; onAdd: () => void; onMove: (index: number, offset: number) => void; onRemove: (shot: PlanShot, index: number) => void;
}) {
  return <section className="plan-shot-list" aria-label="镜头清单">
    <header className="plan-shot-list-heading"><h3>镜头清单</h3>{editing && <button type="button" className="button" disabled={disabled || !canAdd} onClick={onAdd}><Plus size={14} />添加镜头</button>}</header>
    {!!part.shots.length && <ol className="plan-shots">{part.shots.map((shot, index) => <Shot key={shot.id} value={shot} index={index} length={part.shots.length} editing={editing} disabled={disabled}
      onChange={(next) => onChange({ ...part, shots: part.shots.map((item) => item.id === next.id ? next : item) })}
      onMove={(offset) => onMove(index, offset)} onRemove={() => onRemove(shot, index)} />)}</ol>}
    {!part.shots.length && <p className="plan-empty">暂无镜头</p>}
  </section>;
}

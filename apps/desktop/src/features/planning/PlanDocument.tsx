import { PLAN_MAX_DATE, PLAN_MAX_REFERENCES, PLAN_MAX_TITLE, type ShootPlanInput } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { DatePickerField } from '../../components/DatePickerField';
import { PlanField } from './PlanFields';
import { PlanParts } from './PlanParts';
import { PlanPhotos } from './PlanPhotos';
import { referenceCount, sharedFields } from './plan-content';

export function PlanDocument({ value, snapshot, photos, editing, disabled, executionDateErrorId, onChange, onSnapshot, onSourceBusyChange }: {
  value: ShootPlanInput; snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onSourceBusyChange: (busy: boolean) => void;
  editing: boolean; disabled: boolean; executionDateErrorId?: string; onChange: (value: ShootPlanInput) => void;
}) {
  const info = [['shootDate', '拍摄时间'], ['location', '地点'], ['team', '出镜与团队'], ['deliverables', '成片与用途']] as const;
  const maxPlanReferences = PLAN_MAX_REFERENCES - (referenceCount(value) - value.references.length);
  return <article className={`plan-document ${editing ? 'is-editing' : 'is-reading'}`}><fieldset className="plan-document-fields" disabled={disabled}>
    <header className="plan-document-heading">{editing ? <label className="plan-title-field"><span>策划标题</span><input name="title" autoFocus required maxLength={PLAN_MAX_TITLE} aria-label="策划标题" placeholder="为这次拍摄命名" value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label> : <h1>{value.title}</h1>}
      <PlanField label="创作构想" value={value.concept} onChange={editing ? (concept) => onChange({ ...value, concept }) : undefined} placeholder="想为谁拍，想得到怎样的一组照片" />
      <div className="plan-meta">
        {editing ? <DatePickerField label="执行日期" name="executionDate" value={value.executionDate} disabled={disabled} errorId={executionDateErrorId}
          onChange={(executionDate) => onChange({ ...value, executionDate })} />
          : <div className="plan-copy"><h3>执行日期</h3><p>{value.executionDate ? <time dateTime={value.executionDate}>{value.executionDate}</time> : '未设置'}</p></div>}
        {info.map(([key, label]) => <PlanField key={key} label={label} value={value[key]} maxLength={key === 'shootDate' ? PLAN_MAX_DATE : undefined} onChange={editing ? (text) => onChange({ ...value, [key]: text }) : undefined} />)}
      </div>
    </header>
    {(editing || value.visualDirection.trim()) && <section className="plan-visual" aria-label="整体视觉"><PlanField label="整体视觉" value={value.visualDirection} onChange={editing ? (visualDirection) => onChange({ ...value, visualDirection }) : undefined} placeholder="整组共用的色彩、气质或视觉约定" /></section>}
    {(editing || value.references.length > 0) && <section className="plan-overall-references" aria-label="全案参考图">
      <h2>参考图</h2>
      <PlanPhotos references={value.references} snapshot={snapshot} photos={photos} editing={editing} disabled={disabled}
        maxSelection={maxPlanReferences} onSnapshot={onSnapshot} onBusyChange={onSourceBusyChange}
        onChange={(references) => onChange({ ...value, references })} />
    </section>}
    {(editing || sharedFields.some(([key]) => value[key].trim())) && <section className="plan-shared-preparation" aria-label="整组准备"><h2>整组准备</h2><div className="plan-shared-fields">{sharedFields.map(([key, label]) => <PlanField key={key} label={label} value={value[key]} onChange={editing ? (text) => onChange({ ...value, [key]: text }) : undefined} />)}</div></section>}
    <PlanParts snapshot={snapshot} value={value} photos={photos} onSnapshot={onSnapshot} onSourceBusyChange={onSourceBusyChange} editing={editing} disabled={disabled} onChange={onChange} />
    {(editing || value.preparation.trim()) && <section className="plan-preparation"><h2>执行准备</h2><PlanField label="日程与准备" value={value.preparation} onChange={editing ? (preparation) => onChange({ ...value, preparation }) : undefined} placeholder="集合、转场、物品与注意事项" /></section>}
  </fieldset></article>;
}

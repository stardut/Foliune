import { t } from '../../lib/i18n';
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
  const info = [['shootDate', t('拍摄时间', 'Shoot Hours')], ['location', t('地点', 'Location')], ['team', t('出镜与团队', 'Cast and Crew')], ['deliverables', t('成片与用途', 'Deliverables and Usage')]] as const;
  const maxPlanReferences = PLAN_MAX_REFERENCES - (referenceCount(value) - value.references.length);
  return <article className={`plan-document ${editing ? 'is-editing' : 'is-reading'}`}><fieldset className="plan-document-fields" disabled={disabled}>
    <header className="plan-document-heading">{editing ? <label className="plan-title-field"><span>{t('策划标题', 'Plan Title')}</span><input name="title" autoFocus required maxLength={PLAN_MAX_TITLE} aria-label={t('策划标题', 'Plan Title')} placeholder={t('为这次拍摄命名', 'Give this shoot a name')} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label> : <h1>{value.title}</h1>}
      <PlanField label={t('创作构想', 'Concept')} value={value.concept} onChange={editing ? (concept) => onChange({ ...value, concept }) : undefined} placeholder={t('想为谁拍，想得到怎样的一组照片', 'Who is the shoot for, and what images are you aiming for?')} />
      <div className="plan-meta">
        {editing ? <DatePickerField label={t('执行日期', 'Shoot Date')} name="executionDate" value={value.executionDate} disabled={disabled} errorId={executionDateErrorId}
          onChange={(executionDate) => onChange({ ...value, executionDate })} />
          : <div className="plan-copy"><h3>{t('执行日期', 'Shoot Date')}</h3><p>{value.executionDate ? <time dateTime={value.executionDate}>{value.executionDate}</time> : t('未设置', 'Not Set')}</p></div>}
        {info.map(([key, label]) => <PlanField key={key} label={label} value={value[key]} maxLength={key === 'shootDate' ? PLAN_MAX_DATE : undefined} onChange={editing ? (text) => onChange({ ...value, [key]: text }) : undefined} />)}
      </div>
    </header>
    {(editing || value.visualDirection.trim()) && <section className="plan-visual" aria-label={t('整体视觉', 'Visual Direction')}><PlanField label={t('整体视觉', 'Visual Direction')} value={value.visualDirection} onChange={editing ? (visualDirection) => onChange({ ...value, visualDirection }) : undefined} placeholder={t('整组共用的色彩、气质或视觉约定', 'Palette, mood, or visual direction for the shoot')} /></section>}
    {(editing || value.references.length > 0) && <section className="plan-overall-references" aria-label={t('全案参考图', 'Overall References')}>
      <h2>{t('参考图', 'Reference Photos')}</h2>
      <PlanPhotos references={value.references} snapshot={snapshot} photos={photos} editing={editing} disabled={disabled}
        maxSelection={maxPlanReferences} onSnapshot={onSnapshot} onBusyChange={onSourceBusyChange}
        onChange={(references) => onChange({ ...value, references })} />
    </section>}
    {(editing || sharedFields.some(([key]) => value[key].trim())) && <section className="plan-shared-preparation" aria-label={t('整组准备', 'Shoot Setup')}><h2>{t('整组准备', 'Shoot Setup')}</h2><div className="plan-shared-fields">{sharedFields.map(([key, label]) => <PlanField key={key} label={label} value={value[key]} onChange={editing ? (text) => onChange({ ...value, [key]: text }) : undefined} />)}</div></section>}
    <PlanParts snapshot={snapshot} value={value} photos={photos} onSnapshot={onSnapshot} onSourceBusyChange={onSourceBusyChange} editing={editing} disabled={disabled} onChange={onChange} />
    {(editing || value.preparation.trim()) && <section className="plan-preparation"><h2>{t('执行准备', 'Logistics')}</h2><PlanField label={t('日程与准备', 'Schedule and Checklist')} value={value.preparation} onChange={editing ? (preparation) => onChange({ ...value, preparation }) : undefined} placeholder={t('集合、转场、物品与注意事项', 'Meetup, travel between locations, equipment, and notes')} /></section>}
  </fieldset></article>;
}

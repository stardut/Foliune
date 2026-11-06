import { useId } from 'react';
import type { ModelInput } from '../../lib/model-types';
import { defaultModelStyles, ModelStyleTags } from './ModelStyleTags';

export type ModelDraft = Omit<ModelInput, 'heightCm' | 'weightKg'> & { heightCm: string; weightKg: string };

export function ModelFields({ value, onChange, disabled }: { value: ModelDraft; onChange: (value: ModelDraft) => void; disabled: boolean }) {
  const genderId = useId();
  const set = <K extends keyof ModelDraft>(key: K, next: ModelDraft[K]) => onChange({ ...value, [key]: next });
  return <div className="model-fields">
    <fieldset disabled={disabled} aria-label="基本资料">
      <label>姓名／昵称<input required maxLength={200} autoComplete="off" value={value.name} onChange={(event) => set('name', event.target.value)} /></label>
      <label>联系方式<input maxLength={500} value={value.contact} onChange={(event) => set('contact', event.target.value)} /></label>
      <label>常驻城市<input maxLength={200} value={value.city} onChange={(event) => set('city', event.target.value)} /></label>
      <div className="model-gender-field">
        <span id={genderId}>性别</span>
        <div className="model-style-options" role="group" aria-labelledby={genderId}>
          {['女', '男'].map((gender) => <button type="button" className="model-style-tag" key={gender} aria-pressed={value.gender === gender} disabled={disabled}
            onClick={() => { if (!disabled) set('gender', value.gender === gender ? '' : gender); }}><span>{gender}</span></button>)}
        </div>
      </div>
      <label>生日<input type="text" placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" maxLength={10} value={value.birthday} onChange={(event) => set('birthday', event.target.value)} /></label>
      <div className="model-measurements">
        <label>身高（cm）<input inputMode="decimal" value={value.heightCm} onChange={(event) => set('heightCm', event.target.value)} /></label>
        <label>体重（kg）<input inputMode="decimal" value={value.weightKg} onChange={(event) => set('weightKg', event.target.value)} /></label>
      </div>
      <ModelStyleTags value={value.tags} options={value.tagOptions ?? [...new Set([...defaultModelStyles, ...value.tags])]} onChange={(tags, tagOptions) => onChange({ ...value, tags, tagOptions })} disabled={disabled} />
      <label className="model-notes-field">备注<textarea rows={2} maxLength={20000} value={value.notes} onChange={(event) => set('notes', event.target.value)} /></label>
    </fieldset>
  </div>;
}

import { t } from '../../lib/i18n';
import { cropFor, type CollageState, type CollageFrame, type CollageMode } from './collage-layout';

export function CollageTools({ state, activeId, editing, disabled, onChange, onEditing }: {
  state: CollageState; activeId: string | null; editing: boolean; disabled: boolean;
  onChange: (state: CollageState, commit?: boolean) => void; onEditing: (editing: boolean) => void;
}) {
  const crop = activeId ? cropFor(state, activeId) : null;
  function patch<K extends keyof CollageState>(key: K, value: CollageState[K], commit = true) { onChange({ ...state, [key]: value }, commit); }
  function finishRange() { onChange(state, true); }
  return <aside className="collage-tools" aria-label={t('拼图工具', 'Collage Tools')}><fieldset disabled={disabled}>
    <div className="collage-tool-group"><h2>{t('布局', 'Layout')}</h2><div className="collage-mode-picker">{([['adaptive', t('自适应', 'Adaptive')], ['grid', t('网格', 'Grid')], ['long', t('长图', 'Long Strip')]] as [CollageMode, string][]).map(([mode, label]) => <button type="button" key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'is-selected' : ''} onClick={() => { patch('mode', mode); onEditing(false); }}><span className={`collage-layout-glyph glyph-${mode}`} aria-hidden="true"><i /><i /><i /><i /></span>{label}</button>)}</div></div>
    <div className="collage-tool-group"><h2>{t('画幅', 'Aspect Ratio')}</h2><div className="collage-frame-picker">{([['auto', t('自动', 'Auto')], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3']] as [CollageFrame, string][]).map(([frame, label]) => <button type="button" key={frame} className={state.frame === frame ? 'is-selected' : ''} aria-pressed={state.frame === frame} onClick={() => patch('frame', frame)}>{label}</button>)}</div></div>
    <div className="collage-tool-group collage-range-group">
      <label><span>{t('间距', 'Spacing')}<output>{state.gap}</output></span><input type="range" min="0" max="80" step="2" value={state.gap} onChange={(event) => patch('gap', Number(event.target.value), false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>
      <label><span>{t('留白', 'Margin')}<output>{state.margin}</output></span><input type="range" min="0" max="180" step="4" value={state.margin} onChange={(event) => patch('margin', Number(event.target.value), false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>
    </div>
    <div className="collage-tool-group"><h2>{t('背景', 'Background')}</h2><div className="collage-background-picker">{[['#FFFFFF', t('白', 'White')], ['#191919', t('黑', 'Black')], ['#A4A4A4', t('灰', 'Gray')]].map(([color, label]) => <button type="button" key={color} aria-label={t(`${label}色背景`, `${label} background`)} title={t(`${label}色`, `${label}`)} aria-pressed={state.background === color} className={state.background === color ? 'is-selected' : ''} style={{ background: color }} onClick={() => patch('background', color)} />)}</div></div>
    {state.mode === 'grid' && crop && activeId && <div className="collage-tool-group collage-crop-tools"><h2>{t('当前照片', 'Current Photo')}</h2><div className="collage-fit-picker"><button type="button" aria-pressed={crop.fit === 'cover'} className={crop.fit === 'cover' ? 'is-selected' : ''} onClick={() => patch('crops', { ...state.crops, [activeId]: { ...crop, fit: 'cover' } })}>{t('填满', 'Fill')}</button><button type="button" aria-pressed={crop.fit === 'contain'} className={crop.fit === 'contain' ? 'is-selected' : ''} onClick={() => { patch('crops', { ...state.crops, [activeId]: { fit: 'contain', zoom: 1, offsetX: .5, offsetY: .5 } }); onEditing(false); }}>{t('完整显示', 'Fit')}</button></div>
      {crop.fit === 'cover' && <><button type="button" className={`button ${editing ? 'is-active' : ''}`} onClick={() => onEditing(!editing)}>{editing ? t('完成调整', 'Done') : t('调整裁切', 'Adjust Crop')}</button>{editing && <label className="collage-crop-zoom"><span>{t('缩放', 'Zoom')}<output>{crop.zoom.toFixed(2)}×</output></span><input type="range" min="1" max="4" step="0.02" value={crop.zoom} onChange={(event) => patch('crops', { ...state.crops, [activeId]: { ...crop, zoom: Number(event.target.value) } }, false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>}</>}
    </div>}
  </fieldset></aside>;
}

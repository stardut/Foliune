import { cropFor, type CollageState, type CollageFrame, type CollageMode } from './collage-layout';

export function CollageTools({ state, activeId, editing, disabled, onChange, onEditing }: {
  state: CollageState; activeId: string | null; editing: boolean; disabled: boolean;
  onChange: (state: CollageState, commit?: boolean) => void; onEditing: (editing: boolean) => void;
}) {
  const crop = activeId ? cropFor(state, activeId) : null;
  function patch<K extends keyof CollageState>(key: K, value: CollageState[K], commit = true) { onChange({ ...state, [key]: value }, commit); }
  function finishRange() { onChange(state, true); }
  return <aside className="collage-tools" aria-label="拼图工具"><fieldset disabled={disabled}>
    <div className="collage-tool-group"><h2>布局</h2><div className="collage-mode-picker">{([['adaptive', '自适应'], ['grid', '网格'], ['long', '长图']] as [CollageMode, string][]).map(([mode, label]) => <button type="button" key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'is-selected' : ''} onClick={() => { patch('mode', mode); onEditing(false); }}><span className={`collage-layout-glyph glyph-${mode}`} aria-hidden="true"><i /><i /><i /><i /></span>{label}</button>)}</div></div>
    <div className="collage-tool-group"><h2>画幅</h2><div className="collage-frame-picker">{([['auto', '自动'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3']] as [CollageFrame, string][]).map(([frame, label]) => <button type="button" key={frame} className={state.frame === frame ? 'is-selected' : ''} aria-pressed={state.frame === frame} onClick={() => patch('frame', frame)}>{label}</button>)}</div></div>
    <div className="collage-tool-group collage-range-group">
      <label><span>间距<output>{state.gap}</output></span><input type="range" min="0" max="80" step="2" value={state.gap} onChange={(event) => patch('gap', Number(event.target.value), false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>
      <label><span>留白<output>{state.margin}</output></span><input type="range" min="0" max="180" step="4" value={state.margin} onChange={(event) => patch('margin', Number(event.target.value), false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>
    </div>
    <div className="collage-tool-group"><h2>背景</h2><div className="collage-background-picker">{[['#FFFFFF', '白'], ['#191919', '黑'], ['#A4A4A4', '灰']].map(([color, label]) => <button type="button" key={color} aria-label={`${label}色背景`} title={`${label}色`} aria-pressed={state.background === color} className={state.background === color ? 'is-selected' : ''} style={{ background: color }} onClick={() => patch('background', color)} />)}</div></div>
    {state.mode === 'grid' && crop && activeId && <div className="collage-tool-group collage-crop-tools"><h2>当前照片</h2><div className="collage-fit-picker"><button type="button" aria-pressed={crop.fit === 'cover'} className={crop.fit === 'cover' ? 'is-selected' : ''} onClick={() => patch('crops', { ...state.crops, [activeId]: { ...crop, fit: 'cover' } })}>填满</button><button type="button" aria-pressed={crop.fit === 'contain'} className={crop.fit === 'contain' ? 'is-selected' : ''} onClick={() => { patch('crops', { ...state.crops, [activeId]: { fit: 'contain', zoom: 1, offsetX: .5, offsetY: .5 } }); onEditing(false); }}>完整显示</button></div>
      {crop.fit === 'cover' && <><button type="button" className={`button ${editing ? 'is-active' : ''}`} onClick={() => onEditing(!editing)}>{editing ? '完成调整' : '调整裁切'}</button>{editing && <label className="collage-crop-zoom"><span>缩放<output>{crop.zoom.toFixed(2)}×</output></span><input type="range" min="1" max="4" step="0.02" value={crop.zoom} onChange={(event) => patch('crops', { ...state.crops, [activeId]: { ...crop, zoom: Number(event.target.value) } }, false)} onPointerUp={finishRange} onKeyUp={finishRange} onBlur={finishRange} /></label>}</>}
    </div>}
  </fieldset></aside>;
}

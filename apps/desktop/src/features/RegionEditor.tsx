import { useRef, useState, type PointerEvent } from 'react';
import { Plus, Scan, Trash2 } from 'lucide-react';
import type { Photo, PhotoRegion } from '../lib/types';
import { IconButton } from '../components/ui';

export function RegionEditor({ photo, regions, onChange }: { photo: Photo; regions: PhotoRegion[]; onChange: (regions: PhotoRegion[]) => void }) {
  const [drawing, setDrawing] = useState(false);
  const [preview, setPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  }
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!drawing || event.button !== 0) return;
    event.preventDefault(); start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId);
    setPreview({ ...start.current, width: 0, height: 0 });
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const current = point(event); const origin = start.current;
    setPreview({ x: Math.min(current.x, origin.x), y: Math.min(current.y, origin.y), width: Math.abs(current.x - origin.x), height: Math.abs(current.y - origin.y) });
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const current = point(event), origin = start.current;
    const bounds = { x: Math.min(current.x, origin.x), y: Math.min(current.y, origin.y), width: Math.abs(current.x - origin.x), height: Math.abs(current.y - origin.y) };
    start.current = null; setPreview(null);
    if (bounds.width < .01 || bounds.height < .01) return;
    const id = crypto.randomUUID(); onChange([...regions, { id, ...bounds, text: '' }]); setActive(id); setDrawing(false);
  }
  function addWithKeyboard() { const id = crypto.randomUUID(); onChange([...regions, { id, x: .25, y: .25, width: .5, height: .5, text: '' }]); setActive(id); }
  if (!photo.originalAvailable || imageFailed) return <p className="muted">重新定位原图后可编辑区域标注。</p>;
  return <section className="region-editor"><div className="region-toolbar"><span>区域标注 · {regions.length}</span><button type="button" className={`button ${drawing ? 'button-primary' : ''}`} onClick={() => setDrawing(!drawing)}><Scan size={13} />{drawing ? '取消框选' : '框选区域'}</button><IconButton label="添加居中标注框，可用下方坐标编辑" onClick={addWithKeyboard}><Plus size={15} /></IconButton></div>
    <div className={`region-image ${drawing ? 'drawing' : ''}`} style={{ maxWidth: `${55 * photo.width / photo.height}vh` }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { start.current = null; setPreview(null); }}>
      <img src={photo.originalUrl} width={photo.width} height={photo.height} alt={photo.title} draggable={false} onError={() => setImageFailed(true)} />
      {regions.map((region, index) => <button type="button" key={region.id} className={`region-box ${active === region.id ? 'region-active' : ''}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} aria-label={`标注 ${index + 1}：${region.text || '未填写'}`} onClick={() => setActive(region.id)}><span>{index + 1}</span></button>)}
      {preview && <span className="region-box region-preview" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.width * 100}%`, height: `${preview.height * 100}%` }} />}
    </div>
    {drawing && <p className="muted">在照片上拖动，框选想要标注的区域。</p>}
    <div className="region-list">{regions.map((region, index) => <div key={region.id} className={active === region.id ? 'active' : ''} onFocus={() => setActive(region.id)}><label><span>区域 {index + 1}</span><textarea rows={2} value={region.text} placeholder="写下这个区域的观察" onChange={(event) => onChange(regions.map((item) => item.id === region.id ? { ...item, text: event.target.value } : item))} /></label><div className="region-coordinates">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{({ x: '左', y: '上', width: '宽', height: '高' })[key]} %<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'y' ? 99 : 100} step={1} value={Math.round(region[key] * 100)} onChange={(event) => { const value = Number(event.target.value) / 100; onChange(regions.map((item) => { if (item.id !== region.id) return item; const updated = { ...item, [key]: Math.min(key === 'x' || key === 'y' ? .99 : 1, Math.max(key === 'width' || key === 'height' ? .01 : 0, value)) }; updated.width = Math.min(updated.width, 1 - updated.x); updated.height = Math.min(updated.height, 1 - updated.y); return updated; })); }} /></label>)}<IconButton label={`删除区域 ${index + 1}`} onClick={() => onChange(regions.filter((item) => item.id !== region.id))}><Trash2 size={14} /></IconButton></div></div>)}</div>
  </section>;
}

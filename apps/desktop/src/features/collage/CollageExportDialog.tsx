import { useState } from 'react';
import { Modal } from '../../components/ui';
import { COLLAGE_MAX_EDGE, collageOutputProblem, resizeCollage, type CollageLayout } from './collage-layout';

export function CollageExportDialog({ layout, busy, error, onClose, onExport }: {
  layout: CollageLayout;
  busy: 'directory' | 'export' | null;
  error: string;
  onClose: () => void;
  onExport: (title: string, longEdge: number) => Promise<void>;
}) {
  const originalLongEdge = Math.max(layout.width, layout.height);
  const [longEdge, setLongEdge] = useState(originalLongEdge);
  const [title, setTitle] = useState('拼图');
  if (busy === 'directory') return null;
  const output = resizeCollage(layout, longEdge || 1);
  const sizeProblem = !Number.isInteger(longEdge) || longEdge < 1 ? '请输入有效像素尺寸' : collageOutputProblem(output);
  return <Modal title="导出 PNG" onClose={busy ? undefined : onClose}>
    <form className="collage-export-form" onSubmit={(event) => { event.preventDefault(); if (!busy && title.trim() && !sizeProblem) void onExport(title.trim(), longEdge); }}>
      <label>文件名<input autoFocus maxLength={120} value={title} disabled={!!busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="collage-export-dimensions"><span>PNG</span><span>{output.width.toLocaleString()} × {output.height.toLocaleString()} px</span></div>
      <label className="collage-output-size"><span>输出长边</span><div><input type="number" min="1" max={COLLAGE_MAX_EDGE} step="1" aria-label="输出长边像素" value={longEdge || ''} disabled={!!busy} onChange={(event) => setLongEdge(Number(event.target.value))} /><span>px</span></div></label>
      {longEdge !== originalLongEdge && <div className="collage-export-adjustment"><span className="muted">{longEdge < originalLongEdge ? '已降低分辨率' : '放大不会增加原图细节'}</span><button type="button" className="text-button" disabled={!!busy} onClick={() => setLongEdge(originalLongEdge)}>恢复原图尺寸</button></div>}
      {sizeProblem && <p className="form-error" role="alert">{sizeProblem}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button" disabled={!!busy} onClick={onClose}>取消</button><button type="submit" className="button button-primary" disabled={!!busy || !title.trim() || !!sizeProblem}>{busy === 'export' ? '正在导出…' : '选择目录并导出'}</button></div>
    </form>
  </Modal>;
}

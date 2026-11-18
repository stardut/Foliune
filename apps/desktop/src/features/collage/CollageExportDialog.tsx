import { getLocale, t } from '../../lib/i18n';
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
  const [title, setTitle] = useState(t('拼图', 'Collage'));
  if (busy === 'directory') return null;
  const output = resizeCollage(layout, longEdge || 1);
  const sizeProblem = !Number.isInteger(longEdge) || longEdge < 1 ? t('请输入有效像素尺寸', 'Enter a valid size in pixels') : collageOutputProblem(output);
  return <Modal title={t('导出 PNG', 'Export PNG')} onClose={busy ? undefined : onClose}>
    <form className="collage-export-form" onSubmit={(event) => { event.preventDefault(); if (!busy && title.trim() && !sizeProblem) void onExport(title.trim(), longEdge); }}>
      <label>{t('文件名', 'File Name')}<input autoFocus maxLength={120} value={title} disabled={!!busy} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="collage-export-dimensions"><span>PNG</span><span>{output.width.toLocaleString(getLocale())} × {output.height.toLocaleString(getLocale())} px</span></div>
      <label className="collage-output-size"><span>{t('输出长边', 'Long Edge')}</span><div><input type="number" min="1" max={COLLAGE_MAX_EDGE} step="1" aria-label={t('输出长边像素', 'Long Edge in Pixels')} value={longEdge || ''} disabled={!!busy} onChange={(event) => setLongEdge(Number(event.target.value))} /><span>px</span></div></label>
      {longEdge !== originalLongEdge && <div className="collage-export-adjustment"><span className="muted">{longEdge < originalLongEdge ? t('已降低分辨率', 'Resolution reduced') : t('放大不会增加原图细节', 'Upscaling does not add detail')}</span><button type="button" className="text-button" disabled={!!busy} onClick={() => setLongEdge(originalLongEdge)}>{t('恢复原图尺寸', 'Restore Original Size')}</button></div>}
      {sizeProblem && <p className="form-error" role="alert">{sizeProblem}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button" disabled={!!busy} onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={!!busy || !title.trim() || !!sizeProblem}>{busy === 'export' ? t('正在导出…', 'Exporting…') : t('选择目录并导出', 'Choose Folder and Export')}</button></div>
    </form>
  </Modal>;
}

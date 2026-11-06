import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PhotoImage } from '../../components/PhotoImage';
import type { Photo } from '../../lib/types';
import { coverFontFamily, designCoverTitle, fitCoverTitle, loadCoverSample, validCoverSize, type CoverSample, type TitleLayout, type TitlePlacement } from './book-cover-design';
import './book-cover-fonts.css';

type CoverDesign = { key: string; layout?: TitleLayout; placement: TitlePlacement; error?: string };
const safePlacement: TitlePlacement = { x: .08, y: .07, color: '#f8f4eb', outline: '#171716', reinforced: true, score: 0 };
// Only successful, fully keyed designs survive a workspace unmount. Never keep
// the workspace itself alive, or reuse a failure after fonts/files recover.
const designs = new Map<string, CoverDesign>();
function rememberDesign(design: CoverDesign) {
  designs.delete(design.key); designs.set(design.key, design);
  if (designs.size > 128) designs.delete(designs.keys().next().value!);
}
function scheduleDesign(run: () => void) {
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(run, { timeout: 200 });
    return () => window.cancelIdleCallback(id);
  }
  // Older WebViews still get an opportunity to paint the arriving shelf.
  const id = window.setTimeout(run, 16);
  return () => window.clearTimeout(id);
}

export function BookCover({ title, photo, hasPhotos, busy }: { title: string; photo?: Photo; hasPhotos: boolean; busy: boolean }) {
  const button = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [nearby, setNearby] = useState(false);
  const [design, setDesign] = useState<CoverDesign>();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = photo?.thumbnailUrl;
  const validSize = !!photo && validCoverSize(photo.width, photo.height);
  const available = !!photo?.originalAvailable && !!photo?.thumbnailAvailable && validSize && failedSource !== source;
  const key = JSON.stringify([source, title, width, available, photo?.width, photo?.height, photo?.regions]);
  useLayoutEffect(() => {
    const element = button.current;
    if (!element) return;
    const update = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    const resize = new ResizeObserver(update);
    update(); resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { root: element.closest('main'), rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width || !nearby) return;
    const cached = designs.get(key);
    // The shared cache may evict this entry while the cover stays mounted.
    // Keep an instance-owned result so unrelated updates cannot erase it.
    if (cached) { setDesign(cached); return; }
    let active = true;
    const controller = new AbortController();
    let cancelDesign: (() => void) | undefined;
    async function prepare() {
      let fontError = '';
      try {
        const loaded = await Promise.all([
          document.fonts.load('400 40px "Foliune Cover CJK"', title),
          document.fonts.load('400 40px "Foliune Cover Latin"', title),
          document.fonts.load('italic 400 40px "Foliune Cover Latin"', title),
        ]);
        if (loaded.some((fonts) => !fonts.length)) throw new Error('字体未加载');
      } catch { fontError = '封面字体不可用'; }
      if (!active) return;
      let sample: CoverSample | undefined;
      let sampleError = '';
      if (available && source && !fontError) {
        try { sample = await loadCoverSample(source, controller.signal); }
        catch { sampleError = '封面分析不可用'; }
      }
      if (!active) return;
      cancelDesign = scheduleDesign(() => {
        if (!active) return;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) { setDesign({ key, placement: safePlacement, error: '封面排版不可用' }); return; }
        const measure = (text: string, size: number, italic: boolean) => {
          context.font = `${italic ? 'italic' : 'normal'} 400 ${size}px ${coverFontFamily}`;
          context.fontKerning = 'normal';
          return context.measureText(text).width;
        };
        try {
          const selected = sample ? designCoverTitle(sample, title, width, measure, photo?.regions) : { layout: fitCoverTitle(title, width, measure, .42), placement: safePlacement };
          const next = { key, layout: selected.layout, placement: selected.placement, error: fontError || sampleError || undefined };
          if (!next.error) rememberDesign(next);
          setDesign(next);
        } catch { setDesign({ key, layout: fitCoverTitle(title, width, measure, .42), placement: safePlacement, error: '封面分析不可用' }); }
        finally { canvas.width = 0; canvas.height = 0; }
      });
    }
    void prepare();
    return () => { active = false; controller.abort(); cancelDesign?.(); };
  }, [key, nearby]);
  const current = design?.key === key ? design : designs.get(key);
  const placement = current?.placement ?? safePlacement;
  const failed = failedSource === source || !available;
  const titleStyle = {
    left: `${placement.x * 100}%`, top: `${placement.y * 100}%`,
    fontSize: current?.layout?.size ?? Math.min(36, Math.max(12, 150 / Math.sqrt(Math.max(1, title.length)))),
    lineHeight: current?.layout ? `${current.layout.lineHeight}px` : 1.12,
    color: failed ? safePlacement.color : placement.color,
    '--cover-title-outline': failed ? safePlacement.outline : placement.outline,
  } as CSSProperties;
  return <button ref={button} type="button" className="book-cover" disabled={busy} aria-label={`打开画册 ${title}`} title={title}>
    <div className="book-cover-photo">
      {photo ? validSize ? <PhotoImage photo={photo} lazy onUnavailable={() => setFailedSource(source ?? null)} /> : <span className="book-cover-unavailable" role="alert">封面照片尺寸不可用</span> : hasPhotos ? <span className="book-cover-unavailable" role="status">封面照片不可用</span> : null}
    </div>
    <span className={`book-cover-title${placement.reinforced || failed ? ' book-cover-title-reinforced' : ''}`} style={titleStyle} aria-hidden="true">
      {current?.layout ? current.layout.lines.map((line, index) => <span className="book-cover-title-line" key={index}>{line.map((run, runIndex) => <span key={runIndex} style={run.italic ? { fontStyle: 'italic' } : undefined}>{run.text}</span>)}</span>) : title}
    </span>
    {current?.error ? <span className="book-cover-analysis-status" role="status">{current.error}</span> : available && !current && <span className="book-cover-analysis-status" role="status">封面排版中…</span>}
  </button>;
}

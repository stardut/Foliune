import { useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ModelProfile } from '../../lib/model-types';
import type { Photo } from '../../lib/types';
import { PhotoImage } from '../../components/PhotoImage';
import { overviewSampleHeight, overviewSampleLayout, overviewSamples } from './model-workspace-state';

export function ModelOverviewRow({ model, photos, onOpen, onDelete, disabled = false }: {
  model: ModelProfile; photos: ReadonlyMap<string, Photo>; onOpen: () => void; disabled?: boolean;
  onDelete: () => void;
}) {
  const samples = overviewSamples(model, photos);
  const groups = [samples.filter((photo) => photo.width < photo.height), samples.filter((photo) => photo.width >= photo.height)].filter((group) => group.length);
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = width === undefined ? undefined : overviewSampleLayout(samples, width);
  const basics = [model.gender, model.city].filter(Boolean).join(' · ');
  let photoIndex = 0;
  return <article className="model-overview-row"
    onClick={(event) => { if (!disabled && event.target === event.currentTarget) onOpen(); }}>
    <button type="button" className="model-overview-open" disabled={disabled} onClick={onOpen} aria-label={`查看${model.name}的档案`}>
    <div className="model-overview-info">
      <h2 title={model.name}>{model.name}</h2>
      {basics && <p title={basics}>{basics}</p>}
      {model.tags.length > 0 && <div className="model-overview-tags">{model.tags.slice(0, 3).map((tag) => <span key={tag} title={tag}>{tag}</span>)}</div>}
    </div>
    <div className="model-overview-samples" ref={viewport}>
      {samples.length ? <div className="model-overview-groups" style={fit ? { gap: fit.groupGap } : undefined}>
        {groups.map((group) => <div className="model-overview-group" key={group[0].width < group[0].height ? 'portrait' : 'landscape'} style={fit ? { gap: fit.gap } : undefined}>
          {group.map((photo) => {
            const index = photoIndex++;
            return <div className="model-overview-sample" key={photo.id} style={fit ? { width: fit.widths[index], height: fit.height } : { height: overviewSampleHeight, aspectRatio: `${photo.width}/${photo.height}` }}><PhotoImage photo={photo} lazy /></div>;
          })}
        </div>)}
      </div> : <span className="model-overview-no-samples">{model.photoIds.length ? '样片记录缺失' : '暂无样片'}</span>}
    </div>
    </button>
    <button type="button" className="icon-button model-overview-delete" aria-label={`删除${model.name}的档案`} title="删除档案" disabled={disabled} onClick={onDelete}><Trash2 size={16} /></button>
  </article>;
}

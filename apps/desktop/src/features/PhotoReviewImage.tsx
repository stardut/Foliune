import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { ImageOff, LoaderCircle, LocateFixed } from 'lucide-react';
import type { Photo } from '../lib/types';
import { isLocalPhoto, photoUnavailableLabel } from '../lib/photo-availability';
import { ReviewPresentation, type ReviewFrame, type ReviewPresentationState } from './review-presentation';
import { ReviewZoom } from './review-zoom';

export function useReviewPresentation(photos: Photo[], requestedId: string, direction: number, reduced: boolean, photoIndices?: ReadonlyMap<string, number>) {
  const controller = useRef<ReviewPresentation | null>(null);
  const initialPhoto = () => photoIndices ? photos[photoIndices.get(requestedId) ?? -1] : photos.find((photo) => photo.id === requestedId);
  const [state, setState] = useState<ReviewPresentationState>(() => {
    controller.current = new ReviewPresentation(initialPhoto(), setNext);
    return controller.current.state;
  });
  // The callback is invoked only after mount, never during initialization.
  function setNext(next: ReviewPresentationState) { setState(next); }
  useLayoutEffect(() => {
    // StrictMode remounts effects: create a fresh, bounded controller after cleanup.
    if (!controller.current) controller.current = new ReviewPresentation(initialPhoto(), setNext);
    controller.current.update(photos, requestedId, direction, reduced, photoIndices);
  }, [photos, requestedId, direction, reduced, photoIndices]);
  useLayoutEffect(() => () => { controller.current?.dispose(); controller.current = null; }, []);
  return { state, controller: controller.current! };
}

export function PhotoReviewImage({ state, controller, busy, onRelink, allowZoom = true, onEntryZoom, fullscreen }: {
  state: ReviewPresentationState; controller: ReviewPresentation; busy: boolean; onRelink: (photo: Photo) => Promise<void>; allowZoom?: boolean; onEntryZoom?: () => void; fullscreen?: boolean;
}) {
  const layers: [ReviewFrame | null, string][] = [[state.current, state.incoming ? 'cover' : state.entering ? 'enter' : 'current'], [state.incoming, 'incoming'], [state.outgoing, 'outgoing']];
  const reduced = !!useReducedMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const zoom = useRef<ReviewZoom | null>(null);
  if (allowZoom && !zoom.current) zoom.current = new ReviewZoom();
  const owner = allowZoom ? zoom.current : null;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element && owner) { owner.attach(element, onEntryZoom); return () => owner.detach(); }
  }, [owner, onEntryZoom]);
  useLayoutEffect(() => owner?.update(layers.map(([frame]) => frame).filter((frame): frame is ReviewFrame => !!frame), state.current, reduced), [owner, state, reduced]);
  useLayoutEffect(() => { if (fullscreen) owner?.reset(); }, [owner, fullscreen]);
  return <div className="photo-review-images" ref={viewport}>
    {layers.map(([frame, role]) => frame && <div key={frame.key} className={`photo-review-frame photo-review-frame-${role}`} style={{ '--review-offset': `${state.direction * 12}px` } as CSSProperties} aria-hidden={role === 'incoming' || role === 'outgoing' ? true : undefined} inert={role === 'incoming' || role === 'outgoing'}>
      {frame.kind === 'error' ? !fullscreen && <ReviewMissing photo={frame.photo} busy={busy} onRelink={async (photo) => { await onRelink(photo); controller.retry(photo); }} />
        : <div className="photo-review-zoom" ref={owner ? (element) => owner.register(frame, element) : undefined}><img src={frame.src} width={frame.photo.width} height={frame.photo.height} alt={frame.photo.title || frame.photo.originalName} draggable={false}
          onLoad={(event) => { owner?.imageLoaded(frame.key); void controller.domReady(frame.key, event.currentTarget); }} onError={() => controller.domFailed(frame.key)} /></div>}
    </div>)}
    {!fullscreen && state.waiting && <div className="photo-review-loading" role="status"><LoaderCircle size={16} aria-hidden="true" /><span>正在读取照片</span></div>}
  </div>;
}

function ReviewMissing({ photo, busy, onRelink }: { photo: Photo; busy: boolean; onRelink: (photo: Photo) => Promise<void> }) {
  const [error, setError] = useState('');
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function repair() {
    setError('');
    try { await onRelink(photo); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  if (photo.availability) return <div className="missing-photo work-photo-review-placeholder" role="status" style={{ '--source-ratio': photo.width / photo.height } as CSSProperties}>
    <ImageOff size={25} strokeWidth={1} aria-hidden="true" /><span>{photoUnavailableLabel(photo)}</span>
  </div>;
  return <div className="missing-photo" role="status"><ImageOff size={25} strokeWidth={1} /><span>{photoUnavailableLabel(photo)}</span>
    {!isLocalPhoto(photo) && <>
      <p>{photo.originalAvailable ? '请重新定位可读取的原始照片' : '文件已移动或不在原位置'}</p>
      <button type="button" className="button" onClick={() => void repair()} disabled={busy}><LocateFixed size={13} />{busy ? '处理中…' : '重新定位'}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </div>;
}

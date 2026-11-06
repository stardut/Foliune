import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageOff, LocateFixed } from 'lucide-react';
import type { Photo } from '../lib/types';
import { canReadOriginal, isLocalPhoto, originalReadUrl, photoUnavailableLabel } from '../lib/photo-availability';

export function PhotoImage({ photo, original = false, onSelect, onDoubleClick, selected = false, onRelink, busy = false, onUnavailable, onReadyChange, lazy = false, softReveal = false }: {
  photo: Photo; original?: boolean; onSelect?: () => void; onDoubleClick?: () => void; selected?: boolean;
  onRelink?: (photo: Photo) => Promise<void>; busy?: boolean;
  onUnavailable?: () => void;
  onReadyChange?: (ready: boolean) => void;
  lazy?: boolean; softReveal?: boolean;
}) {
  const [readSession] = useState(() => original ? crypto.randomUUID() : '');
  const src = original ? originalReadUrl(photo, readSession) : photo.thumbnailUrl || photo.originalUrl;
  const unavailable = original
    ? !canReadOriginal(photo)
    : !photo.thumbnailAvailable || (!photo.originalAvailable && !isLocalPhoto(photo));
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);
  const imageRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const image = imageRef.current;
    setFailed(!!image?.complete && image.naturalWidth === 0);
    setPending(!image?.complete);
  }, [src, photo.originalAvailable, photo.thumbnailAvailable]);
  const missing = unavailable || failed;
  useEffect(() => { onReadyChange?.(!missing && !pending); }, [missing, pending, onReadyChange]);
  return <div className={`image-asset ${missing ? 'image-unavailable' : ''} ${softReveal ? 'image-soft-reveal' : ''}`} data-image-pending={pending || undefined}>
    {!missing && <img ref={imageRef} src={src} width={photo.width} height={photo.height} decoding="async" loading={lazy ? 'lazy' : 'eager'} alt={photo.title || photo.originalName} onError={() => { setFailed(true); setPending(false); onUnavailable?.(); }} onLoad={() => setPending(false)} />}
    {!missing && pending && <span className="image-loading" role="status">读取图片…</span>}
    {!missing && onSelect && <button className="image-select-target" type="button" onClick={onSelect} onDoubleClick={onDoubleClick} aria-label={`${selected ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} aria-pressed={selected} />}
    {missing && <PhotoUnavailable key={JSON.stringify([src, photo.originalAvailable, photo.thumbnailAvailable])} photo={photo} onRelink={onRelink} busy={busy} />}
  </div>;
}

export function PhotoUnavailable({ photo, onRelink, busy = false }: {
  photo: Photo; onRelink?: (photo: Photo) => Promise<void>; busy?: boolean;
}) {
  const [relinkError, setRelinkError] = useState('');
  async function relink() {
    setRelinkError('');
    try { await onRelink?.(photo); }
    catch (cause) { setRelinkError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <div className={`missing-photo${photo.availability ? ' work-photo-unavailable' : ''}`}>
    <ImageOff size={25} strokeWidth={1} aria-hidden="true" /><span>{photoUnavailableLabel(photo)}</span>
    {!photo.availability && !isLocalPhoto(photo) && <><p>{!photo.originalAvailable ? '文件已移动或不在原位置' : '请重新定位可读取的原始照片'}</p>{onRelink && <button type="button" className="button" onClick={() => void relink()} disabled={busy}><LocateFixed size={13} />{busy ? '处理中…' : '重新定位'}</button>}{relinkError && <p className="form-error" role="alert">{relinkError}</p>}</>}
  </div>;
}

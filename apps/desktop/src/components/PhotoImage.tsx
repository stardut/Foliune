import { useEffect, useRef, useState } from 'react';
import { ImageOff, LocateFixed } from 'lucide-react';
import type { Photo } from '../lib/types';

export function PhotoImage({ photo, original = false, onSelect, onDoubleClick, selected = false, onRelink, busy = false, onUnavailable, lazy = false }: {
  photo: Photo; original?: boolean; onSelect?: () => void; onDoubleClick?: () => void; selected?: boolean;
  onRelink?: (photo: Photo) => Promise<void>; busy?: boolean;
  onUnavailable?: () => void;
  lazy?: boolean;
}) {
  const src = original ? photo.originalUrl : photo.thumbnailUrl || photo.originalUrl;
  const unavailable = !photo.originalAvailable || (!original && !photo.thumbnailAvailable);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);
  const [relinkError, setRelinkError] = useState('');
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    setFailed(!!image?.complete && image.naturalWidth === 0);
    setPending(!image?.complete);
    setRelinkError('');
  }, [src, photo.originalAvailable, photo.thumbnailAvailable]);
  async function relink() {
    setRelinkError('');
    try { await onRelink?.(photo); }
    catch (cause) { setRelinkError(cause instanceof Error ? cause.message : String(cause)); }
  }
  const missing = unavailable || failed;
  return <div className={`image-asset ${missing ? 'image-unavailable' : ''}`}>
    {!missing && <img ref={imageRef} src={src} width={photo.width} height={photo.height} loading={lazy ? 'lazy' : 'eager'} alt={photo.title || photo.originalName} onError={() => { setFailed(true); setPending(false); onUnavailable?.(); }} onLoad={() => setPending(false)} />}
    {!missing && pending && <span className="image-loading" role="status">读取图片…</span>}
    {!missing && onSelect && <button className="image-select-target" type="button" onClick={onSelect} onDoubleClick={onDoubleClick} aria-label={`${selected ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} aria-pressed={selected} />}
    {missing && <div className="missing-photo"><ImageOff size={25} strokeWidth={1} /><span>{!photo.originalAvailable ? '原图文件缺失' : '图片无法读取'}</span><p>{!photo.originalAvailable ? '文件已移动或不在原位置' : '请重新定位可读取的原始照片'}</p>{onRelink && <button type="button" className="button" onClick={() => void relink()} disabled={busy}><LocateFixed size={13} />{busy ? '处理中…' : '重新定位'}</button>}{relinkError && <p className="form-error" role="alert">{relinkError}</p>}</div>}
  </div>;
}

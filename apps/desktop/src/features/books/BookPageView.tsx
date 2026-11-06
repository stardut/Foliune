import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { BookPage } from '../../lib/book-types';
import type { Photo } from '../../lib/types';
import { canReadOriginal, isLocalPhoto, originalReadUrl, photoUnavailableLabel } from '../../lib/photo-availability';

export function BookPageView({ page, pageWidth, pageHeight, photos, number, selectedItem, onSelectItem, onRelink }: {
  page: BookPage; pageWidth: number; pageHeight: number; photos: Photo[]; number: number;
  selectedItem?: number; onSelectItem?: (index: number) => void;
  onRelink?: (photo: Photo) => Promise<void>;
}) {
  const [repairing, setRepairing] = useState(false); const [error, setError] = useState('');
  async function repair(photo: Photo) { if (!onRelink) return; setRepairing(true); setError(''); try { await onRelink(photo); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setRepairing(false); } }
  return <div className="book-page" style={{ aspectRatio: `${pageWidth}/${pageHeight}` }} aria-label={`第 ${number} 页`}>
    {page.items.map((item, index) => {
      const photo = photos.find((p) => p.id === item.photoId);
      const style = { left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` };
      return <div key={`${index}-${item.photoId}`} className={`book-photo ${onSelectItem && selectedItem === index ? 'book-photo-selected' : ''}`} style={style}>
        <PagePhoto key={`${photo?.originalUrl}:${photo?.originalAvailable}:${photo?.availability}`} item={item} photo={photo}
          onRepair={onRelink ? repair : undefined} repairing={repairing} error={error} />
        {onSelectItem && <button type="button" className="book-photo-target" onClick={() => onSelectItem(index)} aria-label={`编辑照片 ${photo?.title || index + 1}`} />}
      </div>;
    })}
    <h2>{page.title}</h2><p className="book-caption">{page.caption}</p><span className="book-page-number">{number}</span>
  </div>;
}

function PagePhoto({ item, photo, onRepair, repairing, error }: {
  item: BookPage['items'][number]; photo?: Photo; onRepair?: (photo: Photo) => Promise<void>; repairing: boolean; error: string;
}) {
  const [failed, setFailed] = useState(false);
  const [readSession] = useState(() => crypto.randomUUID());
  if (photo && canReadOriginal(photo) && !failed) return <img src={originalReadUrl(photo, readSession)} alt={photo.title || photo.originalName}
    onError={() => setFailed(true)} style={{ objectFit: item.fit, objectPosition: `${item.cropX}% ${item.cropY}%` }} />;
  return <div className="book-missing">
    {photo?.availability && <ImageOff size={17} strokeWidth={1.2} aria-hidden="true" />}
    <span>{photoUnavailableLabel(photo)}</span>
    <span>{photo?.title || photo?.originalName || '照片不可用'}</span>
    {!photo?.availability && !isLocalPhoto(photo) && <>
      {photo && onRepair ? <button type="button" className="button" disabled={repairing} onClick={() => void onRepair(photo)}>{repairing ? '处理中…' : '重新定位'}</button> : <span>请在图库中重新定位</span>}
      {error && <span role="alert">{error}</span>}
    </>}
  </div>;
}

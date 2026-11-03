import type { BookPage } from '../../lib/book-types';
import type { Photo } from '../../lib/types';

export function BookPageView({ page, pageWidth, pageHeight, photos, number, selectedItem, onSelectItem, onRelink }: {
  page: BookPage; pageWidth: number; pageHeight: number; photos: Photo[]; number: number;
  selectedItem?: number; onSelectItem?: (index: number) => void;
  onRelink?: (photo: Photo) => Promise<void>;
}) {
  const [failed, setFailed] = useState<string[]>([]); const [repairing, setRepairing] = useState(false); const [error, setError] = useState('');
  async function repair(photo: Photo) { if (!onRelink) return; setRepairing(true); setError(''); try { await onRelink(photo); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setRepairing(false); } }
  return <div className="book-page" style={{ aspectRatio: `${pageWidth}/${pageHeight}` }} aria-label={`第 ${number} 页`}>
    {page.items.map((item, index) => {
      const photo = photos.find((p) => p.id === item.photoId);
      const key = `${photo?.id}:${photo?.originalUrl}`;
      const style = { left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` };
      return <div key={`${index}-${item.photoId}`} className={`book-photo ${onSelectItem && selectedItem === index ? 'book-photo-selected' : ''}`} style={style}>
        {photo?.originalAvailable && !failed.includes(key) ? <img src={photo.originalUrl} alt={photo.title} onError={() => setFailed((previous) => [...previous, key])} style={{ objectFit: item.fit, objectPosition: `${item.cropX}% ${item.cropY}%` }} /> : <div className="book-missing"><span>{photo?.originalAvailable ? '图片无法读取' : '原图缺失'}</span><span>{photo?.title || '照片不可用'}</span>{photo && onRelink ? <button type="button" className="button" disabled={repairing} onClick={() => void repair(photo)}>{repairing ? '处理中…' : '重新定位'}</button> : <span>请在图库中重新定位</span>}{error && <span role="alert">{error}</span>}</div>}
        {onSelectItem && <button type="button" className="book-photo-target" onClick={() => onSelectItem(index)} aria-label={`编辑照片 ${photo?.title || index + 1}`} />}
      </div>;
    })}
    <h2>{page.title}</h2><p className="book-caption">{page.caption}</p><span className="book-page-number">{number}</span>
  </div>;
}
import { useState } from 'react';

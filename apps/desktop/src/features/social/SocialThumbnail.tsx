import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { Photo } from '../../lib/types';

export function SocialThumbnail({ photo }: { photo: Photo | undefined }) {
  const src = photo?.thumbnailAvailable ? photo.thumbnailUrl : photo?.originalAvailable ? photo.originalUrl : '';
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return src && !failed
    ? <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} />
    : <span className="social-thumbnail-missing" role="img" aria-label={photo ? '照片文件缺失或无法读取' : '照片引用缺失'}><ImageOff size={18} strokeWidth={1} /><span>缺图</span></span>;
}

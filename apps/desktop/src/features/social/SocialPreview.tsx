import { t } from '../../lib/i18n';
import { useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, Heart, Image, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { PhotoImage } from '../../components/PhotoImage';
import type { Photo } from '../../lib/types';
import type { SocialSimulationInput, SocialPlatform } from '../../lib/social-types';
import avatarUrl from '../../../src-tauri/icons/128x128.png';
import { useSocialPreviewFit } from './useSocialPreviewFit';

export const platformOptions: { id: SocialPlatform; label: string; limit: number }[] = [
  { id: 'moments', label: t('朋友圈', 'WeChat Moments'), limit: 9 },
  { id: 'xiaohongshu', label: t('小红书', 'Xiaohongshu'), limit: 18 },
  { id: 'instagram', label: 'Instagram', limit: 20 },
];

export function SocialPreview({ input, photos, onRelink }: { input: SocialSimulationInput; photos: Photo[]; onRelink?: (photo: Photo) => Promise<void> }) {
  const [page, setPage] = useState(0);
  const { viewportRef, paperRef, fit } = useSocialPreviewFit(input.platform);
  const platform = platformOptions.find((option) => option.id === input.platform)!;
  const previewIds = input.photoIds.slice(0, platform.limit);
  const selected = previewIds.map((id) => photos.find((photo) => photo.id === id));
  const current = Math.min(page, Math.max(0, selected.length - 1));
  const displayName = t('Foliune 摄影', 'Foliune Photography');
  const avatar = <img className="social-avatar" src={avatarUrl} alt={t('Foliune 摄影头像', 'Foliune Photography avatar')} />;
  const image = (photo: Photo | undefined, key: string, original = false) => photo
    ? <PhotoImage key={key} photo={photo} original={original} onRelink={onRelink} lazy={!original} />
    : <div key={key} className="social-image-missing"><Image size={20} /><span>{t('照片引用缺失', 'Photo reference missing')}</span></div>;
  const empty = <div className="social-preview-empty"><Image size={28} strokeWidth={1} /><span>{t('添加照片后预览', 'Add photos to preview')}</span></div>;
  const caption = <div className="social-preview-caption">{input.platform === 'xiaohongshu' && input.title && <h3>{input.title}</h3>}{input.body && <p>{input.body}</p>}</div>;
  function turnWithKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    setPage(Math.max(0, Math.min(selected.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1))));
  }
  const carousel = <div className="social-carousel" role="group" aria-label={t('照片翻页预览', 'Photo Carousel Preview')} tabIndex={selected.length > 1 ? 0 : undefined} onKeyDown={turnWithKeyboard}>
      {selected.length ? image(selected[current], previewIds[current], true) : empty}
      {selected.length > 1 && <span className="social-page-number">{current + 1} / {selected.length}</span>}
      {selected.length > 1 && <div className="social-carousel-controls">
        <button type="button" aria-label={t('预览上一张', 'Preview Previous Photo')} disabled={current === 0} onKeyDown={turnWithKeyboard} onClick={(event) => { event.stopPropagation(); setPage(current - 1); }}><ArrowLeft size={17} /></button>
        <span className="social-sort-sr" aria-live="polite" aria-atomic="true">{current + 1} / {selected.length}</span>
        <button type="button" aria-label={t('预览下一张', 'Preview Next Photo')} disabled={current === selected.length - 1} onKeyDown={turnWithKeyboard} onClick={(event) => { event.stopPropagation(); setPage(current + 1); }}><ArrowRight size={17} /></button>
      </div>}
    </div>;
  return <section className="social-preview-region" aria-label={t(`${platform.label}布局模拟`, `${platform.label} layout preview`)}>
    <div className="social-preview-heading"><h2>{t('预览', 'Preview')}</h2><span>{t('布局模拟', 'Layout Simulation')}</span></div>
    <div ref={viewportRef} className="social-preview-viewport">
    <div className="social-preview-stage" style={{ width: fit.width * fit.scale, height: fit.height ? fit.height * fit.scale : undefined }}>
    <div ref={paperRef} className={`social-platform social-platform-${input.platform}`} style={{ width: fit.width, transform: `scale(${fit.scale})` }}>
      {input.platform === 'moments' ? <div className="social-moments-post">{avatar}<div className="social-moments-content"><h3 className="social-identity">{displayName}</h3>{caption}{selected.length ? <div className={`social-moments-images social-moments-count-${selected.length === 1 ? 'one' : selected.length === 2 || selected.length === 4 ? 'two' : 'three'}`}>{selected.map((photo, index) => image(photo, previewIds[index]))}</div> : empty}<div className="social-moments-footer"><span>{t('刚刚', 'Just now')}</span><MoreHorizontal size={19} /></div></div></div>
        : <><header className="social-post-header">{avatar}<span className="social-identity">{displayName}</span><MoreHorizontal size={19} /></header>{carousel}{input.platform === 'instagram' && <div className="social-post-icons" aria-hidden="true"><Heart /><MessageCircle /><Send /><Bookmark /></div>}{caption}{input.platform === 'xiaohongshu' && <div className="social-xhs-footer" aria-hidden="true"><Heart size={19} /><Bookmark size={19} /><MessageCircle size={19} /></div>}</>}
    </div>
    </div>
    </div>
  </section>;
}

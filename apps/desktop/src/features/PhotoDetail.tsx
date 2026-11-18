import { t } from '../lib/i18n';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Photo, PhotoPatch } from '../lib/types';
import { displayOriginalPath } from '../lib/photo-availability';
import { formatDateParts, localDateParts } from '../lib/date-picker';
import { DatePickerField } from '../components/DatePickerField';
import { Modal } from '../components/ui';
import { PhotoImage } from '../components/PhotoImage';
import { PhotoReviewInfo } from './PhotoReviewInfo';
import { PhotoRegionField } from './works-map/PhotoRegionField';
import { parseWorksMapCoordinate } from './works-map/works-map-layout';

export function PhotoDetail({ photo, onClose, onSave, busy, onRelink, extension, onDirtyChange }: {
  photo: Photo; onClose: () => void; busy: boolean;
  onRelink: (photo: Photo) => Promise<void>;
  onSave: (patch: PhotoPatch, expected: PhotoPatch) => Promise<void>; extension?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [initial] = useState(() => photo);
  const [title, setTitle] = useState(photo.title);
  const [tags, setTags] = useState(photo.tags.join('，'));
  const [annotation, setAnnotation] = useState(photo.annotation);
  const [source, setSource] = useState(photo.source);
  const [location, setLocation] = useState(photo.location);
  const [locationRegionId, setLocationRegionId] = useState(photo.locationRegionId ?? '');
  const [project, setProject] = useState(photo.project);
  const [initialCapturedAt] = useState(() => localDateTime(photo.capturedAt));
  const [capturedAt, setCapturedAt] = useState(initialCapturedAt);
  const capturedAtDirty = capturedAt !== initialCapturedAt;
  const [error, setError] = useState('');
  const infoTitleId = useId();
  const originalPath = displayOriginalPath(photo);
  const hasCoordinates = !!parseWorksMapCoordinate(location);
  const initialRegionId = initial.locationRegionId ?? '';
  const dirty = title !== initial.title || tags !== initial.tags.join('，') || annotation !== initial.annotation || source !== initial.source || location !== initial.location
    || locationRegionId !== initialRegionId || project !== initial.project || capturedAtDirty;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      const patch: PhotoPatch = {};
      const expected: PhotoPatch = {};
      const editedTitle = title.trim() || initial.originalName;
      if (title !== initial.title && editedTitle !== initial.title) {
        patch.title = editedTitle;
        expected.title = initial.title;
      }
      if (tags !== initial.tags.join('，')) {
        const editedTags = [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
        if (editedTags.length !== initial.tags.length || editedTags.some((tag, index) => tag !== initial.tags[index])) {
          patch.tags = editedTags;
          expected.tags = initial.tags;
        }
      }
      for (const [key, value] of Object.entries({ annotation, source, location, project }) as [
        'annotation' | 'source' | 'location' | 'project', string,
      ][]) {
        if (value !== initial[key] && value.trim() !== initial[key]) {
          patch[key] = value;
          expected[key] = initial[key];
        }
      }
      if (capturedAtDirty) {
        patch.capturedAt = capturedAt ? new Date(capturedAt).toISOString() : null;
        expected.capturedAt = initial.capturedAt;
      }
      if (locationRegionId !== initialRegionId) {
        patch.locationRegionId = locationRegionId;
        expected.locationRegionId = initialRegionId;
      }
      await onSave(patch, expected);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title={t('照片详情', 'Photo Details')} onClose={onClose} wide>
    <div className="detail-layout">
      <div className="detail-preview">
        <PhotoImage photo={photo} original onRelink={onRelink} busy={busy} />
        <PhotoReviewInfo key={JSON.stringify([photo.originalPath, photo.originalAvailable])} photo={photo} titleId={infoTitleId} />
      </div>
      <form onSubmit={save} className="detail-form">
        <label>{t('标题', 'Title')}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{t('标签', 'Tags')}<input value={tags} placeholder={t('用逗号分隔', 'Separate with commas')} onChange={(event) => setTags(event.target.value)} /></label>
        <div className="form-columns"><label>{t('地点', 'Location')}<input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label>{t('项目', 'Project')}<input value={project} onChange={(event) => setProject(event.target.value)} /></label></div>
        {(!hasCoordinates || locationRegionId) && <PhotoRegionField value={locationRegionId} readOnly={hasCoordinates} disabled={busy} onChange={setLocationRegionId} />}
        <DatePickerField label={t('拍摄时间', 'Date Taken')} withTime value={capturedAt} disabled={busy} onChange={setCapturedAt} />
        <label>{t('来源', 'Source')}<input value={source} placeholder={t('摄影师、网址或来源说明', 'Photographer, URL, or source notes')} onChange={(event) => setSource(event.target.value)} /></label>
        <label>{t('标注', 'Notes')}<textarea value={annotation} rows={4} placeholder={t('留下你的观察', 'Record your observations')} onChange={(event) => setAnnotation(event.target.value)} /></label>
        {extension}
        {originalPath && <p className="file-path" title={originalPath}><ExternalLink size={12} />{originalPath}</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button" onClick={onClose}>{t('取消', 'Cancel')}</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button></div>
      </form>
    </div>
  </Modal>;
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateParts(localDateParts(date), true);
}

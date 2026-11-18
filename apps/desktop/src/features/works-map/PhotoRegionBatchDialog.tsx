import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/ui';
import { photoCount, t } from '../../lib/i18n';
import type { PhotoRegionBaseline } from '../../lib/types';
import { PhotoRegionField } from './PhotoRegionField';
import { parseWorksMapCoordinate } from './works-map-layout';

export interface PhotoRegionBatch {
  groupId: string;
  albumName?: string;
  photos: PhotoRegionBaseline[];
}

export function PhotoRegionBatchDialog({ batch, busy, onClose, onSave, onDirtyChange }: {
  batch: PhotoRegionBatch;
  busy: boolean;
  onClose: () => void;
  onSave: (regionId: string, photos: readonly PhotoRegionBaseline[]) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [regionId, setRegionId] = useState('');
  const [skipGps, setSkipGps] = useState(false);
  const [error, setError] = useState('');
  const eligiblePhotos = skipGps ? batch.photos.filter((photo) => !parseWorksMapCoordinate(photo.location)) : batch.photos;
  const skippedCount = batch.photos.length - eligiblePhotos.length;
  const changedPhotos = regionId ? eligiblePhotos.filter((photo) => photo.locationRegionId !== regionId) : [];
  const count = changedPhotos.length;
  const dirty = count > 0;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setError('');
    try { await onSave(regionId, changedPhotos); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <Modal title={t('设置拍摄地区', 'Set Shooting Region')} onClose={onClose} closeDisabled={busy}>
    <form onSubmit={submit} className="stack-form">
      {batch.albumName && <div>{batch.albumName}</div>}
      <PhotoRegionField value={regionId} disabled={busy} onChange={setRegionId} />
      <div className="photo-region-batch-options">
        <label>
          <input type="checkbox" checked={skipGps} disabled={busy} onChange={(event) => setSkipGps(event.currentTarget.checked)} />
          {t('跳过有 GPS 坐标的照片', 'Skip Photos with GPS Coordinates')}
        </label>
        <div className="muted" aria-live="polite">
          {t(`将更新 ${count} 张照片。`, `${photoCount(count)} will be updated.`)}
          {skippedCount > 0 && t(` 跳过 ${skippedCount} 张有 GPS 坐标的照片。`, ` Skipping ${photoCount(skippedCount)} with GPS coordinates.`)}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
        <button type="submit" className="button button-primary" disabled={!dirty || busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
      </div>
    </form>
  </Modal>;
}

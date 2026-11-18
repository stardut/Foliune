import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/ui';
import { photoCount, t } from '../../lib/i18n';
import type { PhotoRegionBaseline } from '../../lib/types';
import { PhotoRegionField } from './PhotoRegionField';

export interface PhotoRegionBatch {
  groupId: string;
  albumName?: string;
  photos: PhotoRegionBaseline[];
  gpsCount: number;
}

export function PhotoRegionBatchDialog({ batch, busy, onClose, onSave, onDirtyChange }: {
  batch: PhotoRegionBatch;
  busy: boolean;
  onClose: () => void;
  onSave: (regionId: string, changedCount: number) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [regionId, setRegionId] = useState('');
  const [error, setError] = useState('');
  const count = regionId ? batch.photos.filter((photo) => photo.locationRegionId !== regionId).length : batch.photos.length;
  const dirty = !!regionId && count > 0;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setError('');
    try { await onSave(regionId, count); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <Modal title={t('设置拍摄地区', 'Set Shooting Region')} onClose={onClose} closeDisabled={busy}>
    <form onSubmit={submit} className="stack-form">
      <div aria-live="polite">
        {batch.albumName && <div>{batch.albumName}</div>}
        <div className="muted">
          {t(`将更新 ${count} 张照片。`, `${photoCount(count)} will be updated.`)}
          {batch.gpsCount > 0 && t(` 跳过 ${batch.gpsCount} 张有 GPS 坐标的照片。`, ` Skipping ${photoCount(batch.gpsCount)} with GPS coordinates.`)}
        </div>
      </div>
      {batch.photos.length > 0 && <PhotoRegionField value={regionId} readOnly={false} disabled={busy} onChange={setRegionId} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button>
        <button type="submit" className="button button-primary" disabled={!dirty || busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button>
      </div>
    </form>
  </Modal>;
}

import { getLocale, t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { readPhotoMetadata } from '../lib/api';
import { canReadOriginal } from '../lib/photo-availability';
import type { Photo, PhotoMetadata } from '../lib/types';
import './photo-info.css';

type Field = [label: string, value: string | null | undefined];

const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2, useGrouping: false });
const seconds = new Intl.NumberFormat(getLocale(), { maximumSignificantDigits: 4, useGrouping: false });
const exposureModes = { auto: t('自动', 'Auto'), manual: t('手动', 'Manual'), autoBracket: t('自动包围曝光', 'Auto Bracketing') };
const meteringModes = {
  average: t('平均测光', 'Average'), centerWeightedAverage: t('中央重点平均测光', 'Center-weighted Average'),
  spot: t('点测光', 'Spot'), multiSpot: t('多点测光', 'Multi-spot'), pattern: t('多区测光', 'Multi-segment'), partial: t('局部测光', 'Partial'),
};
const whiteBalances = { auto: t('自动', 'Auto'), manual: t('手动', 'Manual') };

function focalLength(value: number) {
  return `${number.format(value)} mm`;
}

function shutterSpeed(value: number) {
  const reciprocal = Math.round(1 / value);
  // Use a fraction for a reciprocal exposure without rounding 0.3 s to 1/3 s.
  if (reciprocal > 1 && Number.isSafeInteger(reciprocal) && Math.abs(value * reciprocal - 1) < 1e-6) return `1/${reciprocal} s`;
  return `${seconds.format(value)} s`;
}

function fileSize(bytes: number) {
  if (bytes >= 1e9) return `${number.format(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${number.format(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${number.format(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

export function PhotoReviewInfo({ photo, titleId }: { photo: Photo; titleId: string }) {
  const [result, setResult] = useState<PhotoMetadata | 'error' | null>(null);
  const originalReadable = canReadOriginal(photo);
  useEffect(() => {
    if (!originalReadable) return;
    let active = true;
    void readPhotoMetadata(photo.id, photo.originalPath).then(
      (metadata) => { if (active) setResult(metadata); },
      () => { if (active) setResult('error'); },
    );
    return () => { active = false; };
  }, [photo.id, photo.originalPath, originalReadable]);
  const metadata = result === 'error' ? null : result;
  const status = !originalReadable ? t('原图缺失，无法读取拍摄参数', 'Original missing. EXIF data unavailable.')
    : result === 'error' ? t('无法读取原图信息', 'Could not read the original photo info')
    : !result ? t('正在读取原图信息…', 'Reading original photo info…')
    : result.exifReadFailed ? t('无法读取拍摄参数', 'Could not read EXIF data') : null;
  const name = photo.title.trim() || photo.originalName.trim();
  const originalName = photo.originalName.trim();
  const capturedAt = photo.capturedAt ? new Date(photo.capturedAt) : null;
  const validDate = capturedAt && Number.isFinite(capturedAt.getTime());
  const focal = metadata?.focalLengthMm;
  const equivalent = metadata?.focalLength35mm;
  const compensation = metadata?.exposureCompensationEv;
  const metrics: Field[] = [
    [focal == null ? t('等效焦距', 'Equivalent Focal Length') : t('焦距', 'Focal Length'), focal != null ? focalLength(focal) : equivalent != null ? focalLength(equivalent) : null],
    [t('光圈', 'Aperture'), metadata?.aperture == null ? null : `f/${number.format(metadata.aperture)}`],
    [t('快门', 'Shutter Speed'), metadata?.exposureSeconds == null ? null : shutterSpeed(metadata.exposureSeconds)],
    ['ISO', metadata?.iso?.toString()],
  ];
  const exposure: Field[] = [
    [t('曝光补偿', 'Exposure Compensation'), compensation == null ? null : `${compensation > 0 ? '+' : ''}${number.format(compensation)} EV`],
    [t('曝光模式', 'Exposure Mode'), metadata?.exposureMode && exposureModes[metadata.exposureMode]],
    [t('测光模式', 'Metering Mode'), metadata?.meteringMode && meteringModes[metadata.meteringMode]],
    [t('白平衡', 'White Balance'), metadata?.whiteBalance && whiteBalances[metadata.whiteBalance]],
    [t('闪光灯', 'Flash'), metadata?.flashFired == null ? null : metadata.flashFired ? t('已闪光', 'Fired') : t('未闪光', 'Did Not Fire')],
  ];

  return <div className="photo-info-content">
    <h3 id={titleId} className="sr-only">{t('照片信息', 'Photo Info')}</h3>
    {metrics.some(([, value]) => value) && <dl className="photo-review-metrics">
      {metrics.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    {status && <p className="photo-review-info-status" role="status">{status}</p>}
    <InfoGroup title={t('时间与地点', 'Time and Location')} fields={[
      [t('拍摄时间', 'Date Taken'), validDate ? capturedAt.toLocaleString(getLocale(), { hour12: false }) : null],
      [t('地点', 'Location'), photo.location],
    ]} />
    <InfoGroup title={t('相机与镜头', 'Camera and Lens')} fields={[
      [t('相机', 'Camera'), metadata?.camera],
      [t('镜头', 'Lens'), metadata?.lens],
      [t('35 mm 等效', '35 mm Equivalent'), focal != null && equivalent != null ? focalLength(equivalent) : null],
    ]} />
    <InfoGroup title={t('文件', 'File')} fields={[
      [t('名称', 'Name'), name],
      [t('原始文件名', 'Original File Name'), originalName !== name ? originalName : null],
      [t('尺寸', 'Dimensions'), photo.width > 0 && photo.height > 0 ? `${photo.width} × ${photo.height} px` : null],
      [t('格式', 'Format'), metadata?.fileFormat],
      [t('大小', 'Size'), metadata ? fileSize(metadata.fileSizeBytes) : null],
      [t('来源', 'Source'), photo.source],
    ]} />
    {exposure.some(([, value]) => value) && <details className="photo-review-extra">
      <summary><ChevronRight size={13} aria-hidden="true" />{t('更多拍摄参数', 'More Camera Settings')}</summary>
      <InfoRows fields={exposure} />
    </details>}
  </div>;
}

function InfoGroup({ title, fields }: { title: string; fields: Field[] }) {
  if (!fields.some(([, value]) => value?.trim())) return null;
  return <section className="photo-review-info-group">
    <h4>{title}</h4>
    <InfoRows fields={fields} />
  </section>;
}

function InfoRows({ fields }: { fields: Field[] }) {
  return <dl className="photo-review-info-rows">
    {fields.map(([label, value]) => value?.trim() && <div key={label}><dt>{label}</dt><dd>{value.trim()}</dd></div>)}
  </dl>;
}

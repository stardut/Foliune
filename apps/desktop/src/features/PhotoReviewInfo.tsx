import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { readPhotoMetadata } from '../lib/api';
import { canReadOriginal } from '../lib/photo-availability';
import type { Photo, PhotoMetadata } from '../lib/types';
import './photo-info.css';

type Field = [label: string, value: string | null | undefined];

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false });
const seconds = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4, useGrouping: false });
const exposureModes = { auto: '自动', manual: '手动', autoBracket: '自动包围曝光' };
const meteringModes = {
  average: '平均测光', centerWeightedAverage: '中央重点平均测光',
  spot: '点测光', multiSpot: '多点测光', pattern: '多区测光', partial: '局部测光',
};
const whiteBalances = { auto: '自动', manual: '手动' };

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
  const status = !originalReadable ? '原图缺失，无法读取拍摄参数'
    : result === 'error' ? '无法读取原图信息'
    : !result ? '正在读取原图信息…'
    : result.exifReadFailed ? '无法读取拍摄参数' : null;
  const name = photo.title.trim() || photo.originalName.trim();
  const originalName = photo.originalName.trim();
  const capturedAt = photo.capturedAt ? new Date(photo.capturedAt) : null;
  const validDate = capturedAt && Number.isFinite(capturedAt.getTime());
  const focal = metadata?.focalLengthMm;
  const equivalent = metadata?.focalLength35mm;
  const compensation = metadata?.exposureCompensationEv;
  const metrics: Field[] = [
    [focal == null ? '等效焦距' : '焦距', focal != null ? focalLength(focal) : equivalent != null ? focalLength(equivalent) : null],
    ['光圈', metadata?.aperture == null ? null : `f/${number.format(metadata.aperture)}`],
    ['快门', metadata?.exposureSeconds == null ? null : shutterSpeed(metadata.exposureSeconds)],
    ['ISO', metadata?.iso?.toString()],
  ];
  const exposure: Field[] = [
    ['曝光补偿', compensation == null ? null : `${compensation > 0 ? '+' : ''}${number.format(compensation)} EV`],
    ['曝光模式', metadata?.exposureMode && exposureModes[metadata.exposureMode]],
    ['测光模式', metadata?.meteringMode && meteringModes[metadata.meteringMode]],
    ['白平衡', metadata?.whiteBalance && whiteBalances[metadata.whiteBalance]],
    ['闪光灯', metadata?.flashFired == null ? null : metadata.flashFired ? '已闪光' : '未闪光'],
  ];

  return <div className="photo-info-content">
    <h3 id={titleId} className="sr-only">照片信息</h3>
    {metrics.some(([, value]) => value) && <dl className="photo-review-metrics">
      {metrics.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    {status && <p className="photo-review-info-status" role="status">{status}</p>}
    <InfoGroup title="时间与地点" fields={[
      ['拍摄时间', validDate ? capturedAt.toLocaleString('zh-CN', { hour12: false }) : null],
      ['地点', photo.location],
    ]} />
    <InfoGroup title="相机与镜头" fields={[
      ['相机', metadata?.camera],
      ['镜头', metadata?.lens],
      ['35 mm 等效', focal != null && equivalent != null ? focalLength(equivalent) : null],
    ]} />
    <InfoGroup title="文件" fields={[
      ['名称', name],
      ['原始文件名', originalName !== name ? originalName : null],
      ['尺寸', photo.width > 0 && photo.height > 0 ? `${photo.width} × ${photo.height} px` : null],
      ['格式', metadata?.fileFormat],
      ['大小', metadata ? fileSize(metadata.fileSizeBytes) : null],
      ['来源', photo.source],
    ]} />
    {exposure.some(([, value]) => value) && <details className="photo-review-extra">
      <summary><ChevronRight size={13} aria-hidden="true" />更多拍摄参数</summary>
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

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Photo, PhotoPatch } from '../lib/types';
import { Modal } from '../components/ui';
import { PhotoImage } from '../components/PhotoImage';
import { RegionEditor } from './RegionEditor';

export function PhotoDetail({ photo, onClose, onSave, busy, onRelink, extension, onDirtyChange }: {
  photo: Photo; onClose: () => void; busy: boolean;
  onRelink: (photo: Photo) => Promise<void>;
  onSave: (patch: PhotoPatch) => Promise<void>; extension?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(photo.title);
  const [tags, setTags] = useState(photo.tags.join('，'));
  const [annotation, setAnnotation] = useState(photo.annotation);
  const [source, setSource] = useState(photo.source);
  const [location, setLocation] = useState(photo.location);
  const [project, setProject] = useState(photo.project);
  const [capturedAt, setCapturedAt] = useState(localDateTime(photo.capturedAt));
  const [capturedAtDirty, setCapturedAtDirty] = useState(false);
  const [regions, setRegions] = useState(photo.regions || []);
  const [regionEditing, setRegionEditing] = useState(false);
  const [error, setError] = useState('');
  const dirty = title !== photo.title || tags !== photo.tags.join('，') || annotation !== photo.annotation || source !== photo.source || location !== photo.location || project !== photo.project || capturedAtDirty || JSON.stringify(regions) !== JSON.stringify(photo.regions || []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    if (regions.some((region) => !region.text.trim())) { setError('请为每个区域填写标注，或删除空标注框。'); setRegionEditing(true); return; }
    try { await onSave({ title: title.trim() || photo.originalName, tags: [...new Set(tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))], annotation, source, location, project, ...(capturedAtDirty ? { capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null } : {}), regions }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title="照片详情" onClose={onClose} wide>
    <div className="detail-layout"><div className="detail-preview">{regionEditing ? <RegionEditor photo={photo} regions={regions} onChange={setRegions} /> : <PhotoImage photo={photo} original onRelink={onRelink} busy={busy} />}<p>{photo.width} × {photo.height} <span>·</span> {photo.originalName}</p><button type="button" className="button region-switch" onClick={() => setRegionEditing(!regionEditing)}>{regionEditing ? '查看照片' : `区域标注 ${regions.length || ''}`}</button></div>
      <form onSubmit={save} className="detail-form">
        <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>标签<input value={tags} placeholder="用逗号分隔" onChange={(event) => setTags(event.target.value)} /></label>
        <div className="form-columns"><label>地点<input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label>项目<input value={project} onChange={(event) => setProject(event.target.value)} /></label></div>
        <label>拍摄时间<input type="datetime-local" step="1" value={capturedAt} onChange={(event) => { setCapturedAt(event.target.value); setCapturedAtDirty(true); }} /></label>
        <label>来源<input value={source} placeholder="摄影师、网址或来源说明" onChange={(event) => setSource(event.target.value)} /></label>
        <label>标注<textarea value={annotation} rows={4} placeholder="留下你的观察" onChange={(event) => setAnnotation(event.target.value)} /></label>
        {extension}
        <p className="file-path" title={photo.originalPath}><ExternalLink size={12} />{photo.originalPath}</p>
        {photo.capturedAt && <p className="muted">拍摄于 {new Date(photo.capturedAt).toLocaleString('zh-CN')}</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="form-actions"><button type="button" className="button" onClick={onClose}>取消</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div>
      </form>
    </div>
  </Modal>;
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

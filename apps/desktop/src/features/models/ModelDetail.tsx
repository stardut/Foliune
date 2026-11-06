import { useMemo, useState } from 'react';
import { ArrowLeft, ImageOff, Pencil, Trash2 } from 'lucide-react';
import type { ModelProfile } from '../../lib/model-types';
import type { Photo } from '../../lib/types';
import { PhotoImage } from '../../components/PhotoImage';
import { EmptyState, IconButton } from '../../components/ui';
import { PhotoReview } from '../PhotoReview';

export function ModelDetail({ model, photos, onBack, onEdit, onDelete, disabled = false, onRelink, backLabel = '返回模特' }: {
  model: ModelProfile; photos: Photo[]; onBack: () => void; onEdit: () => void; onDelete: () => void; disabled?: boolean;
  onRelink?: (photo: Photo) => Promise<void>; backLabel?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const photoMap = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const ordered = model.photoIds.flatMap((id) => { const photo = photoMap.get(id); return photo ? [photo] : []; });
  const fields = [
    ['性别', model.gender], ['常驻城市', model.city], ['生日', model.birthday], ['联系方式', model.contact],
    ['身高', model.heightCm == null ? '' : `${model.heightCm} cm`],
    ['体重', model.weightKg == null ? '' : `${model.weightKg} kg`],
  ].filter(([, value]) => value.trim());
  const hasProfile = fields.length > 0 || model.tags.length > 0 || !!model.notes.trim();
  return <section className="model-workspace model-detail" aria-label={`${model.name}的档案`}>
    <header className="workspace-intro model-editor-header"><div className="model-editor-heading"><IconButton label={backLabel} disabled={disabled} onClick={onBack}><ArrowLeft size={18} /></IconButton><h1>{model.name}</h1></div><div className="workspace-tools"><IconButton label="删除档案" disabled={disabled} onClick={onDelete}><Trash2 size={16} /></IconButton><button type="button" className="button" disabled={disabled} onClick={onEdit}><Pencil size={14} />编辑档案</button></div></header>
    <div className="model-detail-layout">
      {hasProfile && <section className="model-profile-readonly model-profile-card" aria-label="基本资料">
        {fields.length > 0 && <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {(model.tags.length > 0 || !!model.notes.trim()) && <div className="model-profile-context">
          {model.tags.length > 0 && <div className="model-detail-field"><h3>风格</h3><div className="model-readonly-tags">{model.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>}
          {!!model.notes.trim() && <div className="model-detail-field"><h3>备注</h3><p className="model-profile-notes">{model.notes}</p></div>}
        </div>}
      </section>}
      <section className="model-sample-section" aria-label="全部样片">
        {model.photoIds.length > 0 ? <div className="model-samples model-detail-samples">{model.photoIds.map((id, index) => {
          const photo = photoMap.get(id);
          return <article className="model-sample" key={id}><button type="button" className="model-sample-image" disabled={!photo} aria-label={photo ? `查看 ${photo.title || photo.originalName}` : `第 ${index + 1} 张样片记录缺失`} onClick={() => setPreview(id)}>
            {photo ? <PhotoImage photo={photo} lazy /> : <span className="model-missing"><ImageOff size={22} />样片记录缺失</span>}
          </button></article>;
        })}</div> : <EmptyState title="还没有样片" />}
      </section>
    </div>
    {preview && <PhotoReview photos={ordered} initialPhotoId={preview} context={`${model.name}的样片`} returnLabel="返回模特档案" busy={false} onClose={() => setPreview(null)} onRelink={onRelink ?? (async () => { throw new Error('请返回图库重新定位这张照片。'); })} />}
  </section>;
}

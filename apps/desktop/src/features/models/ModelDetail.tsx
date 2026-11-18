import { t } from '../../lib/i18n';
import { useMemo, useState } from 'react';
import { ArrowLeft, ImageOff, Pencil, Trash2 } from 'lucide-react';
import type { ModelProfile } from '../../lib/model-types';
import type { Photo } from '../../lib/types';
import { PhotoImage } from '../../components/PhotoImage';
import { EmptyState, IconButton } from '../../components/ui';
import { PhotoReview } from '../PhotoReview';
import { modelGenderLabel } from './ModelFields';

export function ModelDetail({ model, photos, onBack, onEdit, onDelete, disabled = false, onRelink, backLabel = t('返回模特', 'Back to Models') }: {
  model: ModelProfile; photos: Photo[]; onBack: () => void; onEdit: () => void; onDelete: () => void; disabled?: boolean;
  onRelink?: (photo: Photo) => Promise<void>; backLabel?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const photoMap = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const ordered = model.photoIds.flatMap((id) => { const photo = photoMap.get(id); return photo ? [photo] : []; });
  const fields = [
    [t('性别', 'Gender'), modelGenderLabel(model.gender)], [t('常驻城市', 'City'), model.city], [t('生日', 'Birthday'), model.birthday], [t('联系方式', 'Contact'), model.contact],
    [t('身高', 'Height'), model.heightCm == null ? '' : `${model.heightCm} cm`],
    [t('体重', 'Weight'), model.weightKg == null ? '' : `${model.weightKg} kg`],
  ].filter(([, value]) => value.trim());
  const hasProfile = fields.length > 0 || model.tags.length > 0 || !!model.notes.trim();
  return <section className="model-workspace model-detail" aria-label={t(`${model.name}的档案`, `Profile for ${model.name}`)}>
    <header className="workspace-intro model-editor-header"><div className="model-editor-heading"><IconButton label={backLabel} disabled={disabled} onClick={onBack}><ArrowLeft size={18} /></IconButton><h1>{model.name}</h1></div><div className="workspace-tools"><IconButton label={t('删除档案', 'Delete Profile')} disabled={disabled} onClick={onDelete}><Trash2 size={16} /></IconButton><button type="button" className="button" disabled={disabled} onClick={onEdit}><Pencil size={14} />{t('编辑档案', 'Edit Profile')}</button></div></header>
    <div className="model-detail-layout">
      {hasProfile && <section className="model-profile-readonly model-profile-card" aria-label={t('基本资料', 'Profile Details')}>
        {fields.length > 0 && <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {(model.tags.length > 0 || !!model.notes.trim()) && <div className="model-profile-context">
          {model.tags.length > 0 && <div className="model-detail-field"><h3>{t('风格', 'Style')}</h3><div className="model-readonly-tags">{model.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>}
          {!!model.notes.trim() && <div className="model-detail-field"><h3>{t('备注', 'Notes')}</h3><p className="model-profile-notes">{model.notes}</p></div>}
        </div>}
      </section>}
      <section className="model-sample-section" aria-label={t('全部样片', 'All Portfolio Photos')}>
        {model.photoIds.length > 0 ? <div className="model-samples model-detail-samples">{model.photoIds.map((id, index) => {
          const photo = photoMap.get(id);
          return <article className="model-sample" key={id}><button type="button" className="model-sample-image" disabled={!photo} aria-label={photo ? t(`查看 ${photo.title || photo.originalName}`, `View ${photo.title || photo.originalName}`) : t(`第 ${index + 1} 张样片记录缺失`, `Portfolio photo ${index + 1} is missing`)} onClick={() => setPreview(id)}>
            {photo ? <PhotoImage photo={photo} lazy /> : <span className="model-missing"><ImageOff size={22} />{t('样片记录缺失', 'Portfolio photo missing')}</span>}
          </button></article>;
        })}</div> : <EmptyState title={t('还没有样片', 'No Portfolio Photos Yet')} />}
      </section>
    </div>
    {preview && <PhotoReview photos={ordered} initialPhotoId={preview} context={t(`${model.name}的样片`, `Portfolio for ${model.name}`)} returnLabel={t('返回模特档案', 'Back to Model Profile')} busy={false} onClose={() => setPreview(null)} onRelink={onRelink ?? (async () => { throw new Error(t('请返回图库重新定位这张照片。', 'Return to the library to relink this photo.')); })} />}
  </section>;
}

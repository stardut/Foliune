import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ImagePlus, Upload } from 'lucide-react';
import type { ModelInput, ModelProfile } from '../../lib/model-types';
import type { ModelWorkspaceProps } from './model-workspace-state';
import * as modelsApi from '../../lib/model-api';
import * as api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { EmptyState, IconButton, Modal } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';
import { ModelFields } from './ModelFields';
import { defaultModelStyles } from './ModelStyleTags';
import { ModelSamples } from './ModelSamples';

export function ModelEditor({ model, photos, onSnapshot, onDirtyChange, onBusyChange, onRelink, onClose, onSaved }: ModelWorkspaceProps & {
  model?: ModelProfile; onClose: () => void; onSaved: (model: ModelProfile) => void;
}) {
  const [baseline, setBaseline] = useState<ModelInput>(() => inputOf(model));
  const [draft, setDraft] = useState<ModelInput>(() => inputOf(model));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const mounted = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  function update(next: ModelInput) { setDraft(next); }
  function setPhotos(ids: string[]) { update({ ...draft, photoIds: ids, coverPhotoId: draft.coverPhotoId && ids.includes(draft.coverPhotoId) ? draft.coverPhotoId : ids[0] ?? null }); }
  function leave() { if (busy) return; if (dirty) setLeaving(true); else onClose(); }
  async function save() {
    if (busy) return;
    if (!form.current?.reportValidity()) { setLeaving(false); return; }
    if (!draft.name.trim()) { setError('请填写姓名或昵称。'); setLeaving(false); return; }
    if (draft.tagOptions && draft.tagOptions.length > 100) { setError('可选风格标签最多 100 个，请在管理风格标签中删除不需要的标签。'); setLeaving(false); return; }
    setBusy(true); setError('');
    try {
      const saved = await modelsApi.saveModel(model?.id ?? null, { ...draft, name: draft.name.trim(), tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))], tagOptions: draft.tagOptions ? [...new Set(draft.tagOptions.map((tag) => tag.trim()).filter(Boolean))] : null });
      if (!mounted.current) return;
      setBaseline(inputOf(saved)); setDraft(inputOf(saved)); setLeaving(false); onSaved(saved);
      toast({ title: '已保存模特档案' });
    } catch (cause) { if (mounted.current) { toast({ title: message(cause), status: 'error' }); setLeaving(false); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function importSamples() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.importPhotos('work');
      if (!result || !mounted.current) return;
      onSnapshot(result.snapshot);
      const next = [...new Set([...draft.photoIds, ...result.importedIds])];
      if (result.importedIds.length) setPhotos(next);
      if (result.failures.length) setError(result.failures.map((failure) => `${failure.path}：${failure.message}`).join('\n'));
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="model-workspace" aria-label={model ? `${model.name}的档案` : '新建模特档案'}>
    <header className="workspace-intro model-editor-header"><div className="model-editor-heading"><IconButton label={model ? "返回档案" : "返回模特"} disabled={busy} onClick={leave}><ArrowLeft size={18} /></IconButton><h1>{model ? draft.name || model.name : '新建档案'}</h1></div><div className="workspace-tools">{dirty && <span className="model-save-status">未保存</span>}<button type="button" className="button" disabled={busy} onClick={leave}>取消</button><button type="button" className="button button-primary" disabled={busy || (!dirty && !!model)} onClick={() => void save()}>{busy ? '处理中…' : '保存档案'}</button></div></header>
    {error && <p className="form-error model-error" role="alert">{error}</p>}
    <div className="model-editor-layout">
      <form ref={form} className="model-profile-form model-profile-card" aria-label="基本资料" onSubmit={(event) => { event.preventDefault(); void save(); }}><ModelFields value={draft} onChange={update} disabled={busy} /><button type="submit" className="model-submit-hidden" tabIndex={-1} aria-hidden="true">保存档案</button></form>
      <section className="model-sample-section" aria-label="样片"><div className="model-sample-tools"><div className="workspace-tools"><button type="button" className="text-button" disabled={busy} onClick={() => void importSamples()}><Upload size={14} />导入</button><button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}><ImagePlus size={14} />从图库选择</button></div></div>
        {draft.photoIds.length ? <ModelSamples ids={draft.photoIds} coverId={draft.coverPhotoId} photos={photos} disabled={busy} onChange={setPhotos} onCover={(id) => update({ ...draft, coverPhotoId: id })} onRelink={onRelink} /> : <EmptyState title="还没有样片" action={<button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}><ImagePlus size={15} />选择样片</button>} />}
      </section>
    </div>
    {picking && <PhotoPicker photos={photos} selectedIds={draft.photoIds} title="选择模特样片" onClose={() => setPicking(false)} onConfirm={(ids) => { setPhotos(ids); setPicking(false); }} />}
    {leaving && <Modal title="保存档案修改？" onClose={() => { if (!busy) setLeaving(false); }}><p>离开后，未保存的资料与样片调整将丢失。</p><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setLeaving(false)}>继续编辑</button><button type="button" className="button" disabled={busy} onClick={onClose}>放弃修改</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存并离开'}</button></div></Modal>}
  </section>;
}

function inputOf(model?: ModelProfile): ModelInput {
  const tags = [...new Set((model?.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  const tagOptions = [...new Set((model?.tagOptions ?? [...defaultModelStyles, ...tags]).map((tag) => tag.trim()).filter(Boolean))];
  return { name: model?.name ?? '', contact: model?.contact ?? '', city: model?.city ?? '', tags, tagOptions, notes: model?.notes ?? '', gender: model?.gender ?? '', birthday: model?.birthday ?? '', heightCm: model?.heightCm ?? null, bustCm: model?.bustCm ?? null, waistCm: model?.waistCm ?? null, hipsCm: model?.hipsCm ?? null, photoIds: model?.photoIds ?? [], coverPhotoId: model?.coverPhotoId ?? null };
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

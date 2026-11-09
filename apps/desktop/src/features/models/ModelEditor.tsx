import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ImagePlus } from 'lucide-react';
import type { ModelProfile } from '../../lib/model-types';
import type { ModelWorkspaceProps } from './model-workspace-state';
import * as modelsApi from '../../lib/model-api';
import { useToast } from '../../components/ToastProvider';
import { EmptyState, IconButton, Modal } from '../../components/ui';
import { PhotoSourceDialog } from '../../components/PhotoSourceDialog';
import { ModelFields, type ModelDraft } from './ModelFields';
import { defaultModelStyles } from './ModelStyleTags';
import { ModelSamples } from './ModelSamples';

export function ModelEditor({ model, snapshot, photos, onSnapshot, onDirtyChange, onBusyChange, onRelink, onClose, onSaved }: ModelWorkspaceProps & {
  model?: ModelProfile; onClose: () => void; onSaved: (model: ModelProfile) => void;
}) {
  const [baseline, setBaseline] = useState(() => draftOf(model));
  const [draft, setDraft] = useState(() => draftOf(model));
  const [saving, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const busy = saving || sourceBusy;
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
  function update(next: ModelDraft) { setDraft(next); }
  function setPhotos(ids: string[]) { update({ ...draft, photoIds: ids, coverPhotoId: draft.coverPhotoId && ids.includes(draft.coverPhotoId) ? draft.coverPhotoId : ids[0] ?? null }); }
  function leave() { if (busy) return; if (dirty) setLeaving(true); else onClose(); }
  async function save() {
    if (busy) return;
    if (!form.current?.reportValidity()) { setLeaving(false); return; }
    if (!draft.name.trim()) { setError('请填写姓名或昵称。'); setLeaving(false); return; }
    const heightCm = readMeasurement(draft.heightCm);
    const weightKg = readMeasurement(draft.weightKg);
    if (heightCm === undefined || (heightCm !== null && heightCm > 300)) { setError('身高须大于 0 且不超过 300 cm。'); setLeaving(false); return; }
    if (weightKg === undefined) { setError('体重须为大于 0 的有效数值。'); setLeaving(false); return; }
    if (draft.tagOptions && draft.tagOptions.length > 100) { setError('可选风格标签最多 100 个，请在管理风格标签中删除不需要的标签。'); setLeaving(false); return; }
    setBusy(true); setError('');
    try {
      const saved = await modelsApi.saveModel(model?.id ?? null, { ...draft, heightCm, weightKg, name: draft.name.trim(), tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))], tagOptions: draft.tagOptions ? [...new Set(draft.tagOptions.map((tag) => tag.trim()).filter(Boolean))] : null });
      if (!mounted.current) return;
      setBaseline(draftOf(saved)); setDraft(draftOf(saved)); setLeaving(false); onSaved(saved);
      toast({ title: '已保存模特档案' });
    } catch (cause) { if (mounted.current) { toast({ title: message(cause), status: 'error' }); setLeaving(false); } }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="model-workspace" aria-label={model ? `${model.name}的档案` : '新建模特档案'}>
    <header className="workspace-intro model-editor-header"><div className="model-editor-heading"><IconButton label={model ? "返回档案" : "返回模特"} disabled={busy} onClick={leave}><ArrowLeft size={18} /></IconButton><h1>{model ? draft.name || model.name : '新建档案'}</h1></div><div className="workspace-tools">{dirty && <span className="model-save-status">未保存</span>}<button type="button" className="button" disabled={busy} onClick={leave}>取消</button><button type="button" className="button button-primary" disabled={busy || (!dirty && !!model)} onClick={() => void save()}>{busy ? '处理中…' : '保存档案'}</button></div></header>
    {error && <p className="form-error model-error" role="alert">{error}</p>}
    <div className="model-editor-layout">
      <form ref={form} className="model-profile-form model-profile-card" aria-label="基本资料" onSubmit={(event) => { event.preventDefault(); void save(); }}><ModelFields value={draft} onChange={update} disabled={busy} /><button type="submit" className="model-submit-hidden" tabIndex={-1} aria-hidden="true">保存档案</button></form>
      <section className="model-sample-section" aria-label="样片"><div className="model-sample-tools"><div className="workspace-tools"><button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}><ImagePlus size={14} />添加照片</button></div></div>
        {draft.photoIds.length ? <ModelSamples ids={draft.photoIds} coverId={draft.coverPhotoId} photos={photos} disabled={busy} onChange={setPhotos} onCover={(id) => update({ ...draft, coverPhotoId: id })} onRelink={onRelink} /> : <EmptyState title="还没有样片" action={<button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}><ImagePlus size={15} />选择样片</button>} />}
      </section>
    </div>
    {picking && <PhotoSourceDialog snapshot={snapshot} library="work" selectedIds={draft.photoIds} title="选择模特样片" onBusyChange={setSourceBusy} onClose={() => setPicking(false)} onConfirm={({ photoIds, snapshot }) => { if (snapshot) onSnapshot(snapshot); setPhotos(photoIds); setPicking(false); }} />}
    {leaving && <Modal title="保存档案修改？" onClose={() => { if (!busy) setLeaving(false); }}><p>离开后，未保存的资料与样片调整将丢失。</p><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={() => setLeaving(false)}>继续编辑</button><button type="button" className="button" disabled={busy} onClick={onClose}>放弃修改</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存并离开'}</button></div></Modal>}
  </section>;
}

function draftOf(model?: ModelProfile): ModelDraft {
  const tags = [...new Set((model?.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  const tagOptions = [...new Set((model?.tagOptions ?? [...defaultModelStyles, ...tags]).map((tag) => tag.trim()).filter(Boolean))];
  return { name: model?.name ?? '', contact: model?.contact ?? '', city: model?.city ?? '', tags, tagOptions, notes: model?.notes ?? '', gender: model?.gender ?? '', birthday: model?.birthday ?? '', heightCm: model?.heightCm?.toString() ?? '', weightKg: model?.weightKg?.toString() ?? '', bustCm: model?.bustCm ?? null, waistCm: model?.waistCm ?? null, hipsCm: model?.hipsCm ?? null, photoIds: model?.photoIds ?? [], coverPhotoId: model?.coverPhotoId ?? null };
}
function readMeasurement(raw: string): number | null | undefined {
  if (raw === '') return null;
  const text = raw.trim();
  if (!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

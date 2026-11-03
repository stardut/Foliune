import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { PLAN_MAX_REFERENCES, PLAN_MAX_PARTS, PLAN_MAX_SHOTS, type ShootPlan, type ShootPlanInput } from '../../lib/planning-types';
import type { Photo } from '../../lib/types';
import * as planningApi from '../../lib/planning-api';
import { IconButton, Modal } from '../../components/ui';
import { useToast } from '../../components/ToastProvider';
import { PlanDocument } from './PlanDocument';
import { inputOf, errorMessage, referenceCount, sceneReferenceLimitError, shotCount } from './plan-content';
import { renderPlanPng } from './plan-export';

export function PlanDetail({ plan, photos, onClose, onSaved, onDeleted, onDirtyChange, onBusyChange }: {
  plan?: ShootPlan; photos: Photo[]; onClose: () => void; onSaved: (plan: ShootPlan) => void;
  onDeleted: (id: string) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<ShootPlanInput>(() => inputOf(plan));
  const [baseline, setBaseline] = useState(() => inputOf(plan));
  const [editing, setEditing] = useState(!plan);
  const [busy, setBusy] = useState<'save' | 'delete' | 'export' | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState<'list' | 'read' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const toast = useToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(!!busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy]);
  function begin(operation: NonNullable<typeof busy>) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(operation); setError(''); return true;
  }
  function finish() { busyRef.current = false; if (mounted.current) setBusy(null); }
  function leave() { if (busyRef.current) return; if (dirty) setLeaving('list'); else onClose(); }
  function cancelEditing() {
    if (busyRef.current) return;
    if (dirty) { setLeaving(plan ? 'read' : 'list'); return; }
    if (plan) setEditing(false); else onClose();
  }
  function validate(forSave = false) {
    if (editing && !form.current?.reportValidity()) { setLeaving(null); return false; }
    if (!draft.title.trim()) { setError('请填写策划标题。'); setLeaving(null); return false; }
    if (referenceCount(draft) > PLAN_MAX_REFERENCES || draft.parts.length > PLAN_MAX_PARTS || shotCount(draft) > PLAN_MAX_SHOTS) { setError('最多支持 20 个场景、100 个镜头和 120 张参考图。'); return false; }
    if (forSave) {
      const referenceError = sceneReferenceLimitError(draft);
      if (referenceError) { setError(referenceError); setLeaving(null); return false; }
    }
    return true;
  }
  async function save(closeAfter = false) {
    if (busyRef.current || !validate(true) || !begin('save')) return;
    try {
      const saved = await planningApi.savePlan(plan?.id ?? null, { ...draft, title: draft.title.trim() });
      if (!mounted.current) return;
      setDraft(inputOf(saved)); setBaseline(inputOf(saved)); setEditing(false); setLeaving(null);
      onSaved(saved); toast({ title: '已保存策划' });
      if (closeAfter && leaving === 'list') onClose();
    } catch (cause) { if (mounted.current) { setError(errorMessage(cause)); setLeaving(null); } }
    finally { finish(); }
  }
  async function remove() {
    if (!plan || !begin('delete')) return;
    try { await planningApi.deletePlan(plan.id); if (mounted.current) { onDeleted(plan.id); toast({ title: '已删除策划' }); } }
    catch (cause) { if (mounted.current) { setError(errorMessage(cause)); setDeleting(false); } }
    finally { finish(); }
  }
  async function exportImage() {
    if (busyRef.current || !validate() || !begin('export')) return;
    try {
      const png = await renderPlanPng({ ...draft, title: draft.title.trim() }, photos);
      const path = await planningApi.exportPlanPng(draft.title.trim(), png);
      if (mounted.current && path) toast({ title: '已导出策划长图' });
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { finish(); }
  }
  return <section className="planning-workspace" aria-label={editing ? '编辑拍摄策划' : '阅读拍摄策划'} aria-busy={!!busy}>
    <header className="workspace-intro plan-toolbar"><div className="plan-back"><IconButton label="返回策划列表" disabled={!!busy} onClick={leave}><ArrowLeft size={18} /></IconButton><span>{editing ? plan ? '编辑策划' : '新建策划' : '策划'}</span></div>
      <div className="workspace-tools">{dirty && <span className="plan-save-status">未保存</span>}{plan && <IconButton label="删除策划" disabled={!!busy} onClick={() => setDeleting(true)}><Trash2 size={16} /></IconButton>}
        <button type="button" className="button" disabled={!!busy} onClick={() => void exportImage()}><Download size={14} />{busy === 'export' ? '正在导出…' : '导出长图'}</button>
        {editing ? <><button type="button" className="button" disabled={!!busy} onClick={cancelEditing}>取消</button><button type="button" className="button button-primary" disabled={!!busy || (!dirty && !!plan)} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存策划'}</button></> : <button type="button" className="button" disabled={!!busy} onClick={() => { setEditing(true); setError(''); }}><Pencil size={14} />编辑</button>}
      </div>
    </header>
    {error && <p className="form-error plan-error" role="alert">{error}</p>}
    <form ref={form} onSubmit={(event) => { event.preventDefault(); if (editing) void save(); }}><PlanDocument value={draft} photos={photos} editing={editing} disabled={!!busy} onChange={setDraft} /></form>
    {leaving && <Modal title="保存策划修改？" onClose={() => { if (!busyRef.current) setLeaving(null); }}><p>离开后，未保存的内容与参考图调整将丢失。</p><div className="form-actions"><button type="button" className="button" disabled={!!busy} onClick={() => setLeaving(null)}>继续编辑</button><button type="button" className="button" disabled={!!busy} onClick={() => { if (leaving === 'read') { setDraft(inputOf(plan)); setEditing(false); setLeaving(null); setError(''); } else onClose(); }}>放弃修改</button><button type="button" className="button button-primary" disabled={!!busy} onClick={() => void save(true)}>{busy === 'save' ? '保存中…' : '保存并返回'}</button></div></Modal>}
    {deleting && <Modal title="删除这份策划？" onClose={() => { if (!busyRef.current) setDeleting(false); }}><p>将删除“{plan?.title}”的策划内容，图库照片与原件保留。</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={!!busy} onClick={() => setDeleting(false)}>取消</button><button type="button" className="button button-danger" disabled={!!busy} onClick={() => void remove()}>{busy === 'delete' ? '删除中…' : '删除策划'}</button></div></Modal>}
  </section>;
}

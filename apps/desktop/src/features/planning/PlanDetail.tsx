import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { PLAN_MAX_REFERENCES, PLAN_MAX_PARTS, PLAN_MAX_SHOTS, type ShootPlan, type ShootPlanInput } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import * as planningApi from '../../lib/planning-api';
import { exportedFileName, selectExportDirectory } from '../../lib/export-directory';
import { IconButton, Modal } from '../../components/ui';
import { useToast } from '../../components/ToastProvider';
import { PlanDocument } from './PlanDocument';
import { inputOf, errorMessage, referenceCount, sceneReferenceLimitError, shotCount } from './plan-content';
import { renderPlanPng } from './plan-export';

const executionDateError = '请选择有效的执行日期。';

export function PlanDetail({ plan, snapshot, photos, onSnapshot, onClose, onSaved, onDeleted, onDirtyChange, onBusyChange, backLabel = '返回策划列表' }: {
  plan?: ShootPlan; snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void; onSaved: (plan: ShootPlan) => void;
  onDeleted: (id: string) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; backLabel?: string;
}) {
  const [draft, setDraft] = useState<ShootPlanInput>(() => inputOf(plan));
  const [baseline, setBaseline] = useState(() => inputOf(plan));
  const [editing, setEditing] = useState(!plan);
  const [busy, setBusy] = useState<'save' | 'delete' | 'export' | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const blocked = !!busy || sourceBusy;
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState<'list' | 'read' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const formId = useId();
  const errorId = `${formId}-error`;
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const toast = useToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(blocked); return () => onBusyChange(false); }, [blocked, onBusyChange]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || blocked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, blocked]);
  function begin(operation: NonNullable<typeof busy>) {
    if (busyRef.current || sourceBusy) return false;
    busyRef.current = true; setBusy(operation); setError(''); return true;
  }
  function finish() { busyRef.current = false; if (mounted.current) setBusy(null); }
  function leave() { if (busyRef.current || sourceBusy) return; if (dirty) setLeaving('list'); else onClose(); }
  function cancelEditing() {
    if (busyRef.current || sourceBusy) return;
    if (dirty) { setLeaving(plan ? 'read' : 'list'); return; }
    if (plan) setEditing(false); else onClose();
  }
  function rejectField(name: 'title' | 'executionDate', message: string) {
    setError(message);
    setLeaving(null);
    // The save-and-return dialog must close before focusing a field outside it.
    requestAnimationFrame(() => {
      const field = form.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      field?.focus();
      field?.reportValidity();
    });
    return false;
  }
  function validate(forSave = false) {
    if (!draft.title.trim()) return rejectField('title', '请填写策划标题。');
    if (forSave && !form.current?.checkValidity()) return rejectField('executionDate', executionDateError);
    if (referenceCount(draft) > PLAN_MAX_REFERENCES || draft.parts.length > PLAN_MAX_PARTS || shotCount(draft) > PLAN_MAX_SHOTS) { setError('最多支持 20 个场景、100 个镜头和 120 张参考图。'); return false; }
    if (forSave) {
      const referenceError = sceneReferenceLimitError(draft);
      if (referenceError) { setError(referenceError); setLeaving(null); return false; }
    }
    return true;
  }
  async function save(closeAfter = false) {
    if (busyRef.current || sourceBusy || !validate(true) || !begin('save')) return;
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
    try {
      const next = await planningApi.deletePlan(plan.id);
      if (mounted.current) { onSnapshot(next); onDeleted(plan.id); toast({ title: '已删除策划' }); }
    } catch (cause) { if (mounted.current) { setError(errorMessage(cause)); setDeleting(false); } }
    finally { finish(); }
  }
  async function exportImage() {
    if (busyRef.current || sourceBusy || !validate() || !begin('export')) return;
    try {
      const directory = await selectExportDirectory('选择策划长图导出目录');
      if (!directory || !mounted.current) return;
      const png = await renderPlanPng({ ...draft, title: draft.title.trim() }, photos);
      const path = await planningApi.exportPlanPng(directory, draft.title.trim(), png);
      if (mounted.current) toast({ title: `已导出 ${exportedFileName(path)}` });
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { finish(); }
  }
  return <section className="planning-workspace" aria-label={editing ? '编辑拍摄策划' : '阅读拍摄策划'} aria-busy={blocked}>
    <header className="workspace-intro plan-toolbar"><div className="plan-back"><IconButton label={backLabel} disabled={blocked} onClick={leave}><ArrowLeft size={18} /></IconButton><span>{editing ? plan ? '编辑策划' : '新建策划' : '策划'}</span></div>
      <div className="workspace-tools">{dirty && <span className="plan-save-status">未保存</span>}{plan && <IconButton label="删除策划" disabled={blocked} onClick={() => setDeleting(true)}><Trash2 size={16} /></IconButton>}
        <button type="button" className="button" disabled={blocked} onClick={() => void exportImage()}><Download size={14} />{busy === 'export' ? '正在导出…' : '导出长图'}</button>
        {editing ? <><button type="button" className="button" disabled={blocked} onClick={cancelEditing}>取消</button><button type="submit" form={formId} className="button button-primary" disabled={blocked || (!dirty && !!plan)}>{busy === 'save' ? '保存中…' : '保存策划'}</button></> : <button type="button" className="button" disabled={blocked} onClick={() => { setEditing(true); setError(''); }}><Pencil size={14} />编辑</button>}
      </div>
    </header>
    {error && <p id={errorId} className="form-error plan-error" role="alert">{error}</p>}
    <form id={formId} ref={form} noValidate onSubmit={(event) => { event.preventDefault(); if (editing) void save(); }}>
      <PlanDocument snapshot={snapshot} value={draft} photos={photos} onSnapshot={onSnapshot} onSourceBusyChange={setSourceBusy} editing={editing} disabled={!!busy}
        executionDateErrorId={error === executionDateError ? errorId : undefined} onChange={(value) => {
          if (value.executionDate !== draft.executionDate && error === executionDateError) setError('');
          setDraft(value);
        }} />
    </form>
    {leaving && <Modal title="保存策划修改？" onClose={() => { if (!busyRef.current) setLeaving(null); }}><p>离开后，未保存的内容与参考图调整将丢失。</p><div className="form-actions"><button type="button" className="button" disabled={blocked} onClick={() => setLeaving(null)}>继续编辑</button><button type="button" className="button" disabled={blocked} onClick={() => { if (leaving === 'read') { setDraft(inputOf(plan)); setEditing(false); setLeaving(null); setError(''); } else onClose(); }}>放弃修改</button><button type="button" className="button button-primary" disabled={blocked} onClick={() => void save(true)}>{busy === 'save' ? '保存中…' : '保存并返回'}</button></div></Modal>}
    {deleting && <Modal title="删除这份策划？" onClose={() => { if (!busyRef.current) setDeleting(false); }}><p>将删除“{plan?.title}”。仅在此策划使用的参考照片将从全局搜索和图库选片中移除，照片文件会保留。</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={blocked} onClick={() => setDeleting(false)}>取消</button><button type="button" className="button button-danger" disabled={blocked} onClick={() => void remove()}>{busy === 'delete' ? '删除中…' : '删除策划'}</button></div></Modal>}
  </section>;
}

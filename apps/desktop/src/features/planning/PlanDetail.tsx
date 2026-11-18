import { t } from '../../lib/i18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Pencil, Trash2 } from 'lucide-react';
import { PLAN_MAX_REFERENCES, PLAN_MAX_PARTS, PLAN_MAX_SHOTS, type ShootPlan, type ShootPlanInput } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import * as planningApi from '../../lib/planning-api';
import { exportedFileName, selectExportDirectory } from '../../lib/export-directory';
import { parseDateParts } from '../../lib/date-picker';
import { EmptyState, IconButton, Modal } from '../../components/ui';
import { useToast } from '../../components/ToastProvider';
import { PlanDocument } from './PlanDocument';
import { inputOf, errorMessage, referenceCount, sceneReferenceLimitError, shotCount } from './plan-content';
import { renderPlanPng } from './plan-export';

const executionDateError = t('请选择有效的执行日期。', 'Select a valid shoot date.');

function beginDraft(plan?: ShootPlan) {
  const input = inputOf(plan);
  return { input, baseline: input, revision: plan?.updatedAt ?? null };
}

export function PlanDetail({ plan, removed = false, snapshot, photos, onSnapshot, onClose, onSaved, onDeleted, onRefresh, onDirtyChange, onBusyChange, backLabel = t('返回策划列表', 'Back to Shoot Plans') }: {
  plan?: ShootPlan; removed?: boolean; snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onClose: () => void; onSaved: (plan: ShootPlan) => void;
  onDeleted: (id: string) => void; onRefresh?: () => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; backLabel?: string;
}) {
  const [draft, setDraft] = useState(() => plan ? null : beginDraft());
  const editing = draft !== null;
  const savedInput = useMemo(() => inputOf(plan), [plan]);
  const input = draft?.input ?? savedInput;
  const [busy, setBusy] = useState<'save' | 'delete' | 'export' | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const blocked = !!busy || sourceBusy;
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState<'list' | 'read' | null>(null);
  const [deleting, setDeleting] = useState<ShootPlan | null>(null);
  const formId = useId();
  const errorId = `${formId}-error`;
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const toast = useToast();
  const dirty = !!draft && JSON.stringify(draft.input) !== JSON.stringify(draft.baseline);
  const unavailable = removed && !editing && !blocked && !deleting;
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
  function discardDraft() { setDraft(null); setLeaving(null); setError(''); }
  function cancelEditing() {
    if (busyRef.current || sourceBusy) return;
    if (dirty) { setLeaving(plan ? 'read' : 'list'); return; }
    if (plan) discardDraft(); else onClose();
  }
  function rejectField(name: 'title' | 'executionDate', message: string) {
    setError(message);
    setLeaving(null);
    // The save-and-return dialog must close before focusing a field outside it.
    requestAnimationFrame(() => {
      const field = form.current?.querySelector<HTMLInputElement | HTMLButtonElement>(`[name="${name}"]`);
      field?.focus();
      if (name === 'title') field?.reportValidity();
    });
    return false;
  }
  function validate(forSave = false) {
    if (!input.title.trim()) return rejectField('title', t('请填写策划标题。', 'Enter a title for this plan.'));
    if (forSave && !parseDateParts(input.executionDate)) return rejectField('executionDate', executionDateError);
    if (referenceCount(input) > PLAN_MAX_REFERENCES || input.parts.length > PLAN_MAX_PARTS || shotCount(input) > PLAN_MAX_SHOTS) { setError(t('最多支持 20 个场景、100 个镜头和 120 张参考图。', 'A plan supports up to 20 scenes, 100 shots, and 120 reference photos.')); return false; }
    if (forSave) {
      const referenceError = sceneReferenceLimitError(input);
      if (referenceError) { setError(referenceError); setLeaving(null); return false; }
    }
    return true;
  }
  async function save(closeAfter = false) {
    if (!draft || removed || busyRef.current || sourceBusy || !validate(true) || !begin('save')) return;
    try {
      const saved = await planningApi.savePlan(plan?.id ?? null, { ...input, title: input.title.trim() }, draft.revision);
      if (!mounted.current) return;
      discardDraft();
      onSaved(saved); toast({ title: t('已保存策划', 'Shoot plan saved') });
      if (closeAfter && leaving === 'list') onClose();
    } catch (cause) {
      if (mounted.current) {
        const message = errorMessage(cause);
        setError(message); setLeaving(null);
        if (message === planningApi.planRevisionConflict || message === planningApi.planMissing) onRefresh?.();
      }
    }
    finally { finish(); }
  }
  async function remove() {
    if (!deleting || removed || !begin('delete')) return;
    try {
      const next = await planningApi.deletePlan(deleting.id, deleting.updatedAt);
      if (mounted.current) { onSnapshot(next); onDeleted(deleting.id); toast({ title: t('已删除策划', 'Shoot plan deleted') }); }
    } catch (cause) {
      if (mounted.current) {
        const message = errorMessage(cause);
        setError(message); setDeleting(null);
        if (message === planningApi.planRevisionConflict || message === planningApi.planMissing) onRefresh?.();
      }
    }
    finally { finish(); }
  }
  async function exportImage() {
    if (busyRef.current || sourceBusy || !validate() || !begin('export')) return;
    try {
      const directory = await selectExportDirectory(t('选择策划长图导出目录', 'Choose a Folder for the Shoot Plan PNG'));
      if (!directory || !mounted.current) return;
      const png = await renderPlanPng({ ...input, title: input.title.trim() }, photos);
      const path = await planningApi.exportPlanPng(directory, input.title.trim(), png);
      if (mounted.current) toast({ title: t(`已导出 ${exportedFileName(path)}`, `Exported ${exportedFileName(path)}`) });
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { finish(); }
  }
  function changeInput(value: ShootPlanInput) {
    if (value.executionDate !== input.executionDate && error === executionDateError) setError('');
    setDraft((current) => current && { ...current, input: value });
  }
  if (unavailable) return <section className="planning-workspace" aria-label={t('拍摄策划', 'Shoot Plans')}>
    <EmptyState title={t('拍摄策划已删除', 'This Shoot Plan Has Been Deleted')} action={<button type="button" className="button" autoFocus onClick={onClose}>{backLabel}</button>} />
  </section>;
  return <section className="planning-workspace" aria-label={editing ? t('编辑拍摄策划', 'Edit Shoot Plan') : t('阅读拍摄策划', 'View Shoot Plan')} aria-busy={blocked}>
    <header className="workspace-intro plan-toolbar"><div className="plan-back"><IconButton label={backLabel} disabled={blocked} onClick={leave}><ArrowLeft size={18} /></IconButton><span>{editing ? plan ? t('编辑策划', 'Edit Plan') : t('新建策划', 'New Plan') : t('策划', 'Shoot Plan')}</span></div>
      <div className="workspace-tools">{dirty && <span className="plan-save-status">{t('未保存', 'Unsaved')}</span>}{plan && !removed && <IconButton label={t('删除策划', 'Delete Plan')} disabled={blocked} onClick={() => setDeleting(plan)}><Trash2 size={16} /></IconButton>}
        <button type="button" className="button" disabled={blocked} onClick={() => void exportImage()}><Download size={14} />{busy === 'export' ? t('正在导出…', 'Exporting…') : t('导出长图', 'Export PNG')}</button>
        {editing ? <><button type="button" className="button" disabled={blocked} onClick={cancelEditing}>{t('取消', 'Cancel')}</button><button type="submit" form={formId} className="button button-primary" disabled={blocked || removed || (!dirty && !!plan)}>{busy === 'save' ? t('保存中…', 'Saving…') : t('保存策划', 'Save Plan')}</button></> : <button type="button" className="button" disabled={blocked || removed} onClick={() => { setDraft(beginDraft(plan)); setError(''); }}><Pencil size={14} />{t('编辑', 'Edit')}</button>}
      </div>
    </header>
    {removed && <p className="form-error plan-error" role="alert">{t('拍摄策划已删除。', 'This shoot plan has been deleted.')}</p>}
    {error && !(removed && error === planningApi.planMissing) && <p id={errorId} className="form-error plan-error" role="alert">{error}</p>}
    <form id={formId} ref={form} noValidate onSubmit={(event) => { event.preventDefault(); if (editing) void save(); }}>
      <PlanDocument snapshot={snapshot} value={input} photos={photos} onSnapshot={onSnapshot} onSourceBusyChange={setSourceBusy} editing={editing} disabled={!!busy}
        executionDateErrorId={error === executionDateError ? errorId : undefined} onChange={changeInput} />
    </form>
    {leaving && <Modal title={removed ? t('放弃策划修改？', 'Discard Plan Changes?') : t('保存策划修改？', 'Save Plan Changes?')} onClose={() => { if (!busyRef.current) setLeaving(null); }}><p>{t('离开后，未保存的内容与参考图调整将丢失。', 'Leaving this page discards unsaved plan and reference photo changes.')}</p><div className="form-actions"><button type="button" className="button" disabled={blocked} onClick={() => setLeaving(null)}>{t('继续编辑', 'Keep Editing')}</button><button type="button" className="button" disabled={blocked} onClick={leaving === 'read' ? discardDraft : onClose}>{t('放弃修改', 'Discard Changes')}</button>{!removed && <button type="button" className="button button-primary" disabled={blocked} onClick={() => void save(true)}>{busy === 'save' ? t('保存中…', 'Saving…') : t('保存并返回', 'Save and Go Back')}</button>}</div></Modal>}
    {deleting && <Modal title={t('删除这份策划？', 'Delete This Shoot Plan?')} onClose={() => { if (!busyRef.current) setDeleting(null); }}>{removed ? <p>{t('拍摄策划已删除。', 'This shoot plan has been deleted.')}</p> : <p>{t(`将删除“${deleting.title}”。仅在此策划使用的参考照片将从全局搜索和图库选片中移除，照片文件会保留。`, `Delete “${deleting.title}”? Reference photos used only in this plan will be removed from global search and the photo picker. The photo files will be kept.`)}</p>}<div className="form-actions"><button type="button" className="button" autoFocus disabled={blocked} onClick={() => setDeleting(null)}>{t('取消', 'Cancel')}</button>{!removed && <button type="button" className="button button-danger" disabled={blocked} onClick={() => void remove()}>{busy === 'delete' ? t('删除中…', 'Deleting…') : t('删除策划', 'Delete Plan')}</button>}</div></Modal>}
  </section>;
}

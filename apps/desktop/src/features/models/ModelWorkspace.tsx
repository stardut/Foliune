import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { ModelProfile } from '../../lib/model-types';
import * as modelsApi from '../../lib/model-api';
import { Busy, EmptyState, IconButton, Modal, WorkspaceHeader } from '../../components/ui';
import { ModelEditor } from './ModelEditor';
import { ModelDetail } from './ModelDetail';
import { ModelOverviewRow } from './ModelOverviewRow';
import { modelViewReducer, type ModelWorkspaceProps } from './model-workspace-state';
import './models.css';

export function ModelWorkspace({ initialModel, onBackToSearch, ...props }: ModelWorkspaceProps & { initialModel?: ModelProfile; onBackToSearch?: () => void }) {
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [view, navigate] = useReducer(modelViewReducer, initialModel ? { page: 'detail', model: initialModel } : { page: 'home' });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [deleting, setDeleting] = useState<ModelProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const mounted = useRef(true);
  const deletingNow = useRef(false);
  const viewRoot = useRef<HTMLDivElement>(null);
  const previousPage = useRef(view.page);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!deleteBusy) return;
    props.onBusyChange?.(true);
    props.onDirtyChange(true);
    return () => { props.onBusyChange?.(false); props.onDirtyChange(false); };
  }, [deleteBusy, props.onBusyChange, props.onDirtyChange]);
  useLayoutEffect(() => {
    if (previousPage.current === view.page) return;
    previousPage.current = view.page;
    const root = viewRoot.current;
    // App's main scrolls below the navigation; keep its top padding visible.
    const scrollArea = root?.closest('main');
    if (scrollArea) scrollArea.scrollTop = 0;
    const heading = root?.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [view.page]);
  useEffect(() => {
    if (initialModel) return;
    let current = true; setLoading(true); setError('');
    void modelsApi.listModels().then((items) => { if (current) setModels(items); })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [initialModel, revision]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return models.filter((model) => [model.name, model.city, model.contact, model.notes, ...model.tags].join(' ').toLocaleLowerCase().includes(term));
  }, [models, query]);
  const photoMap = useMemo(() => new Map(props.photos.map((photo) => [photo.id, photo])), [props.photos]);
  function requestDelete(model: ModelProfile) { setDeleteError(''); setDeleting(model); }
  function closeDelete() { if (!deletingNow.current) { setDeleting(null); setDeleteError(''); } }
  async function remove() {
    if (!deleting || deletingNow.current) return;
    const id = deleting.id;
    deletingNow.current = true; setDeleteBusy(true); setDeleteError('');
    try {
      const next = await modelsApi.deleteModel(id);
      if (!mounted.current) return;
      props.onSnapshot(next);
      setModels((items) => items.filter((item) => item.id !== id));
      setDeleting(null);
      if (view.page === 'detail' && view.model.id === id) {
        if (onBackToSearch) onBackToSearch(); else navigate({ type: 'deleted' });
      }
    } catch (cause) { if (mounted.current) setDeleteError(cause instanceof Error ? cause.message : String(cause)); }
    finally { deletingNow.current = false; if (mounted.current) setDeleteBusy(false); }
  }
  let content;
  if (view.page === 'edit') content = <ModelEditor {...props} key={view.model?.id ?? 'new'} model={view.model}
    onClose={() => navigate({ type: 'back' })}
    onSaved={(saved) => { setModels((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); navigate({ type: 'saved', model: saved }); }} />;
  else if (view.page === 'detail') content = <ModelDetail model={view.model} photos={props.photos} onRelink={props.onRelink} disabled={deleteBusy}
    backLabel={onBackToSearch ? '返回搜索' : undefined} onBack={onBackToSearch ?? (() => navigate({ type: 'back' }))}
    onEdit={() => navigate({ type: 'edit' })} onDelete={() => requestDelete(view.model)} />;
  else content = <section className="model-home" aria-label="模特档案">
    <WorkspaceHeader title="模特" count={`${models.length} 份档案`}>
      <button type="button" className="button" disabled={loading} onClick={() => navigate({ type: 'new' })}><Plus size={15} />新建档案</button>
    </WorkspaceHeader>
    <div className="model-workspace">
      {loading ? <Busy label="正在读取模特档案" /> : error ? <div className="model-load-error"><p className="form-error" role="alert">{error}</p><button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : <>
        {!!models.length && <div className="search-field"><Search size={17} /><input aria-label="搜索模特" placeholder="搜索姓名、城市或风格" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空搜索" onClick={() => setQuery('')}><X size={15} /></IconButton>}</div>}
        {!models.length ? <EmptyState title="建立第一份模特档案" action={<button type="button" className="button" onClick={() => navigate({ type: 'new' })}><Plus size={15} />新建档案</button>} /> : !filtered.length ? <EmptyState title="没有找到模特" /> : <div className="model-overview-list">{filtered.map((model) => <ModelOverviewRow key={model.id} model={model} photos={photoMap} disabled={deleteBusy} onOpen={() => navigate({ type: 'open', model })} onDelete={() => requestDelete(model)} />)}</div>}
      </>}
    </div>
  </section>;
  return <div className="model-workspace-view" ref={viewRoot}>{content}
    {deleteError && !deleting && <p className="form-error model-error" role="alert">{deleteError}</p>}
    {deleting && <Modal title="删除模特档案？" onClose={closeDelete}><p>将删除“{deleting.name}”的资料。仅在此档案使用的样片将从全局搜索和图库选片中移除，照片文件会保留。</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<div className="form-actions"><button type="button" className="button" autoFocus disabled={deleteBusy} onClick={closeDelete}>取消</button><button type="button" className="button button-danger" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? '删除中…' : '删除档案'}</button></div></Modal>}
  </div>;
}

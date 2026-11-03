import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Search, X } from 'lucide-react';
import type { ShootPlan } from '../../lib/planning-types';
import type { Photo } from '../../lib/types';
import * as planningApi from '../../lib/planning-api';
import { Busy, EmptyState, IconButton } from '../../components/ui';
import { PlanDetail } from './PlanDetail';
import { errorMessage, planSearchText, shotCount } from './plan-content';
import './planning.css';

export function PlanningWorkspace({ photos, onDirtyChange, onBusyChange }: {
  photos: Photo[]; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [plans, setPlans] = useState<ShootPlan[]>([]);
  const [active, setActive] = useState<ShootPlan | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void planningApi.listPlans().then((items) => { if (current) setPlans(items); })
      .catch((cause: unknown) => { if (current) setError(errorMessage(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return plans.filter((plan) => planSearchText(plan).toLocaleLowerCase().includes(term));
  }, [plans, query]);
  if (active) return <PlanDetail key={active === 'new' ? 'new' : active.id} plan={active === 'new' ? undefined : active} photos={photos}
    onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onClose={() => setActive(null)}
    onSaved={(saved) => { setPlans((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); setActive(saved); }}
    onDeleted={(id) => { setPlans((items) => items.filter((item) => item.id !== id)); setActive(null); }} />;
  return <section className="planning-workspace" aria-label="拍摄策划">
    <header className="workspace-intro"><div className="planning-home-title"><h1>策划</h1>{!loading && !error && <p className="photo-count">{plans.length} 份策划</p>}</div><button type="button" className="button" disabled={loading || !!error} onClick={() => setActive('new')}><Plus size={15} />新建策划</button></header>
    {loading ? <Busy label="正在读取策划" /> : error ? <div className="planning-load-error"><p className="form-error" role="alert">{error}</p><button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : <>
      {!!plans.length && <div className="search-field"><Search size={17} /><input aria-label="搜索策划" placeholder="搜索策划、场景或参考意图" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空搜索" onClick={() => setQuery('')}><X size={15} /></IconButton>}</div>}
      {!plans.length ? <EmptyState title="写下下一次拍摄的想法" action={<button type="button" className="button" onClick={() => setActive('new')}><Plus size={15} />新建策划</button>} /> : !filtered.length ? <EmptyState title="没有找到策划" /> : <div className="plan-list">{filtered.map((plan) => <button key={plan.id} type="button" className="plan-list-item" onClick={() => setActive(plan)}>
        <div className="plan-list-heading"><h2>{plan.title}</h2><ArrowUpRight size={18} strokeWidth={1.25} aria-hidden="true" /></div>
        {(plan.shootDate || plan.location) && <p className="plan-list-meta">{[plan.shootDate, plan.location].filter(Boolean).join(' · ')}</p>}
        {plan.concept && <p className="plan-list-excerpt">{plan.concept}</p>}<p className="plan-list-meta">{plan.parts.length} 个场景 · {shotCount(plan)} 个镜头 · {plan.parts.reduce((count, part) => count + part.references.length, 0)} 张场景参考</p>
      </button>)}</div>}
    </>}
  </section>;
}

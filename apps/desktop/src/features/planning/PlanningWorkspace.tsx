import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Search, X } from 'lucide-react';
import type { ShootPlan } from '../../lib/planning-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import * as planningApi from '../../lib/planning-api';
import { Busy, EmptyState, IconButton, WorkspaceHeader } from '../../components/ui';
import { PlanDetail } from './PlanDetail';
import { comparePlanExecutionDate, errorMessage, planSearchText, shotCount } from './plan-content';
import './planning.css';

export function PlanningWorkspace({ snapshot, photos, onSnapshot, onDirtyChange, onBusyChange, initialPlan, onBackToSearch }: {
  snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
  initialPlan?: ShootPlan; onBackToSearch?: () => void;
}) {
  const [plans, setPlans] = useState<ShootPlan[]>([]);
  const [active, setActive] = useState<ShootPlan | 'new' | null>(initialPlan ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (initialPlan) return;
    let current = true; setLoading(true); setError('');
    void planningApi.listPlans().then((items) => { if (current) setPlans(items); })
      .catch((cause: unknown) => { if (current) setError(errorMessage(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [initialPlan, revision]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return plans.filter((plan) => planSearchText(plan).toLocaleLowerCase().includes(term)).sort(comparePlanExecutionDate);
  }, [plans, query]);
  const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const closeDetail = onBackToSearch ?? (() => setActive(null));
  if (active) return <PlanDetail snapshot={snapshot} key={active === 'new' ? 'new' : active.id} plan={active === 'new' ? undefined : active} photos={photos} onSnapshot={onSnapshot}
    onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} backLabel={onBackToSearch ? '返回搜索' : undefined} onClose={closeDetail}
    onSaved={(saved) => { setPlans((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); setActive(saved); }}
    onDeleted={(id) => { setPlans((items) => items.filter((item) => item.id !== id)); closeDetail(); }} />;
  return <section aria-label="拍摄策划">
    <WorkspaceHeader title="策划" count={!loading && !error ? `${plans.length} 份策划` : undefined}>
      <button type="button" className="button" disabled={loading || !!error} onClick={() => setActive('new')}><Plus size={15} />新建策划</button>
    </WorkspaceHeader>
    <div className="planning-home-content">
      {loading ? <Busy label="正在读取策划" /> : error ? <div className="planning-load-error"><p className="form-error" role="alert">{error}</p><button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : <>
        {!!plans.length && <div className="search-field"><Search size={17} /><input aria-label="搜索策划" placeholder="搜索策划、场景或参考意图" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空搜索" onClick={() => setQuery('')}><X size={15} /></IconButton>}</div>}
        {!plans.length ? <EmptyState title="写下下一次拍摄的想法" action={<button type="button" className="button" onClick={() => setActive('new')}><Plus size={15} />新建策划</button>} /> : !filtered.length ? <EmptyState title="没有找到策划" /> : <div className="plan-list">
          {filtered.map((plan) => <PlanListItem key={plan.id} plan={plan} photosById={photosById} onOpen={() => setActive(plan)} />)}
        </div>}
      </>}
    </div>
  </section>;
}

function PlanListItem({ plan, photosById, onOpen }: {
  plan: ShootPlan; photosById: ReadonlyMap<string, Photo>; onOpen: () => void;
}) {
  const titleId = useId();
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const references = plan.parts.flatMap((part) => part.references);
  const photoIds = new Set(references.map((reference) => reference.photoId));
  const previews = Array.from(photoIds, (id) => photosById.get(id))
    .filter((photo): photo is Photo => !!photo?.originalAvailable && photo.thumbnailAvailable
      && !!photo.thumbnailUrl && !failedSources.has(photo.thumbnailUrl))
    .slice(0, 2);
  const shootTime = plan.shootDate.trim() === plan.executionDate ? '' : plan.shootDate;
  const timeAndLocation = [shootTime, plan.location].filter(Boolean).join(' · ');
  const dateAndLocationId = `${titleId}-date-location`;
  const excerptId = `${titleId}-excerpt`;
  const countsId = `${titleId}-counts`;
  const descriptionIds = [dateAndLocationId, plan.concept && excerptId, countsId].filter(Boolean).join(' ');

  return <button type="button" className="plan-list-item" aria-labelledby={titleId} aria-describedby={descriptionIds} onClick={onOpen}>
    <span className="plan-list-copy">
      <span id={titleId} className="plan-list-title">{plan.title}</span>
      <span id={dateAndLocationId} className="plan-list-meta">
        {plan.executionDate ? <span className="plan-list-date">执行日期 <time dateTime={plan.executionDate}>{plan.executionDate}</time></span> : '未设执行日期'}
        {timeAndLocation && ` · ${timeAndLocation}`}
      </span>
      {plan.concept && <span id={excerptId} className="plan-list-excerpt">{plan.concept}</span>}
      <span id={countsId} className="plan-list-meta">{plan.parts.length} 个场景 · {shotCount(plan)} 个镜头 · {references.length} 张场景参考</span>
    </span>
    {previews.length > 0 && <span className="plan-list-previews" aria-hidden="true">
      {previews.map((photo) => <img key={photo.id} src={photo.thumbnailUrl} width={photo.width} height={photo.height}
        alt="" loading="lazy" decoding="async" draggable={false}
        onError={() => setFailedSources((sources) => new Set(sources).add(photo.thumbnailUrl))} />)}
    </span>}
    <ArrowUpRight className="plan-list-arrow" size={18} aria-hidden="true" />
  </button>;
}

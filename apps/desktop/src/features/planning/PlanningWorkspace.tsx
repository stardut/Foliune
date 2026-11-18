import { t } from '../../lib/i18n';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { TauriEvent } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
  const [plans, setPlans] = useState<ShootPlan[] | null>(null);
  const [active, setActive] = useState<ShootPlan | 'new' | null>(initialPlan ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const loadGeneration = useRef(0);
  const refresh = useCallback(() => {
    loadGeneration.current += 1;
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().listen(TauriEvent.WINDOW_FOCUS, () => { if (mounted) refresh(); }).then((stop) => {
      if (mounted) unlisten = stop;
      else stop();
    }).catch((cause: unknown) => console.error(t('无法监听策划窗口的焦点变化', 'Could not listen for focus changes in the Shoot Plans window'), cause));
    return () => { mounted = false; unlisten?.(); };
  }, [refresh]);
  useEffect(() => {
    if (initialPlan && revision === 0) return;
    let mounted = true;
    const generation = loadGeneration.current;
    const current = () => mounted && generation === loadGeneration.current;
    void planningApi.listPlans().then((items) => {
      if (!current()) return;
      setError('');
      setPlans(items);
      setActive((plan) => plan && plan !== 'new' ? items.find((item) => item.id === plan.id) ?? plan : plan);
    }).catch((cause: unknown) => { if (current()) setError(errorMessage(cause)); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { mounted = false; };
  }, [initialPlan, revision]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (plans ?? []).filter((plan) => planSearchText(plan).toLocaleLowerCase().includes(term)).sort(comparePlanExecutionDate);
  }, [plans, query]);
  const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const closeDetail = onBackToSearch ?? (() => { setActive(null); refresh(); });
  if (active) return <PlanDetail snapshot={snapshot} key={active === 'new' ? 'new' : active.id} plan={active === 'new' ? undefined : active} photos={photos} onSnapshot={onSnapshot}
    removed={active !== 'new' && plans !== null && !plans.some((item) => item.id === active.id)}
    onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} backLabel={onBackToSearch ? t('返回搜索', 'Back to Search') : undefined} onClose={closeDetail}
    onRefresh={refresh} onSaved={(saved) => { refresh(); setPlans((items) => [saved, ...(items ?? []).filter((item) => item.id !== saved.id)]); setActive(saved); }}
    onDeleted={(id) => { setPlans((items) => items && items.filter((item) => item.id !== id)); closeDetail(); }} />;
  const planCount = plans?.length ?? 0;
  return <section aria-label={t('拍摄策划', 'Shoot Plans')}>
    <WorkspaceHeader title={t('策划', 'Shoot Plans')} count={!loading && !error ? t(`${planCount} 份策划`, `${planCount} ${planCount === 1 ? 'plan' : 'plans'}`) : undefined}>
      <button type="button" className="button" disabled={loading || !!error} onClick={() => setActive('new')}><Plus size={15} />{t('新建策划', 'New Plan')}</button>
    </WorkspaceHeader>
    <div className="planning-home-content">
      {loading ? <Busy label={t('正在读取策划', 'Loading shoot plans')} /> : error ? <div className="planning-load-error"><p className="form-error" role="alert">{error}</p><button type="button" className="button" onClick={() => { setLoading(true); refresh(); }}>{t('重新读取', 'Reload')}</button></div> : <>
        {planCount > 0 && <div className="search-field"><Search size={17} /><input aria-label={t('搜索策划', 'Search Shoot Plans')} placeholder={t('搜索策划、场景或参考意图', 'Search plans, scenes, or reference notes')} value={query} onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label={t('清空搜索', 'Clear Search')} onClick={() => setQuery('')}><X size={15} /></IconButton>}</div>}
        {!planCount ? <EmptyState title={t('写下下一次拍摄的想法', 'Plan Your Next Shoot')} action={<button type="button" className="button" onClick={() => setActive('new')}><Plus size={15} />{t('新建策划', 'New Plan')}</button>} /> : !filtered.length ? <EmptyState title={t('没有找到策划', 'No Shoot Plans Found')} /> : <div className="plan-list">
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
  const shots = shotCount(plan);
  const descriptionIds = [dateAndLocationId, plan.concept && excerptId, countsId].filter(Boolean).join(' ');

  return <button type="button" className="plan-list-item" aria-labelledby={titleId} aria-describedby={descriptionIds} onClick={onOpen}>
    <span className="plan-list-copy">
      <span id={titleId} className="plan-list-title">{plan.title}</span>
      <span id={dateAndLocationId} className="plan-list-meta">
        {plan.executionDate ? <span className="plan-list-date">{t('执行日期 ', 'Shoot Date ')}<time dateTime={plan.executionDate}>{plan.executionDate}</time></span> : t('未设执行日期', 'No Shoot Date')}
        {timeAndLocation && ` · ${timeAndLocation}`}
      </span>
      {plan.concept && <span id={excerptId} className="plan-list-excerpt">{plan.concept}</span>}
      <span id={countsId} className="plan-list-meta">{t(
        `${plan.parts.length} 个场景 · ${shots} 个镜头 · ${references.length} 张场景参考`,
        `${plan.parts.length} ${plan.parts.length === 1 ? 'scene' : 'scenes'} · ${shots} ${shots === 1 ? 'shot' : 'shots'} · ${references.length} ${references.length === 1 ? 'scene reference' : 'scene references'}`,
      )}</span>
    </span>
    {previews.length > 0 && <span className="plan-list-previews" aria-hidden="true">
      {previews.map((photo) => <img key={photo.id} src={photo.thumbnailUrl} width={photo.width} height={photo.height}
        alt="" loading="lazy" decoding="async" draggable={false}
        onError={() => setFailedSources((sources) => new Set(sources).add(photo.thumbnailUrl))} />)}
    </span>}
    <ArrowUpRight className="plan-list-arrow" size={18} aria-hidden="true" />
  </button>;
}

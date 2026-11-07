import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Search, X } from 'lucide-react';
import { EmptyState, IconButton, WorkspaceHeader } from '../../components/ui';
import { listBooks } from '../../lib/book-api';
import { listModels } from '../../lib/model-api';
import type { ModelProfile } from '../../lib/model-types';
import { listPlans } from '../../lib/planning-api';
import type { ShootPlan } from '../../lib/planning-types';
import type { Photo } from '../../lib/types';
import { defaultWorkspaceVisibility, isWorkspaceVisible, type WorkspaceVisibility } from '../../lib/workspace-visibility';
import { LibraryWorkspace, type LibraryWorkspaceProps } from '../LibraryWorkspace';
import { comparePlanExecutionDate, errorMessage, planSearchText } from '../planning/plan-content';
import { bookSearchText, findSearchItems, indexSearchItems, modelSearchText, photoSearchText, planMatchLine, searchTerm } from './search-matches';
import './search.css';

const categories = { all: '全部', photos: '照片', books: '画册', models: '模特', planning: '策划' } as const;
type Category = keyof typeof categories;
type RemoteCategory = 'books' | 'models' | 'planning';
const remoteCategories: RemoteCategory[] = ['books', 'models', 'planning'];
type Source<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: T[] };

const PREVIEW_COUNT = 3;
const WIDE_PHOTO_PREVIEW_COUNT = 6;
const WIDE_RESULTS_QUERY = '(min-width: 1050px)'; // Match the two-column breakpoint in search.css.
const readPlans = async () => (await listPlans()).slice().sort(comparePlanExecutionDate);

export interface SearchSession {
  query: string;
  category: Category;
  scrollTop: number;
  focusResult?: string;
}

interface SearchWorkspaceProps extends LibraryWorkspaceProps {
  session: SearchSession;
  workspaceVisibility?: WorkspaceVisibility;
  onOpenBook: (id: string) => void;
  onOpenModel: (model: ModelProfile) => void;
  onOpenPlan: (plan: ShootPlan) => void;
}

function useSearchSource<T>(read: () => Promise<T[]>, enabled: boolean) {
  const [state, setState] = useState<Source<T>>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void read().then((items) => {
      if (active) setState({ status: 'ready', items });
    }).catch((cause: unknown) => {
      if (active) setState({ status: 'error', message: errorMessage(cause) });
    });
    return () => { active = false; };
  }, [read, enabled, revision]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setRevision((value) => value + 1);
  }, []);
  return [state, retry] as const;
}

function useSearchMatches<T>(source: Source<T>, textOf: (item: T) => string, term: string) {
  const index = useMemo(() => source.status === 'ready' ? indexSearchItems(source.items, textOf) : [], [source, textOf]);
  return useMemo(() => findSearchItems(index, term), [index, term]);
}

export function SearchWorkspace({ session, workspaceVisibility = defaultWorkspaceVisibility, onOpenBook, onOpenModel, onOpenPlan, ...library }: SearchWorkspaceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(session.query);
  const [draft, setDraft] = useState(session.query);
  const [wideWindow, setWideWindow] = useState(() => window.matchMedia(WIDE_RESULTS_QUERY).matches);
  const composing = useRef(false);
  const [category, setCategory] = useState(session.category);
  const term = searchTerm(query);
  const [started, setStarted] = useState(!!term);
  const [books, reloadBooks] = useSearchSource(listBooks, started);
  const [models, reloadModels] = useSearchSource(listModels, started && workspaceVisibility.models);
  const [plans, reloadPlans] = useSearchSource(readPlans, started && workspaceVisibility.planning);
  const photoIndex = useMemo(() => started ? indexSearchItems(library.snapshot.photos, photoSearchText) : [], [library.snapshot.photos, started]);
  const photoById = useMemo(() => new Map(library.snapshot.photos.map((photo) => [photo.id, photo])), [library.snapshot.photos]);
  const photoMatches = useMemo(() => findSearchItems(photoIndex, term), [photoIndex, term]);
  const bookMatches = useSearchMatches(books, bookSearchText, term);
  const modelMatches = useSearchMatches(models, modelSearchText, term);
  const planMatches = useSearchMatches(plans, planSearchText, term);
  const sources = { books, models, planning: plans };
  const reload = { books: reloadBooks, models: reloadModels, planning: reloadPlans };
  const enabledRemote = remoteCategories.filter((item) => isWorkspaceVisible(item, workspaceVisibility));
  const searchCategories = ['photos', ...enabledRemote] as const;
  const visibleRemote = enabledRemote.filter((item) => category === 'all' || category === item);
  const matches = { photos: photoMatches, books: bookMatches, models: modelMatches, planning: planMatches };
  const hasRemoteMatches = visibleRemote.some((item) => matches[item].length > 0);
  const mixedResults = category === 'all' && photoMatches.length > 0 && hasRemoteMatches;
  const resultsClass = category === 'photos' ? 'search-results' : mixedResults
    ? 'search-results search-results-column search-results-mixed'
    : 'search-results search-results-column';
  const photoPreviewCount = wideWindow && mixedResults ? WIDE_PHOTO_PREVIEW_COUNT : PREVIEW_COUNT;
  const visibleCount = category === 'all'
    ? Math.min(photoPreviewCount, photoMatches.length) + visibleRemote.reduce((total, item) => total + Math.min(PREVIEW_COUNT, matches[item].length), 0)
    : matches[category].length;
  const hasLoading = visibleRemote.some((item) => sources[item].status === 'loading');
  const hasFailure = visibleRemote.some((item) => sources[item].status === 'error');
  const wallKey = `${category}:${category === 'all' ? photoPreviewCount : ''}:${term}`;
  const [readyWall, setReadyWall] = useState<string>();
  const wallReady = !photoMatches.length || (category !== 'all' && category !== 'photos') || readyWall === wallKey;
  const onWallReady = useCallback(() => setReadyWall(wallKey), [wallKey]);

  const restoring = useRef<{ scrollTop: number; focusResult?: string } | null>({ scrollTop: session.scrollTop, focusResult: session.focusResult });
  const savedFocus = restoring.current?.focusResult;
  const focusType = savedFocus?.split(':', 1)[0];
  const focusSourceIndex = visibleRemote.findIndex((item) => item === focusType);
  // A restored photo from the second preview row needs a related result to appear first.
  const waitingForSecondRow = category === 'all' && wideWindow && !hasRemoteMatches && hasLoading
    && photoMatches.slice(PREVIEW_COUNT, WIDE_PHOTO_PREVIEW_COUNT).some((photo) => savedFocus === `photos:${photo.id}`);
  const waitingForRestore = waitingForSecondRow || (category === 'all' && focusType
    ? visibleRemote.slice(0, focusSourceIndex + 1).some((item) => sources[item].status === 'loading')
    : hasLoading);
  const givingInitialFocus = useRef(false);
  useEffect(() => {
    const media = window.matchMedia(WIDE_RESULTS_QUERY);
    const update = () => {
      const active = document.activeElement?.closest<HTMLElement>('.search-photo-preview [data-photo-index]');
      if (!media.matches && active && Number(active.dataset.photoIndex) >= PREVIEW_COUNT) {
        rootRef.current?.querySelector<HTMLButtonElement>('[aria-label="查看全部照片"]')?.focus();
      }
      setWideWindow(media.matches);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    givingInitialFocus.current = true;
    inputRef.current?.focus({ preventScroll: true });
    givingInitialFocus.current = false;
  }, []);
  useLayoutEffect(() => {
    const main = rootRef.current?.closest('main');
    if (!main) return;
    const remember = () => { if (!restoring.current) session.scrollTop = main.scrollTop; };
    main.addEventListener('scroll', remember, { passive: true });
    return () => main.removeEventListener('scroll', remember);
  }, [session]);

  useLayoutEffect(() => {
    const saved = restoring.current;
    const root = rootRef.current;
    if (!saved || !root) return;
    if (!saved.focusResult && !saved.scrollTop) {
      restoring.current = null;
      return;
    }
    if (waitingForRestore || !wallReady) return;
    const main = root.closest('main');
    if (hasLoading && main && saved.scrollTop > main.scrollHeight - main.clientHeight) return;
    if (main) main.scrollTop = saved.scrollTop;
    const finish = () => {
      if (restoring.current !== saved) return;
      const target = resultControl(root, saved.focusResult);
      restoring.current = null;
      if (main && saved.focusResult && !target) main.scrollTop = 0;
      (target ?? inputRef.current)?.focus({ preventScroll: true });
      if (main && target) {
        const viewport = main.getBoundingClientRect();
        const row = target.getBoundingClientRect();
        if (row.top < viewport.top || row.bottom > viewport.bottom) target.scrollIntoView({ block: 'nearest' });
      }
      session.scrollTop = main?.scrollTop ?? 0;
      if (!target) session.focusResult = undefined;
    };
    if (!saved.focusResult?.startsWith('photos:') || resultControl(root, saved.focusResult)) {
      finish();
      return;
    }
    // The virtual wall mounts the restored window on its next scroll frame.
    let secondFrame: number | undefined;
    const frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(finish); });
    return () => {
      cancelAnimationFrame(frame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
  }, [session, hasLoading, waitingForRestore, wallReady, visibleCount]);

  function cancelRestore() {
    if (!restoring.current) return;
    restoring.current = null;
    session.focusResult = undefined;
    session.scrollTop = rootRef.current?.closest('main')?.scrollTop ?? 0;
  }
  function resetPosition() {
    restoring.current = null;
    session.scrollTop = 0;
    session.focusResult = undefined;
    const main = rootRef.current?.closest('main');
    if (main) main.scrollTop = 0;
  }
  function changeQuery(next: string) {
    const nextTerm = searchTerm(next);
    if (nextTerm !== term) resetPosition();
    session.query = next;
    setDraft(next);
    setQuery(next);
    if (nextTerm) setStarted(true);
    else {
      session.category = 'all';
      setCategory('all');
    }
  }
  function chooseCategory(next: Category) {
    if (next !== category) resetPosition();
    session.category = next;
    setCategory(next);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-search-category="${next}"]`)?.focus({ preventScroll: true });
  }
  function openResult(key: string, open: () => void) {
    restoring.current = null;
    session.focusResult = key;
    session.scrollTop = rootRef.current?.closest('main')?.scrollTop ?? 0;
    open();
  }

  function photoResults(preview: boolean) {
    return <LibraryWorkspace {...library} space="search" searchResults={{
      term, photos: photoMatches, previewCount: preview ? photoPreviewCount : undefined, onLayoutReady: onWallReady, onBooksChange: reloadBooks,
    }} />;
  }
  function resultRows(item: RemoteCategory) {
    const limit = category === 'all' ? PREVIEW_COUNT : undefined;
    if (item === 'books') return bookMatches.slice(0, limit).map((book) =>
      <ResultRow key={book.id} resultKey={`books:${book.id}`} title={book.title} withCover cover={photoById.get(book.coverPhotoId ?? '')}
        onOpen={openResult} open={() => onOpenBook(book.id)} />);
    if (item === 'models') return modelMatches.slice(0, limit).map((model) =>
      <ResultRow key={model.id} resultKey={`models:${model.id}`} title={model.name} detail={model.city || undefined} withCover cover={photoById.get(model.coverPhotoId ?? '')}
        onOpen={openResult} open={() => onOpenModel(model)} />);
    return planMatches.slice(0, limit).map((plan) =>
      <ResultRow key={plan.id} resultKey={`planning:${plan.id}`} title={plan.title} detail={planMatchLine(plan, term)}
        onOpen={openResult} open={() => onOpenPlan(plan)} />);
  }

  return <section ref={rootRef} className="global-search" aria-label="全局搜索" onWheelCapture={cancelRestore} onPointerDownCapture={cancelRestore} onKeyDownCapture={cancelRestore}
    onFocusCapture={(event) => {
      if (givingInitialFocus.current) return;
      cancelRestore();
      const target = event.target as HTMLElement;
      const photoId = target.closest<HTMLElement>('[data-photo-id]')?.dataset.photoId;
      session.focusResult = target.dataset.searchResult ?? (photoId ? `photos:${photoId}` : undefined);
    }}>
    <div className="search-controls">
      <WorkspaceHeader title="搜索" />
      <div className="search-field" role="search">
        <Search size={19} aria-hidden="true" />
        <input id="global-search-input" ref={inputRef} aria-label="全局搜索" placeholder={`搜索${searchCategories.map((item) => categories[item]).join('、')}`}
          value={draft}
          onChange={(event) => { if (composing.current) setDraft(event.target.value); else changeQuery(event.target.value); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(event) => { composing.current = false; changeQuery(event.currentTarget.value); }} />
        {draft && <IconButton label="清空搜索" onClick={() => { changeQuery(''); inputRef.current?.focus({ preventScroll: true }); }}><X size={16} /></IconButton>}
      </div>
      {term && <div className="segmented search-categories" role="group" aria-label="结果类别">
        {(['all', ...searchCategories] as const).map((item) => <button key={item} type="button" className={category === item ? 'active' : ''}
          data-search-category={item} aria-pressed={category === item} onClick={() => chooseCategory(item)}>{categories[item]}</button>)}
      </div>}
    </div>
    {term && <div className={resultsClass}>
      {!!photoMatches.length && (category === 'all' ? <ResultGroup name="照片" count={photoMatches.length} onViewAll={() => chooseCategory('photos')}>
        {photoResults(true)}
      </ResultGroup> : category === 'photos' && photoResults(false))}
      {(hasRemoteMatches || hasLoading || hasFailure) && <div className="search-related-results">
        {visibleRemote.map((item) => !!matches[item].length && <ResultGroup key={item} name={categories[item]} count={matches[item].length}
          onViewAll={category === 'all' && matches[item].length > PREVIEW_COUNT ? () => chooseCategory(item) : undefined}>
          <ul className="search-result-list">{resultRows(item)}</ul>
        </ResultGroup>)}
        {(hasLoading || hasFailure) && <div className="search-source-states">
          {hasLoading && <p className="search-loading" role="status">正在读取{visibleRemote.filter((item) => sources[item].status === 'loading').map((item) => categories[item]).join('、')}…</p>}
          {visibleRemote.map((item) => {
            const source = sources[item];
            return source.status === 'error' && <div className="search-source-error" key={item}>
              <p className="form-error" role="alert">无法读取{categories[item]}：{source.message}</p>
              <button className="button" type="button" aria-label={`重新读取${categories[item]}`} onClick={() => { chooseCategory(category); reload[item](); }}>重试</button>
            </div>;
          })}
        </div>}
      </div>}
      {!visibleCount && !hasLoading && !hasFailure && <div role="status"><EmptyState title={category === 'all' ? '没有匹配结果' : `没有匹配的${categories[category]}`} /></div>}
    </div>}
  </section>;
}

function resultControl(root: HTMLElement, key?: string) {
  if (!key) return undefined;
  if (key.startsWith('photos:')) return root.querySelector<HTMLButtonElement>(`[data-photo-id="${CSS.escape(key.slice(7))}"] .photo-interaction-target`);
  return root.querySelector<HTMLButtonElement>(`[data-search-result="${CSS.escape(key)}"]`);
}

function ResultGroup({ name, count, onViewAll, children }: { name: string; count: number; onViewAll?: () => void; children: ReactNode }) {
  return <section className="search-group" aria-label={name}>
    <div className="search-group-heading">
      <h2>{name} <span className="photo-count">{count}</span></h2>
      {onViewAll && <button type="button" className="text-button" aria-label={`查看全部${name}`} onClick={onViewAll}>查看全部<ArrowRight size={14} aria-hidden="true" /></button>}
    </div>
    {children}
  </section>;
}

function ResultRow({ resultKey, title, detail, withCover, cover, onOpen, open }: {
  resultKey: string; title: string; detail?: string; withCover?: boolean; cover?: Photo; onOpen: (key: string, open: () => void) => void; open: () => void;
}) {
  return <li><button type="button" className={`search-result-row${withCover ? ' search-result-with-cover' : ''}`} data-search-result={resultKey} onClick={() => onOpen(resultKey, open)}>
    {withCover && <ResultCover photo={cover} />}
    <span className="search-result-copy"><span className="search-result-title" title={title}>{title}</span>
      {detail && <span className="search-result-detail" title={detail}>{detail}</span>}
    </span>
    <ArrowUpRight size={15} aria-hidden="true" />
  </button></li>;
}

function ResultCover({ photo }: { photo?: Photo }) {
  const source = photo?.originalAvailable && photo.thumbnailAvailable ? photo.thumbnailUrl : undefined;
  const [failed, setFailed] = useState<string>();
  return <span className="search-result-cover" aria-hidden="true">
    {source && failed !== source && <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailed(source)} />}
  </span>;
}

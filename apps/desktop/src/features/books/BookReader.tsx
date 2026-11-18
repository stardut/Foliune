import { t } from '../../lib/i18n';
import { presentModal } from '../../lib/modal-stack';
import { revealContent } from '../../lib/content-reveal';
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { IconButton } from '../../components/ui';
import { DropdownSelect } from '../../components/DropdownSelect';
import type { BookVersion } from '../../lib/book-types';
import type { Photo } from '../../lib/types';
import { BookPageView } from './BookPageView';

export function BookReader({ version, photos, title, initialPageIndex, onClose, onRelink }: {
  version: BookVersion; photos: Photo[]; title: string; initialPageIndex: number; onClose: () => void; onRelink?: (photo: Photo) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [page, setPage] = useState(initialPageIndex);
  const [spread, setSpread] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 761px)').matches);
  const total = version.pages.length;
  const step = spread ? 2 : 1;
  // Preserve the page of interest, including a chapter starting on the right
  // side of a spread, when switching between single and double pages.
  const currentPage = Math.max(0, Math.min(page, total - 1));
  const first = Math.floor(currentPage / step) * step;
  const last = Math.max(0, Math.floor((total - 1) / step) * step);
  const visiblePages = version.pages.slice(first, first + step);
  const chapters = version.chapters.filter((chapter) => version.pages.some((entry) => entry.chapterId === chapter.id));
  const currentChapter = version.pages[currentPage]?.chapterId || '';
  function move(direction: number) {
    const next = first + direction * step;
    if (next >= 0 && next <= last) setPage(next);
  }

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    const dismissModal = presentModal(element);
    stage.current?.focus({ preventScroll: true });
    const cancelReveal = revealContent([element]);
    return () => {
      dismissModal();
      cancelReveal();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className="book-reader" aria-labelledby={titleId}
    onCancel={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !total || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && (target.isContentEditable || target.matches('[role="combobox"]')))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setPage(event.key === 'Home' ? 0 : total - 1); }
    }}>
    <header className="book-reader-header">
      <div className="book-reader-title"><h2 id={titleId}>{title}</h2></div>
      <div className="book-reader-options">
        <DropdownSelect label={t('跳转章节', 'Jump to Chapter')} disabled={!chapters.length} value={currentChapter} onChange={(chapterId) => {
          const index = version.pages.findIndex((entry) => entry.chapterId === chapterId);
          if (index >= 0) setPage(index);
        }} options={chapters.length ? chapters.map((chapter) => ({ value: chapter.id, label: chapter.title || t('未命名章节', 'Untitled Chapter') })) : [{ value: '', label: t('暂无章节', 'No Chapters') }]} />
        <div className="segmented book-reader-mode" role="group" aria-label={t('阅读页模式', 'Page View')}>
          <button type="button" disabled={!total} className={!spread ? 'active' : ''} aria-pressed={!spread} onClick={() => setSpread(false)}>{t('单页', 'Single Page')}</button>
          <button type="button" disabled={!total} className={spread ? 'active' : ''} aria-pressed={spread} onClick={() => setSpread(true)}>{t('双页', 'Two Pages')}</button>
        </div>
      </div>
      <IconButton label={t('关闭阅读', 'Close Reader')} onClick={onClose}><X size={18} /></IconButton>
    </header>
    <div ref={stage} className="book-reader-stage" tabIndex={-1} role="group" aria-label={t('阅读页面', 'Reader')}>
      <div className="book-reader-viewport" style={{ '--book-page-ratio': version.pageWidth / version.pageHeight, '--book-reader-columns': step, '--book-reader-gap': spread ? '12px' : '0px' } as CSSProperties}>
        {total ? <div className="book-reader-pages" aria-label={spread ? t('双页阅读', 'Two-Page View') : t('单页阅读', 'Single-Page View')}>
          {visiblePages.map((entry, index) => <BookPageView key={entry.id} page={entry} pageWidth={version.pageWidth} pageHeight={version.pageHeight} photos={photos} number={first + index + 1} onRelink={onRelink} />)}
          {spread && visiblePages.length === 1 && <div className="book-reader-empty-page" aria-hidden="true" />}
        </div> : <div className="book-reader-empty" role="status"><h3>{t('这本画册还没有页面', 'This Book Has No Pages')}</h3><p>{t('返回编辑，为画册添加照片后再来阅读。', 'Return to the editor to add photos.')}</p></div>}
      </div>
    </div>
    <footer className="book-reader-footer">
      <nav className="book-reader-pagination" aria-label={t('阅读翻页', 'Page Navigation')}>
        <IconButton label={spread ? t('上一跨页', 'Previous Spread') : t('上一页', 'Previous Page')} disabled={!total || first === 0} onClick={() => move(-1)}><ChevronLeft size={19} /></IconButton>
        <span className="book-reader-counter" role="status" aria-live="polite" aria-atomic="true">{total ? `${first + 1}${visiblePages.length > 1 ? `–${first + visiblePages.length}` : ''}` : '0'}<span> / {total}</span></span>
        <IconButton label={spread ? t('下一跨页', 'Next Spread') : t('下一页', 'Next Page')} disabled={!total || first >= last} onClick={() => move(1)}><ChevronRight size={19} /></IconButton>
      </nav>
    </footer>
  </dialog>;
}

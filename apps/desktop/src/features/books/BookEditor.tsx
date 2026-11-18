import { t } from '../../lib/i18n';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { useToast } from '../../components/ToastProvider';
import { DropdownSelect } from '../../components/DropdownSelect';
import { Modal } from '../../components/ui';
import * as api from '../../lib/book-api';
import { versionInput, type BookDetail, type BookItem, type VersionInput } from '../../lib/book-types';
import { revealContent } from '../../lib/content-reveal';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { PhotoSourceDialog } from '../../components/PhotoSourceDialog';
import { BookPageView } from './BookPageView';
import { BookReader } from './BookReader';

type Inspector = 'photo' | 'page' | 'book';
function organize(input: VersionInput): VersionInput {
  const pages = input.chapters.flatMap((chapter) => input.pages.filter((page) => page.chapterId === chapter.id));
  return { ...input, pages, chapters: input.chapters.map((chapter) => ({ ...chapter, photoIds: pages.filter((page) => page.chapterId === chapter.id).flatMap((page) => page.items.map((item) => item.photoId)) })) };
}
export function BookEditor({ detail, snapshot, photos, onSnapshot, onChange, onBack, onPlay, onDirtyChange, onBusyChange, onRelink, fromSearch = false }: {
  detail: BookDetail; snapshot: LibrarySnapshot; photos: Photo[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onChange: (next: BookDetail) => void; onBack: () => void;
  onPlay?: (photoIds: string[]) => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; onRelink?: (photo: Photo) => Promise<void>; fromSearch?: boolean;
}) {
  const version = detail.versions.find((v) => v.id === detail.book.currentVersionId)!;
  const [draft, setDraft] = useState<VersionInput>(() => versionInput(version));
  const [pageIndex, setPageIndex] = useState(0); const [itemIndex, setItemIndex] = useState(0);
  const [inspector, setInspector] = useState<Inspector>('photo'); const [more, setMore] = useState(false);
  const [dirty, setDirty] = useState(false); const [working, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const busy = working || sourceBusy;
  const toast = useToast();
  const [reading, setReading] = useState(false); const [leaving, setLeaving] = useState(false);
  const [pickingSource, setPickingSource] = useState(false);
  const busyRef = useRef(false);
  const editorHeading = useRef<HTMLElement>(null);
  const editorLayout = useRef<HTMLDivElement>(null);
  const wasReading = useRef(false);
  useLayoutEffect(() => {
    const returning = wasReading.current && !reading;
    wasReading.current = reading;
    if (returning) return revealContent([editorHeading.current, editorLayout.current].filter((element) => element !== null));
  }, [reading]);
  useEffect(() => { setDraft(versionInput(version)); setDirty(false); setPageIndex(0); setItemIndex(0); setPickingSource(false); }, [version]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const currentPageIndex = Math.min(pageIndex, draft.pages.length - 1);
  const page = draft.pages[currentPageIndex]; const currentItemIndex = Math.min(itemIndex, page.items.length - 1); const item = page.items[currentItemIndex];
  const currentPhoto = photos.find((photo) => photo.id === item?.photoId);
  const currentChapter = draft.chapters.find((chapter) => chapter.id === page.chapterId);
  const used = draft.pages.flatMap((p) => p.items.map((i) => i.photoId));
  const available = photos.filter((p) => !used.includes(p.id));
  function change(next: VersionInput) { setDraft(organize(next)); setDirty(true); }
  function changePage(patch: Partial<typeof page>) { change({ ...draft, pages: draft.pages.map((p) => p.id === page.id ? { ...p, ...patch } : p) }); }
  function changeItem(patch: Partial<BookItem>) { changePage({ items: page.items.map((i, index) => index === currentItemIndex ? { ...i, ...patch } : i) }); }
  function selectPage(index: number) { setPageIndex(index); setItemIndex(0); }
  function movePage(offset: number) {
    const next = [...draft.pages]; [next[currentPageIndex], next[currentPageIndex + offset]] = [next[currentPageIndex + offset], next[currentPageIndex]];
    change({ ...draft, pages: next }); setPageIndex(currentPageIndex + offset);
  }
  function moveChapter(index: number, offset: number) {
    const chapters = [...draft.chapters]; [chapters[index], chapters[index + offset]] = [chapters[index + offset], chapters[index]]; change({ ...draft, chapters }); selectPage(0);
  }
  async function perform(task: () => Promise<void>) {
    if (busyRef.current || sourceBusy) return;
    busyRef.current = true; setBusy(true);
    try { await task(); } catch (cause) { toast({ title: cause instanceof Error ? cause.message : String(cause), status: 'error' }); } finally { busyRef.current = false; setBusy(false); }
  }
  async function save() { const next = await api.saveVersion(detail.book.id, version.id, draft); onChange(next); toast({ title: t('已保存', 'Saved') }); }
  function addPhotos(photoIds: string[]) {
    const ids = [...new Set(photoIds)].filter((id) => !used.includes(id));
    if (!ids.length) return;
    const pages = ids.map((photoId) => ({ id: crypto.randomUUID(), chapterId: page.chapterId, title: '', caption: '', items: [{ photoId, x: 10, y: 8, width: 80, height: 77, cropX: 50, cropY: 50, fit: 'contain' as const }] }));
    const next = organize({ ...draft, pages: [...draft.pages, ...pages] });
    change(next); selectPage(next.pages.findIndex((p) => p.id === pages[0].id)); setInspector('photo');
  }
  return <section className="book-editor">
    <header ref={editorHeading} className="book-editor-heading">
      <button type="button" className="back-link" disabled={busy} onClick={() => dirty ? setLeaving(true) : onBack()}><ChevronLeft size={15} />{fromSearch ? t('返回搜索', 'Back to Search') : t('书架', 'Bookshelf')}</button>
      <div className="book-editor-title"><h1>{detail.book.title}</h1><p>{t(`${draft.pages.length} 页`, `${draft.pages.length} ${draft.pages.length === 1 ? 'page' : 'pages'}`)}<span className={dirty ? 'book-unsaved' : ''}>{dirty ? t('未保存修改', 'Unsaved Changes') : t('已保存', 'Saved')}</span></p></div>
      <div className="book-editor-primary"><button type="button" className="button button-quiet" disabled={busy} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setReading(true); }}>{dirty ? t('预览', 'Preview') : t('阅读', 'Read')}</button><button type="button" className="button button-primary" disabled={busy || !dirty} onClick={() => void perform(save)}>{busy ? t('处理中…', 'Working…') : t('保存', 'Save')}</button><button type="button" className="button button-quiet book-more-button" aria-label={t('更多画册操作', 'More Book Actions')} aria-expanded={more} aria-controls="book-secondary-tools" disabled={busy} onClick={() => setMore(!more)}><MoreHorizontal size={19} /></button></div>
    </header>
    {more && <div className="book-secondary-tools" id="book-secondary-tools">{onPlay && <button type="button" className="button button-quiet" disabled={busy || dirty} onClick={() => onPlay(version.pages.flatMap((p) => p.items.map((entry) => entry.photoId)))}>{t('播放画册', 'Play Photo Book')}</button>}<button type="button" className="button button-quiet" disabled={busy || dirty} onClick={() => void perform(async () => { const path = await api.exportBook(detail, version.id); if (path) toast({ title: t(`已导出自包含 HTML：${path}`, `Exported self-contained HTML to ${path}`) }); })}>{t('导出 HTML', 'Export HTML')}</button>{dirty && <span>{t('保存后可播放和导出', 'Save to play or export')}</span>}</div>}
    <div ref={editorLayout} className="book-edit-layout">
      <nav className="book-page-list" aria-label={t('画册页面', 'Book Pages')}><h3>{t('页面', 'Pages')} <span>{draft.pages.length}</span></h3>{draft.pages.map((p, index) => { const photo = photos.find((entry) => entry.id === p.items[0]?.photoId); return <button type="button" key={p.id} className={index === currentPageIndex ? 'active' : ''} aria-current={index === currentPageIndex ? 'page' : undefined} onClick={() => selectPage(index)}><span className="book-page-thumb">{photo?.thumbnailAvailable ? <img src={photo.thumbnailUrl} alt="" loading="lazy" /> : <span>{t('无预览', 'No Preview')}</span>}</span><span className="book-page-list-label"><span>{String(index + 1).padStart(2, '0')}</span><span>{p.title || photo?.title || t('照片页', 'Photo Page')}</span></span></button>; })}</nav>
      <section className="book-edit-preview" aria-label={t('当前画册页面', 'Current Book Page')}><div className="book-canvas-heading"><span>{currentChapter?.title || t('未命名章节', 'Untitled Chapter')}</span><div><button type="button" className="button button-quiet" aria-label={t('上一页', 'Previous Page')} disabled={!currentPageIndex} onClick={() => selectPage(currentPageIndex - 1)}><ChevronLeft size={15} /></button><span>{currentPageIndex + 1} / {draft.pages.length}</span><button type="button" className="button button-quiet" aria-label={t('下一页', 'Next Page')} disabled={currentPageIndex === draft.pages.length - 1} onClick={() => selectPage(currentPageIndex + 1)}><ChevronRight size={15} /></button></div></div>
        <div className="book-preview-stage" style={{ '--book-page-ratio': draft.pageWidth / draft.pageHeight } as CSSProperties}><BookPageView page={page} pageWidth={draft.pageWidth} pageHeight={draft.pageHeight} photos={photos} number={currentPageIndex + 1} selectedItem={inspector === 'photo' ? currentItemIndex : undefined} onSelectItem={(index) => { setItemIndex(index); setInspector('photo'); }} onRelink={onRelink} /></div>
        <div className="book-canvas-footer"><span>{draft.pageWidth} × {draft.pageHeight}</span><button type="button" className="text-button" onClick={() => setInspector('page')}>{t('编辑页面文字与顺序', 'Edit Text and Order')}</button></div>
      </section>
      <aside className="book-inspector" aria-label={t('编辑属性', 'Inspector')}><nav className="book-inspector-tabs" aria-label={t('属性类别', 'Inspector Tabs')}>{([['photo', t('照片', 'Photo')], ['page', t('页面', 'Page')], ['book', t('画册', 'Book')]] as const).map(([value, label]) => <button key={value} type="button" className={inspector === value ? 'active' : ''} aria-pressed={inspector === value} onClick={() => setInspector(value)}>{label}</button>)}</nav>
        <div className="book-inspector-scroll"><fieldset disabled={busy} aria-label={t(`${inspector === 'photo' ? '照片' : inspector === 'page' ? '页面' : '画册'}属性`, `${inspector === 'photo' ? 'Photo' : inspector === 'page' ? 'Page' : 'Book'} Properties`)}>
          {inspector === 'photo' && item && <>
            <div className="book-inspector-context"><span>{t(`第 ${currentPageIndex + 1} 页 · 照片 ${currentItemIndex + 1}`, `Page ${currentPageIndex + 1} · Photo ${currentItemIndex + 1}`)}</span><h3>{currentPhoto?.title || t('照片不可用', 'Photo unavailable')}</h3></div>
            {page.items.length > 1 && <div className="book-item-choices">{page.items.map((entry, index) => { const photo = photos.find((p) => p.id === entry.photoId); return <button key={index} type="button" className={index === currentItemIndex ? 'active' : ''} aria-label={t(`选择照片 ${index + 1} ${photo?.title || ''}`, `Select photo ${index + 1} ${photo?.title || ''}`)} aria-pressed={index === currentItemIndex} onClick={() => setItemIndex(index)}>{photo?.thumbnailAvailable ? <img src={photo.thumbnailUrl} alt="" /> : <span>{t(`照片 ${index + 1}`, `Photo ${index + 1}`)}</span>}</button>; })}</div>}
            <DropdownSelect label={t('替换选片', 'Replace Photo')} field value={item.photoId} disabled={busy} onChange={(photoId) => changeItem({ photoId })}
              options={photos.filter((photo) => photo.id === item.photoId || !used.includes(photo.id)).map((photo) => ({
                value: photo.id, label: t(`${photo.library === 'work' ? '作品' : '收藏'} · ${photo.title}`, `${photo.library === 'work' ? 'Work' : 'Collection'} · ${photo.title}`),
              }))} />
            <DropdownSelect label={t('适配方式', 'Fit')} field value={item.fit} disabled={busy} onChange={(fit) => changeItem({ fit })}
              options={[{ value: 'contain', label: t('完整展示', 'Fit Entire Photo') }, { value: 'cover', label: t('裁切填满', 'Crop to Fill') }]} />
            {item.fit === 'cover' && <div className="book-crop-controls"><label>{t('水平裁切 ', 'Horizontal Crop ')}<span>{item.cropX}%</span><input type="range" min={0} max={100} value={item.cropX} onChange={(e) => changeItem({ cropX: Number(e.target.value) })} /></label><label>{t('垂直裁切 ', 'Vertical Crop ')}<span>{item.cropY}%</span><input type="range" min={0} max={100} value={item.cropY} onChange={(e) => changeItem({ cropY: Number(e.target.value) })} /></label></div>}
            <details className="book-details"><summary>{t('位置与尺寸', 'Position and Size')}</summary><div className="book-number-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{({ x: t('左边距 %', 'Left %'), y: t('上边距 %', 'Top %'), width: t('宽 %', 'Width %'), height: t('高 %', 'Height %') })[key]}<input type="number" step={1} min={key === 'x' || key === 'y' ? 0 : 1} max={100} value={item[key]} onChange={(e) => changeItem({ [key]: Number(e.target.value) })} /></label>)}</div></details>
            {page.items.length === 2 && <button type="button" className="button" onClick={() => changePage({ items: page.items.map((current, index) => ({ ...current, photoId: page.items[1 - index].photoId, cropX: page.items[1 - index].cropX, cropY: page.items[1 - index].cropY })) })}>{t('交换双图', 'Swap Photos')}</button>}
          </>}
          {inspector === 'page' && <>
            <div className="book-inspector-context"><span>{t('页面属性', 'Page Properties')}</span><h3>{t(`第 ${currentPageIndex + 1} 页`, `Page ${currentPageIndex + 1}`)}</h3></div>
            <DropdownSelect label={t('所属章节', 'Chapter')} field value={page.chapterId} disabled={busy}
              options={draft.chapters.map((chapter) => ({ value: chapter.id, label: chapter.title || t('未命名章节', 'Untitled Chapter') }))}
              onChange={(chapterId) => {
                const id = page.id;
                const next = organize({ ...draft, pages: draft.pages.map((p) => p.id === id ? { ...p, chapterId } : p) });
                change(next);
                selectPage(next.pages.findIndex((p) => p.id === id));
              }} />
            <label>{t('页标题', 'Page Title')}<input value={page.title} maxLength={200} onChange={(e) => changePage({ title: e.target.value })} /></label><label>{t('页说明', 'Caption')}<textarea rows={4} value={page.caption} maxLength={5000} onChange={(e) => changePage({ caption: e.target.value })} /></label>
            <div className="book-inspector-section"><h3>{t('同章顺序', 'Page Order')}</h3><div className="book-page-actions"><button type="button" className="button" disabled={currentPageIndex === 0 || draft.pages[currentPageIndex - 1]?.chapterId !== page.chapterId} onClick={() => movePage(-1)}>{t('前移一页', 'Move Earlier')}</button><button type="button" className="button" disabled={currentPageIndex === draft.pages.length - 1 || draft.pages[currentPageIndex + 1]?.chapterId !== page.chapterId} onClick={() => movePage(1)}>{t('后移一页', 'Move Later')}</button></div></div>
            <button type="button" className="button button-quiet button-danger" disabled={draft.pages.length <= 1} onClick={() => { change({ ...draft, pages: draft.pages.filter((p) => p.id !== page.id) }); selectPage(Math.max(0, currentPageIndex - 1)); }}>{t('移除此页', 'Remove Page')}</button>
          </>}
          {inspector === 'book' && <>
            <div className="book-inspector-context"><h3>{t('画册设置', 'Book Settings')}</h3></div>
            <details className="book-details"><summary>{t('纸张尺寸 ', 'Page Size ')}<span>{draft.pageWidth} × {draft.pageHeight}</span></summary><div className="book-number-grid"><label>{t('页宽', 'Page Width')}<input type="number" min={400} max={4000} value={draft.pageWidth} onChange={(e) => change({ ...draft, pageWidth: Number(e.target.value) })} /></label><label>{t('页高', 'Page Height')}<input type="number" min={400} max={4000} value={draft.pageHeight} onChange={(e) => change({ ...draft, pageHeight: Number(e.target.value) })} /></label></div></details>
            <section className="book-inspector-section"><h3>{t('章节与选片', 'Chapters and Photos')}</h3>{draft.chapters.map((c, index) => <div className="book-order-row" key={c.id}><input aria-label={t(`章节 ${index + 1}`, `Chapter ${index + 1}`)} value={c.title} maxLength={200} onChange={(e) => { const first = draft.pages.find((p) => p.chapterId === c.id)?.id; change({ ...draft, chapters: draft.chapters.map((chapter) => chapter.id === c.id ? { ...chapter, title: e.target.value } : chapter), pages: draft.pages.map((p) => p.id === first ? { ...p, title: e.target.value } : p) }); }} /><span>{c.photoIds.length}</span><button type="button" aria-label={t('前移章节', 'Move Chapter Earlier')} disabled={!index} onClick={() => moveChapter(index, -1)}>↑</button><button type="button" aria-label={t('后移章节', 'Move Chapter Later')} disabled={index === draft.chapters.length - 1} onClick={() => moveChapter(index, 1)}>↓</button><button type="button" aria-label={t('删除空章节', 'Delete Empty Chapter')} disabled={draft.chapters.length === 1 || c.photoIds.length > 0} onClick={() => change({ ...draft, chapters: draft.chapters.filter((chapter) => chapter.id !== c.id) })}>×</button></div>)}<button type="button" className="button button-quiet" onClick={() => change({ ...draft, chapters: [...draft.chapters, { id: crypto.randomUUID(), title: t('新章节', 'New Chapter'), photoIds: [] }] })}><Plus size={14} />{t('添加章节', 'Add Chapter')}</button>
              <div className="book-add-photo"><button type="button" className="button" onClick={() => setPickingSource(true)}><Plus size={14} />{currentChapter?.title ? t(`添加照片到「${currentChapter.title}」`, `Add Photos to “${currentChapter.title}”`) : t('添加照片到「当前章」', 'Add Photos to Chapter')}</button></div>
            </section>
          </>}
        </fieldset></div>

      </aside>
    </div>
    {pickingSource && <PhotoSourceDialog snapshot={{ ...snapshot, photos: available }} library="collection" title={t('添加画册照片', 'Add Photos to Book')} onBusyChange={setSourceBusy} onClose={() => setPickingSource(false)} onConfirm={({ photoIds, snapshot }) => { if (snapshot) onSnapshot(snapshot); addPhotos(photoIds); setPickingSource(false); }} />}
    {reading && <BookReader version={{ ...version, ...draft }} photos={photos} title={t(`${detail.book.title}${dirty ? ' · 未保存预览' : ''}`, `${detail.book.title}${dirty ? ' · Unsaved Preview' : ''}`)} initialPageIndex={currentPageIndex} onClose={() => setReading(false)} onRelink={onRelink} />}
    {leaving && <Modal title={t('离开编辑？', 'Leave the Editor?')} onClose={() => setLeaving(false)}><p>{fromSearch ? t('当前修改尚未保存。返回搜索会放弃这些修改。', 'Going back to search discards unsaved changes.') : t('当前修改尚未保存。返回书架会放弃这些修改。', 'Going back to the bookshelf discards unsaved changes.')}</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setLeaving(false)}>{t('继续编辑', 'Keep Editing')}</button><button type="button" className="button" onClick={onBack}>{t('放弃并返回', 'Discard and Go Back')}</button></div></Modal>}
  </section>;
}

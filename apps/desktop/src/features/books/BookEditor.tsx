import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { useToast } from '../../components/ToastProvider';
import { Modal } from '../../components/ui';
import * as api from '../../lib/book-api';
import { templates, versionInput, type BookDetail, type BookItem, type BookTemplate, type VersionInput } from '../../lib/book-types';
import type { Photo } from '../../lib/types';
import { BookPageView } from './BookPageView';
import { BookReader } from './BookReader';

type Inspector = 'photo' | 'page' | 'book';
function organize(input: VersionInput): VersionInput {
  const pages = input.chapters.flatMap((chapter) => input.pages.filter((page) => page.chapterId === chapter.id));
  return { ...input, pages, chapters: input.chapters.map((chapter) => ({ ...chapter, photoIds: pages.filter((page) => page.chapterId === chapter.id).flatMap((page) => page.items.map((item) => item.photoId)) })) };
}
export function BookEditor({ detail, photos, onChange, onBack, onPlay, onDirtyChange, onRelink }: { detail: BookDetail; photos: Photo[]; onChange: (next: BookDetail) => void; onBack: () => void; onPlay?: (photoIds: string[]) => void; onDirtyChange?: (dirty: boolean) => void; onRelink?: (photo: Photo) => Promise<void> }) {
  const version = detail.versions.find((v) => v.id === detail.book.currentVersionId)!;
  const [draft, setDraft] = useState<VersionInput>(() => versionInput(version));
  const [pageIndex, setPageIndex] = useState(0); const [itemIndex, setItemIndex] = useState(0);
  const [inspector, setInspector] = useState<Inspector>('photo'); const [more, setMore] = useState(false);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [reading, setReading] = useState(false); const [leaving, setLeaving] = useState(false); const [style, setStyle] = useState<BookTemplate>(version.template);
  const [addingPhoto, setAddingPhoto] = useState('');
  useEffect(() => { setDraft(versionInput(version)); setDirty(false); setStyle(version.template); setPageIndex(0); setItemIndex(0); setAddingPhoto(''); }, [version]);
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
    setBusy(true);
    try { await task(); } catch (cause) { toast({ title: cause instanceof Error ? cause.message : String(cause), status: 'error' }); } finally { setBusy(false); }
  }
  async function save() { const next = await api.saveVersion(detail.book.id, version.id, draft); onChange(next); toast({ title: '手工版本已保存' }); return next; }
  function addPhoto() {
    if (!addingPhoto) return;
    const photoItem: BookItem = { photoId: addingPhoto, x: 10, y: 8, width: 80, height: 77, cropX: 50, cropY: 50, fit: 'contain' };
    const id = crypto.randomUUID();
    const next = organize({ ...draft, pages: [...draft.pages, { id, chapterId: page.chapterId, title: '', caption: '', items: [photoItem] }] });
    change(next); selectPage(next.pages.findIndex((p) => p.id === id)); setInspector('photo'); setAddingPhoto('');
  }
  return <section className="book-editor">
    <header className="book-editor-heading">
      <button type="button" className="back-link" disabled={busy} onClick={() => dirty ? setLeaving(true) : onBack()}><ChevronLeft size={15} />书架</button>
      <div className="book-editor-title"><h1>{detail.book.title}</h1><p>{version.kind === 'manual' ? '手工版' : '自动版'} · {draft.pages.length} 页<span className={dirty ? 'book-unsaved' : ''}>{dirty ? '未保存修改' : '已保存'}</span></p></div>
      <div className="book-editor-primary"><button type="button" className="button button-quiet" disabled={busy} onClick={() => setReading(true)}>{dirty ? '预览' : '阅读'}</button><button type="button" className="button button-primary" disabled={busy || !dirty} onClick={() => void perform(async () => { await save(); })}>{busy ? '处理中…' : '保存手工版'}</button><button type="button" className="button button-quiet book-more-button" aria-label="更多画册操作" aria-expanded={more} aria-controls="book-secondary-tools" onClick={() => setMore(!more)}><MoreHorizontal size={19} /></button></div>
    </header>
    {more && <div className="book-secondary-tools" id="book-secondary-tools"><label>历史版本<select disabled={busy || dirty} value={version.id} onChange={(e) => void perform(async () => onChange(await api.selectVersion(detail.book.id, e.target.value)))}>{[...detail.versions].reverse().map((v) => <option key={v.id} value={v.id}>{v.kind === 'manual' ? '手工' : '自动'} · {v.label} · {new Date(v.createdAt).toLocaleString('zh-CN')}</option>)}</select></label>{onPlay && <button type="button" className="button button-quiet" disabled={busy || dirty} onClick={() => onPlay(version.pages.flatMap((p) => p.items.map((entry) => entry.photoId)))}>播放画册</button>}<button type="button" className="button button-quiet" disabled={busy || dirty} onClick={() => void perform(async () => { const path = await api.exportBook(detail, version.id); if (path) toast({ title: `已导出自包含 HTML：${path}` }); })}>导出 HTML</button>{dirty && <span>保存后可切换版本、播放和导出</span>}</div>}
    <div className="book-edit-layout">
      <nav className="book-page-list" aria-label="画册页面"><h3>页面 <span>{draft.pages.length}</span></h3>{draft.pages.map((p, index) => { const photo = photos.find((entry) => entry.id === p.items[0]?.photoId); return <button type="button" key={p.id} className={index === currentPageIndex ? 'active' : ''} aria-current={index === currentPageIndex ? 'page' : undefined} onClick={() => selectPage(index)}><span className="book-page-thumb">{photo?.thumbnailAvailable ? <img src={photo.thumbnailUrl} alt="" loading="lazy" /> : <span>无预览</span>}</span><span className="book-page-list-label"><span>{String(index + 1).padStart(2, '0')}</span><span>{p.title || photo?.title || '照片页'}</span></span></button>; })}</nav>
      <section className="book-edit-preview" aria-label="当前画册页面"><div className="book-canvas-heading"><span>{currentChapter?.title || '未命名章节'}</span><div><button type="button" className="button button-quiet" aria-label="上一页" disabled={!currentPageIndex} onClick={() => selectPage(currentPageIndex - 1)}><ChevronLeft size={15} /></button><span>{currentPageIndex + 1} / {draft.pages.length}</span><button type="button" className="button button-quiet" aria-label="下一页" disabled={currentPageIndex === draft.pages.length - 1} onClick={() => selectPage(currentPageIndex + 1)}><ChevronRight size={15} /></button></div></div>
        <div className="book-preview-stage" style={{ '--book-page-ratio': draft.pageWidth / draft.pageHeight } as CSSProperties}><BookPageView page={page} pageWidth={draft.pageWidth} pageHeight={draft.pageHeight} photos={photos} number={currentPageIndex + 1} selectedItem={inspector === 'photo' ? currentItemIndex : undefined} onSelectItem={(index) => { setItemIndex(index); setInspector('photo'); }} onRelink={onRelink} /></div>
        <div className="book-canvas-footer"><span>{draft.pageWidth} × {draft.pageHeight}</span><button type="button" className="text-button" onClick={() => setInspector('page')}>编辑页面文字与顺序</button></div>
      </section>
      <aside className="book-inspector" aria-label="编辑属性"><nav className="book-inspector-tabs" aria-label="属性类别">{([['photo', '照片'], ['page', '页面'], ['book', '画册']] as const).map(([value, label]) => <button key={value} type="button" className={inspector === value ? 'active' : ''} aria-pressed={inspector === value} onClick={() => setInspector(value)}>{label}</button>)}</nav>
        <div className="book-inspector-scroll"><fieldset disabled={busy} aria-label={`${inspector === 'photo' ? '照片' : inspector === 'page' ? '页面' : '画册'}属性`}>
          {inspector === 'photo' && item && <>
            <div className="book-inspector-context"><span>第 {currentPageIndex + 1} 页 · 照片 {currentItemIndex + 1}</span><h3>{currentPhoto?.title || '照片不可用'}</h3></div>
            {page.items.length > 1 && <div className="book-item-choices">{page.items.map((entry, index) => { const photo = photos.find((p) => p.id === entry.photoId); return <button key={index} type="button" className={index === currentItemIndex ? 'active' : ''} aria-label={`选择照片 ${index + 1} ${photo?.title || ''}`} aria-pressed={index === currentItemIndex} onClick={() => setItemIndex(index)}>{photo?.thumbnailAvailable ? <img src={photo.thumbnailUrl} alt="" /> : <span>照片 {index + 1}</span>}</button>; })}</div>}
            <label>替换选片<select value={item.photoId} onChange={(e) => changeItem({ photoId: e.target.value })}>{photos.filter((p) => p.id === item.photoId || !used.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.library === 'work' ? '作品' : '收藏'} · {p.title}</option>)}</select></label>
            <label>适配方式<select value={item.fit} onChange={(e) => changeItem({ fit: e.target.value as BookItem['fit'] })}><option value="contain">完整展示</option><option value="cover">裁切填满</option></select></label>
            {item.fit === 'cover' && <div className="book-crop-controls"><label>水平裁切 <span>{item.cropX}%</span><input type="range" min={0} max={100} value={item.cropX} onChange={(e) => changeItem({ cropX: Number(e.target.value) })} /></label><label>垂直裁切 <span>{item.cropY}%</span><input type="range" min={0} max={100} value={item.cropY} onChange={(e) => changeItem({ cropY: Number(e.target.value) })} /></label></div>}
            <details className="book-details"><summary>位置与尺寸</summary><div className="book-number-grid">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{({ x: '左边距 %', y: '上边距 %', width: '宽 %', height: '高 %' })[key]}<input type="number" step={1} min={key === 'x' || key === 'y' ? 0 : 1} max={100} value={item[key]} onChange={(e) => changeItem({ [key]: Number(e.target.value) })} /></label>)}</div></details>
            {page.items.length === 2 && <button type="button" className="button" onClick={() => changePage({ items: page.items.map((current, index) => ({ ...current, photoId: page.items[1 - index].photoId, cropX: page.items[1 - index].cropX, cropY: page.items[1 - index].cropY })) })}>交换双图</button>}
          </>}
          {inspector === 'page' && <>
            <div className="book-inspector-context"><span>页面属性</span><h3>第 {currentPageIndex + 1} 页</h3></div>
            <label>所属章节<select value={page.chapterId} onChange={(e) => { const id = page.id; const next = organize({ ...draft, pages: draft.pages.map((p) => p.id === id ? { ...p, chapterId: e.target.value } : p) }); change(next); selectPage(next.pages.findIndex((p) => p.id === id)); }}>{draft.chapters.map((c) => <option key={c.id} value={c.id}>{c.title || '未命名章节'}</option>)}</select></label>
            <label>页标题<input value={page.title} maxLength={200} onChange={(e) => changePage({ title: e.target.value })} /></label><label>页说明<textarea rows={4} value={page.caption} maxLength={5000} onChange={(e) => changePage({ caption: e.target.value })} /></label>
            <div className="book-inspector-section"><h3>同章顺序</h3><div className="book-page-actions"><button type="button" className="button" disabled={currentPageIndex === 0 || draft.pages[currentPageIndex - 1]?.chapterId !== page.chapterId} onClick={() => movePage(-1)}>前移一页</button><button type="button" className="button" disabled={currentPageIndex === draft.pages.length - 1 || draft.pages[currentPageIndex + 1]?.chapterId !== page.chapterId} onClick={() => movePage(1)}>后移一页</button></div></div>
            <button type="button" className="button button-quiet button-danger" disabled={draft.pages.length <= 1} onClick={() => { change({ ...draft, pages: draft.pages.filter((p) => p.id !== page.id) }); selectPage(Math.max(0, currentPageIndex - 1)); }}>移除此页</button>
          </>}
          {inspector === 'book' && <>
            <div className="book-inspector-context"><span>{version.kind === 'manual' ? '手工版本' : '自动版本'}</span><h3>画册设置</h3></div>
            <label>版本名<input value={draft.label} maxLength={200} onChange={(e) => change({ ...draft, label: e.target.value })} /></label>
            <details className="book-details"><summary>纸张尺寸 <span>{draft.pageWidth} × {draft.pageHeight}</span></summary><div className="book-number-grid"><label>页宽<input type="number" min={400} max={4000} value={draft.pageWidth} onChange={(e) => change({ ...draft, pageWidth: Number(e.target.value) })} /></label><label>页高<input type="number" min={400} max={4000} value={draft.pageHeight} onChange={(e) => change({ ...draft, pageHeight: Number(e.target.value) })} /></label></div></details>
            <section className="book-inspector-section"><h3>章节与选片</h3>{draft.chapters.map((c, index) => <div className="book-order-row" key={c.id}><input aria-label={`章节 ${index + 1}`} value={c.title} maxLength={200} onChange={(e) => { const first = draft.pages.find((p) => p.chapterId === c.id)?.id; change({ ...draft, chapters: draft.chapters.map((chapter) => chapter.id === c.id ? { ...chapter, title: e.target.value } : chapter), pages: draft.pages.map((p) => p.id === first ? { ...p, title: e.target.value } : p) }); }} /><span>{c.photoIds.length}</span><button type="button" aria-label="前移章节" disabled={!index} onClick={() => moveChapter(index, -1)}>↑</button><button type="button" aria-label="后移章节" disabled={index === draft.chapters.length - 1} onClick={() => moveChapter(index, 1)}>↓</button><button type="button" aria-label="删除空章节" disabled={draft.chapters.length === 1 || c.photoIds.length > 0} onClick={() => change({ ...draft, chapters: draft.chapters.filter((chapter) => chapter.id !== c.id) })}>×</button></div>)}<button type="button" className="button button-quiet" onClick={() => change({ ...draft, chapters: [...draft.chapters, { id: crypto.randomUUID(), title: '新章节', photoIds: [] }] })}><Plus size={14} />添加章节</button>
              <div className="book-add-photo"><label>追加到「{currentChapter?.title || '当前章'}」<select aria-label="添加照片" value={addingPhoto} onChange={(e) => setAddingPhoto(e.target.value)}><option value="">{available.length ? '选择未入册照片' : '全部照片已在画册中'}</option>{available.map((p) => <option key={p.id} value={p.id}>{p.library === 'work' ? '作品' : '收藏'} · {p.title}</option>)}</select></label><button type="button" className="button" disabled={!addingPhoto} onClick={addPhoto}>添加到当前章</button></div>
            </section>
            <section className="book-inspector-section"><h3>重新排版</h3><label>自动模板<select value={style} onChange={(e) => setStyle(e.target.value as BookTemplate)}>{templates.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label><button type="button" className="button" onClick={() => void perform(async () => { const source = dirty ? await save() : detail; onChange(await api.reflow(source.book.id, source.book.currentVersionId, style)); toast({ title: '已另存自动版本，手工版仍可切换查看' }); })}>{dirty ? '保存并另存自动版' : '另存自动排版版本'}</button><p className="muted">已保存的版本都会保留。</p></section>
          </>}
        </fieldset></div>
        {dirty && <p className="book-inspector-footnote">保存手工版后，修改才会保留</p>}
      </aside>
    </div>
    {reading && <BookReader version={{ ...version, ...draft }} photos={photos} title={`${detail.book.title}${dirty ? ' · 未保存预览' : ''}`} onClose={() => setReading(false)} onRelink={onRelink} />}
    {leaving && <Modal title="离开编辑？" onClose={() => setLeaving(false)}><p>当前修改尚未保存。返回书架会放弃这些修改。</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setLeaving(false)}>继续编辑</button><button type="button" className="button" onClick={onBack}>放弃并返回</button></div></Modal>}
  </section>;
}

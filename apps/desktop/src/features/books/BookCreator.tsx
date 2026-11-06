import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { Modal } from '../../components/ui';
import { templates, type BookChapter, type BookPage, type BookTemplate, type CreateBookInput } from '../../lib/book-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { PhotoSourceDialog } from '../../components/PhotoSourceDialog';
import { BookPageView } from './BookPageView';

const paperSizes = [
  { label: '横向 · 4:3', width: 1200, height: 900 },
  { label: '竖向 · 3:4', width: 900, height: 1200 },
  { label: '方形 · 1:1', width: 1000, height: 1000 },
];
const templateNotes = { white: '单图留白，完整构图', full: '单图铺满，裁切填充', pair: '双图并置，完整构图' };

export function BookCreator({ photos, busy, onSnapshot, onBusyChange, onClose, onCreate, initialSelected = [] }: { photos: Photo[]; busy: boolean; onSnapshot: (snapshot: LibrarySnapshot) => void; onBusyChange?: (busy: boolean) => void; onClose: () => void; onCreate: (input: CreateBookInput) => Promise<void>; initialSelected?: string[] }) {
  const [pickingSource, setPickingSource] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const blocked = busy || sourceBusy;
  useEffect(() => { onBusyChange?.(blocked); return () => onBusyChange?.(false); }, [blocked, onBusyChange]);
  const [title, setTitle] = useState('新的画册');
  const [template, setTemplate] = useState<BookTemplate>('white');
  const [width, setWidth] = useState(1200); const [height, setHeight] = useState(900);
  const [chapters, setChapters] = useState<BookChapter[]>([{ id: crypto.randomUUID(), title: '第一章', photoIds: [] }]);
  const [selected, setSelected] = useState<string[]>(() => [...new Set(initialSelected.filter((id) => photos.some((p) => p.id === id)))]);
  const [assignments, setAssignments] = useState<Record<string, string>>(() => Object.fromEntries(initialSelected.map((id) => [id, chapters[0].id])));
  const [step, setStep] = useState(() => initialSelected.some((id) => photos.some((p) => p.id === id)) ? 1 : 0);
  const [pickerPage, setPickerPage] = useState(0);
  const [query, setQuery] = useState(''); const [library, setLibrary] = useState('all'); const [error, setError] = useState('');
  const available = photos.filter((p) => (library === 'all' || p.library === library) && `${p.title} ${p.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(available.length / 60) - 1);
  const currentPage = Math.min(pickerPage, lastPage);
  useEffect(() => { setPickerPage(0); }, [query, library]);
  const visiblePhotos = available.slice(currentPage * 60, (currentPage + 1) * 60);
  const orderedChapters = chapters.map((chapter) => ({ ...chapter, photoIds: selected.filter((id) => assignments[id] === chapter.id) }));
  const firstChapter = orderedChapters.find((chapter) => chapter.photoIds.length);
  const sampleIds = firstChapter?.photoIds.slice(0, template === 'pair' ? 2 : 1) || [];
  const sample: BookPage = {
    id: 'preview', chapterId: firstChapter?.id || '', title: firstChapter?.title || '', caption: '',
    items: sampleIds.map((photoId, index) => ({
      photoId, x: template === 'full' ? 0 : template === 'pair' && sampleIds.length === 2 ? 5 + index * 48 : 10,
      y: template === 'full' ? 0 : template === 'pair' && sampleIds.length === 2 ? 10 : 8,
      width: template === 'full' ? 100 : template === 'pair' && sampleIds.length === 2 ? 42 : 80,
      height: template === 'full' ? 100 : template === 'pair' && sampleIds.length === 2 ? 75 : 77,
      cropX: 50, cropY: 50, fit: template === 'full' ? 'cover' : 'contain',
    })),
  };
  const paperSize = paperSizes.findIndex((size) => size.width === width && size.height === height);
  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((p) => p !== id) : [...previous, id]);
    setAssignments((previous) => ({ ...previous, [id]: previous[id] || chapters[0].id }));
  }
  function move(id: string, offset: number) {
    const chapterIds = selected.filter((photoId) => assignments[photoId] === assignments[id]);
    const targetId = chapterIds[chapterIds.indexOf(id) + offset];
    const next = [...selected]; const index = next.indexOf(id); const target = next.indexOf(targetId);
    [next[index], next[target]] = [next[target], next[index]]; setSelected(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || pickingSource) return;
    if (step === 0) { if (selected.length) setStep(1); return; }
    setError('');
    try { await onCreate({ title, template, pageWidth: width, pageHeight: height, chapters: orderedChapters }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title="创建画册" wide onClose={() => { if (!blocked) onClose(); }}>
    <form className="book-create" onSubmit={(event) => void submit(event)}>
      <nav className="book-create-steps" aria-label="创建步骤">
        {['选照片', '设置画册'].map((label, index) => <button key={label} type="button" disabled={blocked || (index === 1 && !selected.length)} className={step === index ? 'active' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => { if (index === 0 || selected.length) setStep(index); }}><span>{index + 1}</span>{label}</button>)}
      </nav>
      <fieldset className="book-create-body" disabled={blocked}>
        {step === 0 ? <section className="book-choose-photos" aria-label="选择画册照片">
          <div className="book-source-tools"><button type="button" className="button" onClick={() => setPickingSource(true)}><Plus size={14} />添加照片</button><div className="book-search"><Search size={16} /><input aria-label="搜索可选照片" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题或标签" /></div><select aria-label="照片来源" value={library} onChange={(e) => setLibrary(e.target.value)}><option value="all">全部图库</option><option value="collection">收藏</option><option value="work">作品</option></select></div>
          <div className="book-photo-picker">{visiblePhotos.map((photo) => <button type="button" key={photo.id} className={selected.includes(photo.id) ? 'selected' : ''} aria-pressed={selected.includes(photo.id)} onClick={() => toggle(photo.id)}><div className="book-picker-image">{photo.thumbnailAvailable ? <img src={photo.thumbnailUrl} alt="" loading="lazy" /> : <span>预览缺失</span>}<span className="book-picker-check" aria-hidden="true">{selected.includes(photo.id) && <Check size={13} />}</span></div><span><span className="book-picker-title" title={photo.title}>{photo.title}</span><small>{photo.library === 'work' ? '作品' : '收藏'}</small></span></button>)}{!available.length && <p className="book-picker-empty">{query || library !== 'all' ? '没有符合条件的照片' : '还没有照片'}</p>}</div>
          {available.length > 60 && <div className="book-picker-pagination"><button type="button" className="button button-quiet" disabled={currentPage === 0} onClick={() => setPickerPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1} · 共 {available.length} 张</span><button type="button" className="button button-quiet" disabled={currentPage === lastPage} onClick={() => setPickerPage(currentPage + 1)}>下一页</button></div>}
        </section> : <div className="book-create-arrange">
          <section className="book-create-preview" aria-label="版式示意"><div className="book-create-paper" style={{ '--book-page-ratio': width / height } as CSSProperties}><BookPageView page={sample} pageWidth={width} pageHeight={height} photos={photos} number={1} /></div><p>版式示意 · {width} × {height}</p></section>
          <section className="book-create-options" aria-label="画册设置">
            <label>画册名称<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required /></label>
            <div><h3>版式</h3><div className="book-template-options">{templates.map((choice) => <button key={choice.value} type="button" className={template === choice.value ? 'active' : ''} aria-pressed={template === choice.value} onClick={() => setTemplate(choice.value)}><span className={`book-template-mark ${choice.value}`} aria-hidden="true"><i />{choice.value === 'pair' && <i />}</span>{choice.label}</button>)}</div><p className="muted book-template-note">{templateNotes[template]}</p></div>
            <label>纸张比例<select value={paperSize} onChange={(e) => { const size = paperSizes[Number(e.target.value)]; if (size) { setWidth(size.width); setHeight(size.height); } }}><option value={-1} disabled>自定义比例</option>{paperSizes.map((size, index) => <option key={size.label} value={index}>{size.label}</option>)}</select></label>
            <details className="book-details"><summary>自定义尺寸</summary><div className="book-number-grid"><label>页宽<input type="number" min={400} max={4000} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label><label>页高<input type="number" min={400} max={4000} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label></div></details>
          </section>
          <details className="book-details book-create-order"><summary>选片顺序与章节 <span>{selected.length} 张 · {chapters.length} 章</span></summary><div className="book-selected-list">{orderedChapters.map((chapter, chapterIndex) => <section className="book-create-chapter" key={chapter.id}><div className="book-order-row"><span>{String(chapterIndex + 1).padStart(2, '0')}</span><input aria-label={`章节 ${chapterIndex + 1} 名称`} value={chapter.title} maxLength={200} onChange={(e) => setChapters(chapters.map((c) => c.id === chapter.id ? { ...c, title: e.target.value } : c))} /><span>{chapter.photoIds.length} 张</span></div>{chapter.photoIds.map((id, index) => { const photo = photos.find((p) => p.id === id); return <div className="book-order-row book-selected-row" key={id}>{photo?.thumbnailAvailable && <img src={photo.thumbnailUrl} alt="" loading="lazy" />}<span className="book-row-title" title={photo?.title}>{photo?.title}</span><select aria-label={`${photo?.title} 所属章节`} value={assignments[id]} onChange={(e) => setAssignments({ ...assignments, [id]: e.target.value })}>{chapters.map((c) => <option value={c.id} key={c.id}>{c.title || '未命名章节'}</option>)}</select><button type="button" aria-label="上移照片" disabled={!index} onClick={() => move(id, -1)}>↑</button><button type="button" aria-label="下移照片" disabled={index === chapter.photoIds.length - 1} onClick={() => move(id, 1)}>↓</button><button type="button" aria-label="移除选片" onClick={() => toggle(id)}>×</button></div>; })}</section>)}</div><button type="button" className="button button-quiet" onClick={() => setChapters([...chapters, { id: crypto.randomUUID(), title: `第 ${chapters.length + 1} 章`, photoIds: [] }])}><Plus size={14} />添加章节</button></details>
        </div>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="book-create-footer"><span>已选 {selected.length} 张照片</span><div>{step === 1 ? <button className="button button-quiet" type="button" disabled={blocked} onClick={() => setStep(0)}><ChevronLeft size={15} />返回选片</button> : <button className="button button-quiet" type="button" disabled={blocked} onClick={onClose}>取消</button>}<button className="button button-primary" type="submit" disabled={blocked || !selected.length}>{busy ? '创建中…' : step === 0 ? <>设置画册<ChevronRight size={15} /></> : '创建并排版'}</button></div></div>
    </form>
    {pickingSource && <PhotoSourceDialog photos={photos} selectedIds={selected} library="collection" title="选择画册照片" onBusyChange={setSourceBusy} onClose={() => setPickingSource(false)} onConfirm={({ photoIds, snapshot }) => {
      if (snapshot) onSnapshot(snapshot);
      setSelected(photoIds);
      setAssignments((previous) => Object.fromEntries(photoIds.map((id) => [id, previous[id] || chapters[0].id])));
      setPickingSource(false);
    }} />}
  </Modal>;
}

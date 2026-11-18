import { photoCount, t } from '../../lib/i18n';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Modal } from '../../components/ui';
import { DropdownSelect } from '../../components/DropdownSelect';
import { templates, type BookChapter, type BookPage, type BookTemplate, type CreateBookInput } from '../../lib/book-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { PhotoLibraryPicker } from '../../components/PhotoPicker';
import { PhotoSourceDialog } from '../../components/PhotoSourceDialog';
import { BookPageView } from './BookPageView';

const paperSizes = [
  { label: t('横向 · 4:3', 'Landscape · 4:3'), width: 1200, height: 900 },
  { label: t('竖向 · 3:4', 'Portrait · 3:4'), width: 900, height: 1200 },
  { label: t('方形 · 1:1', 'Square · 1:1'), width: 1000, height: 1000 },
];
const paperOptions = [{ value: -1, label: t('自定义比例', 'Custom Ratio'), disabled: true }, ...paperSizes.map(({ label }, value) => ({ value, label }))];
const templateNotes = { white: t('单图留白，完整构图', 'One photo with margins, shown in full'), full: t('单图铺满，裁切填充', 'One photo cropped to fill the page'), pair: t('双图并置，完整构图', 'Two photos side by side, shown in full') };

export function BookCreator({ snapshot, photos, busy, onSnapshot, onBusyChange, onClose, onCreate, initialSelected = [] }: { snapshot: LibrarySnapshot; photos: Photo[]; busy: boolean; onSnapshot: (snapshot: LibrarySnapshot) => void; onBusyChange?: (busy: boolean) => void; onClose: () => void; onCreate: (input: CreateBookInput) => Promise<void>; initialSelected?: string[] }) {
  const [pickingSource, setPickingSource] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const blocked = busy || sourceBusy;
  useEffect(() => { onBusyChange?.(blocked); return () => onBusyChange?.(false); }, [blocked, onBusyChange]);
  const [title, setTitle] = useState(t('新的画册', 'New Photo Book'));
  const [template, setTemplate] = useState<BookTemplate>('white');
  const [width, setWidth] = useState(1200); const [height, setHeight] = useState(900);
  const [chapters, setChapters] = useState<BookChapter[]>([{ id: crypto.randomUUID(), title: t('第一章', 'Chapter 1'), photoIds: [] }]);
  const [selected, setSelected] = useState<string[]>(() => [...new Set(initialSelected.filter((id) => photos.some((p) => p.id === id)))]);
  const [assignments, setAssignments] = useState<Record<string, string>>(() => Object.fromEntries(initialSelected.map((id) => [id, chapters[0].id])));
  const [step, setStep] = useState(() => initialSelected.some((id) => photos.some((p) => p.id === id)) ? 1 : 0);
  const [error, setError] = useState('');
  const chapterOptions = chapters.map((chapter) => ({ value: chapter.id, label: chapter.title || t('未命名章节', 'Untitled Chapter') }));
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
  function choosePhotos(ids: string[]) {
    setSelected(ids);
    setAssignments((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, previous[id] || chapters[0].id])) }));
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
  return <Modal title={t('创建画册', 'Create Photo Book')} wide glass onClose={() => { if (!blocked) onClose(); }}>
    <form className="book-create" onSubmit={(event) => void submit(event)}>
      <nav className="book-create-steps" aria-label={t('创建步骤', 'Creation Steps')}>
        {[t('选照片', 'Select Photos'), t('设置画册', 'Set Up Book')].map((label, index) => <button key={label} type="button" disabled={blocked || (index === 1 && !selected.length)} className={step === index ? 'active' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => { if (index === 0 || selected.length) setStep(index); }}><span>{index + 1}</span>{label}</button>)}
      </nav>
      <fieldset className="book-create-body" disabled={blocked}>
        {step === 0 ? <section className="book-choose-photos" aria-label={t('选择画册照片', 'Select Photos for Book')}>
          <div className="book-source-tools"><button type="button" className="button" onClick={() => setPickingSource(true)}><Plus size={14} />{t('添加照片', 'Add Photos')}</button></div>
          <PhotoLibraryPicker snapshot={snapshot} selectedIds={selected} onChange={choosePhotos} actions={<>
            <button className="button button-quiet" type="button" disabled={blocked} onClick={onClose}>{t('取消', 'Cancel')}</button>
            <button className="button button-primary" type="submit" disabled={blocked || !selected.length}>{busy ? t('创建中…', 'Creating…') : <>{t('设置画册', 'Set Up Book')}<ChevronRight size={15} /></>}</button>
          </>} />
        </section> : <div className="book-create-arrange">
          <section className="book-create-preview" aria-label={t('版式示意', 'Layout Preview')}><div className="book-create-paper" style={{ '--book-page-ratio': width / height } as CSSProperties}><BookPageView page={sample} pageWidth={width} pageHeight={height} photos={photos} number={1} /></div><p>{t('版式示意', 'Layout Preview')} · {width} × {height}</p></section>
          <section className="book-create-options" aria-label={t('画册设置', 'Book Settings')}>
            <label>{t('画册名称', 'Book Title')}<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required /></label>
            <div><h3>{t('版式', 'Layout')}</h3><div className="book-template-options">{templates.map((choice) => <button key={choice.value} type="button" className={template === choice.value ? 'active' : ''} aria-pressed={template === choice.value} onClick={() => setTemplate(choice.value)}><span className={`book-template-mark ${choice.value}`} aria-hidden="true"><i />{choice.value === 'pair' && <i />}</span>{choice.label}</button>)}</div><p className="muted book-template-note">{templateNotes[template]}</p></div>
            <DropdownSelect label={t('纸张比例', 'Page Ratio')} field value={paperSize} options={paperOptions} disabled={blocked} onChange={(index) => {
              const size = paperSizes[index];
              setWidth(size.width);
              setHeight(size.height);
            }} />
            <details className="book-details"><summary>{t('自定义尺寸', 'Custom Size')}</summary><div className="book-number-grid"><label>{t('页宽', 'Page Width')}<input type="number" min={400} max={4000} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label><label>{t('页高', 'Page Height')}<input type="number" min={400} max={4000} value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label></div></details>
          </section>
          <details className="book-details book-create-order"><summary>{t('选片顺序与章节 ', 'Photo Order and Chapters ')}<span>{t(`${selected.length} 张 · ${chapters.length} 章`, `${photoCount(selected.length)} · ${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`)}</span></summary><div className="book-selected-list">{orderedChapters.map((chapter, chapterIndex) => <section className="book-create-chapter" key={chapter.id}><div className="book-order-row"><span>{String(chapterIndex + 1).padStart(2, '0')}</span><input aria-label={t(`章节 ${chapterIndex + 1} 名称`, `Chapter ${chapterIndex + 1} Title`)} value={chapter.title} maxLength={200} onChange={(e) => setChapters(chapters.map((c) => c.id === chapter.id ? { ...c, title: e.target.value } : c))} /><span>{t(`${chapter.photoIds.length} 张`, photoCount(chapter.photoIds.length))}</span></div>{chapter.photoIds.map((id, index) => { const photo = photos.find((p) => p.id === id); return <div className="book-order-row book-selected-row" key={id}>{photo?.thumbnailAvailable && <img src={photo.thumbnailUrl} alt="" loading="lazy" />}<span className="book-row-title" title={photo?.title}>{photo?.title}</span>
            <DropdownSelect label={t(`${photo?.title} 所属章节`, `Chapter for ${photo?.title}`)} value={assignments[id]} options={chapterOptions} disabled={blocked}
              onChange={(chapterId) => setAssignments({ ...assignments, [id]: chapterId })} />
            <button type="button" aria-label={t('上移照片', 'Move Photo Up')} disabled={!index} onClick={() => move(id, -1)}>↑</button><button type="button" aria-label={t('下移照片', 'Move Photo Down')} disabled={index === chapter.photoIds.length - 1} onClick={() => move(id, 1)}>↓</button><button type="button" aria-label={t('移除选片', 'Remove Photo')} onClick={() => toggle(id)}>×</button></div>; })}</section>)}</div><button type="button" className="button button-quiet" onClick={() => setChapters([...chapters, { id: crypto.randomUUID(), title: t(`第 ${chapters.length + 1} 章`, `Chapter ${chapters.length + 1}`), photoIds: [] }])}><Plus size={14} />{t('添加章节', 'Add Chapter')}</button></details>
        </div>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {step === 1 && <div className="book-create-footer">
        <div className="book-create-selection"><span aria-live="polite">{t(`已选 ${selected.length} 张照片`, `${photoCount(selected.length)} selected`)}</span></div>
        <div>
          <button className="button button-quiet" type="button" disabled={blocked} onClick={() => setStep(0)}><ChevronLeft size={15} />{t('返回选片', 'Back to Photos')}</button>
          <button className="button button-primary" type="submit" disabled={blocked || !selected.length}>{busy ? t('创建中…', 'Creating…') : t('创建并排版', 'Create and Lay Out')}</button>
        </div>
      </div>}
    </form>
    {pickingSource && <PhotoSourceDialog snapshot={snapshot} selectedIds={selected} library="collection" title={t('选择画册照片', 'Select Photos for Book')} onBusyChange={setSourceBusy} onClose={() => setPickingSource(false)} onConfirm={({ photoIds, snapshot }) => {
      if (snapshot) onSnapshot(snapshot);
      choosePhotos(photoIds);
      setPickingSource(false);
    }} />}
  </Modal>;
}

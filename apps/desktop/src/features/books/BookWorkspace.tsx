import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Busy, EmptyState, Modal } from '../../components/ui';
import * as api from '../../lib/book-api';
import type { BookDetail, BookSummary, CreateBookInput } from '../../lib/book-types';
import type { Photo } from '../../lib/types';
import { useContextMenu } from '../use-context-menu';
import { BookCreator } from './BookCreator';
import { BookEditor } from './BookEditor';
import './books.css';

export function BookWorkspace({ photos, onPlay, onDirtyChange, onRelink }: { photos: Photo[]; onPlay?: (photoIds: string[]) => void; onDirtyChange?: (dirty: boolean) => void; onRelink?: (photo: Photo) => Promise<void> }) {
  const [books, setBooks] = useState<BookSummary[]>([]); const [detail, setDetail] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [creating, setCreating] = useState(false); const [renaming, setRenaming] = useState<BookSummary | null>(null); const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<BookSummary | null>(null);
  const mounted = useRef(true);
  const menuContext = JSON.stringify([detail?.book.id, creating, renaming?.id, deleting?.id]);
  const blocked = loading || busy || !!detail || creating || !!renaming || !!deleting;
  const menuState = useRef({ context: menuContext, blocked, books });
  menuState.current = { context: menuContext, blocked, books };
  const openMenu = useContextMenu('book', menuContext, setError);
  async function reload() {
    setLoading(true); setError('');
    try { const next = await api.listBooks(); if (mounted.current) setBooks(next); }
    catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, []);
  async function perform(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); }
    catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function changed(next: BookDetail) { setDetail(next); setBooks((previous) => [next.book, ...previous.filter((b) => b.id !== next.book.id)]); }
  async function create(input: CreateBookInput) {
    setBusy(true); try { const next = await api.createBook(input); if (mounted.current) { changed(next); setCreating(false); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function rename(event: FormEvent) {
    event.preventDefault(); if (!renaming || busy) return;
    const id = renaming.id;
    await perform(async () => {
      const next = await api.renameBook(id, name);
      if (!mounted.current) return;
      setBooks((previous) => previous.map((b) => b.id === next.book.id ? next.book : b)); setRenaming(null);
    });
  }
  function showMenu(book: BookSummary, at: { x: number; y: number }, trigger: HTMLElement) {
    const context = menuContext;
    const target = () => menuState.current.books.find((item) => item.id === book.id);
    const allowed = () => menuState.current.context === context && !menuState.current.blocked && !!target();
    void openMenu([
      { id: 'rename', text: '重命名…', disabled: blocked, allowed, run: () => { const current = target(); if (current) { setRenaming(current); setName(current.title); } } },
      { id: 'delete', text: '删除画册…', disabled: blocked, allowed, run: () => { const current = target(); if (current) setDeleting(current); } },
    ], at, trigger);
  }
  function openBook(book: BookSummary) {
    if (blocked) return;
    const context = menuContext;
    void perform(async () => {
      const next = await api.getBook(book.id);
      if (mounted.current && menuState.current.context === context) setDetail(next);
    });
  }
  if (detail) return <BookEditor detail={detail} photos={photos} onChange={changed} onPlay={onPlay} onDirtyChange={onDirtyChange} onRelink={onRelink} onBack={() => { setDetail(null); void reload(); }} />;
  return <section className="book-workspace" aria-label="画册"><section className="workspace-intro book-shelf-intro"><div className="book-shelf-title"><h1>画册</h1><p className="photo-count">{books.length} 本画册</p></div><button type="button" className="button" disabled={busy} onClick={() => setCreating(true)}>创建画册</button></section>
    {error && <div className="book-error" role="alert"><span>{error}</span><button type="button" className="button" onClick={() => void reload()}>重新读取</button></div>}
    {loading ? <Busy label="正在读取书架" /> : !books.length ? <EmptyState title="还没有画册" action={<button type="button" className="button" onClick={() => setCreating(true)}>创建第一本画册</button>} /> : <div className="book-shelf">{books.map((book) => <article className="book-card" key={book.id}
      onClick={() => openBook(book)}
      onContextMenu={(event) => {
        event.preventDefault(); event.stopPropagation();
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.book-cover');
        if (trigger) showMenu(book, { x: event.clientX, y: event.clientY }, trigger);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault(); event.stopPropagation();
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.book-cover');
        if (trigger) { const rect = trigger.getBoundingClientRect(); showMenu(book, { x: rect.left + 24, y: rect.top + 32 }, trigger); }
      }}>
      <button type="button" className="book-cover" disabled={busy} aria-label={`打开画册 ${book.title}`}><span>Foliune</span><h2>{book.title}</h2><span>{book.photoCount} 张照片</span></button>
      <div className="book-card-footer"><p className="book-card-meta"><span>{book.versionCount} 个版本</span><time dateTime={book.updatedAt}>{new Date(book.updatedAt).toLocaleDateString('zh-CN')}</time></p></div>
    </article>)}</div>}
    {creating && <BookCreator photos={photos} busy={busy} onClose={() => setCreating(false)} onCreate={create} />}
    {renaming && <Modal title="重命名画册" onClose={() => setRenaming(null)}><form onSubmit={(event) => void rename(event)}><label>画册名称<input autoFocus value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="button" type="button" onClick={() => setRenaming(null)}>取消</button><button className="button button-primary" type="submit" disabled={busy}>保存</button></div></form></Modal>}
    {deleting && <Modal title="删除画册？" onClose={() => setDeleting(null)}><p>将删除《{deleting.title}》及其全部版本，图库照片会保留。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setDeleting(null)}>取消</button><button type="button" className="button button-primary" disabled={busy} onClick={() => {
      const id = deleting.id;
      void perform(async () => { await api.deleteBook(id); if (mounted.current) { setBooks((previous) => previous.filter((book) => book.id !== id)); setDeleting(null); } });
    }}>确认删除</button></div></Modal>}
  </section>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

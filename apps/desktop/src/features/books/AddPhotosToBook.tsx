import { photoCount, t } from '../../lib/i18n';
import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui';
import { DropdownSelect } from '../../components/DropdownSelect';
import * as api from '../../lib/book-api';
import type { BookSummary, CreateBookInput } from '../../lib/book-types';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import { BookCreator } from './BookCreator';
import './books.css';

export function AddPhotosToBook({ snapshot, photos, selectedIds, onSnapshot, onBusyChange, onClose, onComplete }: { snapshot: LibrarySnapshot; photos: Photo[]; selectedIds: string[]; onSnapshot: (snapshot: LibrarySnapshot) => void; onBusyChange?: (busy: boolean) => void; onClose: () => void; onComplete?: () => void }) {
  const [books, setBooks] = useState<BookSummary[]>([]); const [target, setTarget] = useState(''); const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [sourceBusy, setSourceBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy || sourceBusy); return () => onBusyChange?.(false); }, [busy, sourceBusy, onBusyChange]);
  useEffect(() => { let active = true; void api.listBooks().then((result) => { if (active) { setBooks(result); setTarget(result[0]?.id || ''); } }).catch((cause: unknown) => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  function done() { onComplete?.(); onClose(); }
  async function append() { setBusy(true); setError(''); try { await api.appendPhotosToBook(target, selectedIds); done(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  async function create(input: CreateBookInput) { setBusy(true); try { await api.createBook(input); done(); } finally { setBusy(false); } }
  if (creating) return <BookCreator snapshot={snapshot} onSnapshot={onSnapshot} onBusyChange={setSourceBusy} photos={photos} initialSelected={selectedIds} busy={busy} onClose={() => setCreating(false)} onCreate={create} />;
  return <Modal title={t('加入画册', 'Add to Book')} onClose={() => { if (!busy) onClose(); }}>
    <div className="stack-form">
      <p>{t(`已选 ${selectedIds.length} 张照片`, `${photoCount(selectedIds.length)} selected`)}</p>
      {loading ? <p role="status">{t('正在读取书架…', 'Loading bookshelf…')}</p> : books.length ? <DropdownSelect label={t('目标画册', 'Choose a Book')} field value={target}
        onChange={setTarget} options={books.map((book) => ({ value: book.id, label: book.title }))} /> : <p className="muted">{t('还没有画册', 'No Photo Books Yet')}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button" type="button" disabled={busy} onClick={() => setCreating(true)}>{t('用所选照片创建画册', 'Create a Book from Selection')}</button>
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onClose}>{t('取消', 'Cancel')}</button>
        <button type="button" className="button button-primary" disabled={busy || !target || !selectedIds.length} onClick={() => void append()}>{busy ? t('保存中…', 'Saving…') : t('加入画册', 'Add to Book')}</button>
      </div>
    </div>
  </Modal>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

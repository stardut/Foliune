import { ArrowLeft, ArrowRight } from 'lucide-react';

export const PHOTO_PAGE_SIZE = 60;
export function PageControls({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PHOTO_PAGE_SIZE));
  if (pages <= 1) return null;
  return <div className="page-controls" aria-label="照片分页"><span>每页最多 {PHOTO_PAGE_SIZE} 张 · 共 {total} 张</span><div><button className="button" type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}><ArrowLeft size={13} />上一页</button><span aria-live="polite">{page + 1} / {pages}</span><button className="button" type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>下一页<ArrowRight size={13} /></button></div></div>;
}

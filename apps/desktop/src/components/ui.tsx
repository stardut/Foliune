import { presentModal } from '../lib/modal-stack';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, LoaderCircle } from 'lucide-react';

export function IconButton({ label, children, onClick, disabled = false, active = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function WorkspaceHeader({ title, count, children }: { title: ReactNode; count?: string; children?: ReactNode }) {
  return <header className="workspace-intro workspace-home-intro">
    <div className="workspace-title"><h1>{title}</h1>{count && <p className="photo-count">{count}</p>}</div>
    {children && <div className="workspace-tools">{children}</div>}
  </header>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">F.</span><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>;
}

export function Busy({ label = '正在读取图库' }: { label?: string }) {
  return <div className="busy" role="status"><LoaderCircle size={18} className="spin" />{label}</div>;
}

export function Modal({ title, children, onClose, closeDisabled = false, wide = false }: { title: string; children: ReactNode; onClose?: () => void; closeDisabled?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const dismissModal = presentModal(dialog!);
    return () => { dismissModal(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={(event) => { event.preventDefault(); if (!closeDisabled) onClose?.(); }} onClick={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose?.(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2>{onClose && <IconButton label="关闭" onClick={onClose} disabled={closeDisabled}><X size={18} /></IconButton>}</div>{children}
  </dialog>;
}

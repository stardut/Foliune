import { presentModal } from '../lib/modal-stack';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronLeft, Info } from 'lucide-react';
import type { Photo } from '../lib/types';
import { PhotoReviewImage, useReviewPresentation } from './PhotoReviewImage';
import { IconButton } from '../components/ui';
import { useDismiss } from '../components/beui/hooks/use-dismiss';
import './photo-review.css';

export function PhotoReview({ photos, initialPhotoId, context, busy, onClose, onRelink, returnLabel = '返回照片墙' }: {
  photos: Photo[]; initialPhotoId: string; context: string; busy: boolean;
  onClose: () => void; onRelink: (photo: Photo) => Promise<void>; returnLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const infoId = useId();
  const infoScope = useRef<HTMLDivElement>(null);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const infoPanel = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoVisible = useRef(false);
  const infoFocusFrame = useRef<number | null>(null);
  const [requestedId, setRequestedId] = useState(initialPhotoId);
  const request = useRef({ id: initialPhotoId, direction: 0 });
  const reduced = !!useReducedMotion();
  const { state: images, controller } = useReviewPresentation(photos, requestedId, request.current.direction, reduced);
  const [awake, setAwake] = useState(true);
  const visible = useRef(true);
  const active = useRef(true);
  const hoveringTools = useRef(false);
  const movingFocus = useRef(false);
  const lastActivity = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedIndex = photos.findIndex((photo) => photo.id === requestedId);
  const current = images.current?.photo || photos[requestedIndex];
  const index = current ? photos.findIndex((photo) => photo.id === current.id) : -1;
  const name = current?.title || current?.originalName || '照片不在当前结果中';
  const captured = current?.capturedAt ? new Date(current.capturedAt) : null;
  const closeInfo = useCallback(() => { infoVisible.current = false; setInfoOpen(false); reveal(); }, []);
  const dismissOutside = useCallback(() => {
    const focusedPanel = infoPanel.current?.contains(document.activeElement);
    closeInfo();
    if (focusedPanel) infoFocusFrame.current = requestAnimationFrame(() => {
      infoFocusFrame.current = null;
      const focused = document.activeElement;
      // Let the outside gesture focus its new control first. Only repair the
      // root/disconnected focus left behind by removing the information panel.
      if (active.current && !infoVisible.current && !dialog.current?.contains(focused)
        && (focused === document.body || focused === document.documentElement || !focused?.isConnected)) stage.current?.focus({ preventScroll: true });
    });
  }, [closeInfo]);
  useDismiss(infoOpen, dismissOutside, infoScope, { escape: false });
  useEffect(() => {
    if (infoVisible.current) {
      if (infoPanel.current?.contains(document.activeElement)) stage.current?.focus({ preventScroll: true });
      closeInfo();
    }
  }, [current?.id, current?.originalUrl, closeInfo]);
  useEffect(() => { if (infoOpen) infoPanel.current?.focus({ preventScroll: true }); }, [infoOpen]);
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const dismissModal = presentModal(element!);
    stage.current?.focus({ preventScroll: true });
    reveal();
    return () => {
      active.current = false;
      if (infoFocusFrame.current !== null) cancelAnimationFrame(infoFocusFrame.current);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      dismissModal(); previous?.focus({ preventScroll: true });
    };
  }, []);
  function checkIdle() {
    hideTimer.current = null;
    if (!active.current) return;
    const focused = document.activeElement;
    const toolFocus = focused instanceof Element && dialog.current?.contains(focused)
      && focused.closest('.photo-review-header, .photo-review-footer');
    if (infoVisible.current || hoveringTools.current || (toolFocus && document.documentElement.dataset.inputMode === 'keyboard')) return;
    const remaining = 2200 - (Date.now() - lastActivity.current);
    if (remaining > 0) { hideTimer.current = setTimeout(checkIdle, remaining); return; }
    if (toolFocus) {
      movingFocus.current = true;
      stage.current?.focus({ preventScroll: true });
      movingFocus.current = false;
    }
    visible.current = false;
    setAwake(false);
  }
  function reveal() {
    if (!active.current || movingFocus.current) return;
    lastActivity.current = Date.now();
    if (!visible.current) { visible.current = true; setAwake(true); }
    // Frequent pointer movement updates a timestamp, not React state or timers.
    if (hideTimer.current === null) hideTimer.current = setTimeout(checkIdle, 2200);
  }
  const toolbarEvents = {
    onPointerEnter: () => { hoveringTools.current = true; reveal(); },
    onPointerLeave: () => { hoveringTools.current = false; reveal(); },
  };
  function advance(direction: number) {
    const from = photos.findIndex((photo) => photo.id === request.current.id);
    const next = photos[from + direction];
    if (next) {
      if (infoVisible.current) {
        if (infoPanel.current?.contains(document.activeElement)) stage.current?.focus({ preventScroll: true });
        closeInfo();
      }
      request.current = { id: next.id, direction }; setRequestedId(next.id); }
  }
  function navigateFromControl(direction: number) {
    advance(direction);
    // Accessibility activation need not focus the pressed button. Keep the
    // next key event inside the dialog without stealing an existing tool focus.
    if (!dialog.current?.contains(document.activeElement)) stage.current?.focus({ preventScroll: true });
  }
  return <dialog ref={dialog} className="photo-review" aria-labelledby={titleId} data-controls-hidden={!awake}
    onPointerMove={reveal} onPointerDown={reveal} onFocusCapture={reveal} onBlurCapture={reveal}
    onCancel={(event) => { event.preventDefault(); if (infoVisible.current) { closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); } else onClose(); }}
    onKeyDown={(event) => {
      if (infoVisible.current && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); return;
      }
      // Tab's default focus search must see the controls after inert is removed.
      if (!visible.current) flushSync(reveal); else reveal();
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); advance(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
    <div className="photo-review-header-region" data-tauri-drag-region="deep">
      <header className="photo-review-header" inert={!awake} aria-hidden={!awake} {...toolbarEvents}>
        <div className="photo-review-leading">
          <button type="button" className="text-button photo-review-back" data-tauri-drag-region="false" aria-label={returnLabel} title={returnLabel} onClick={onClose}><ChevronLeft size={20} data-tauri-drag-region="false" /></button>
          <h2 id={titleId} className="photo-review-title">{name}</h2>
        </div>
        <div className="photo-review-info-scope" ref={infoScope} data-tauri-drag-region="false">
          <button type="button" className="photo-review-info-button" ref={infoTrigger} aria-label="照片信息" title="照片信息" disabled={!current} aria-haspopup="dialog" aria-expanded={infoOpen} aria-controls={infoOpen ? infoId : undefined}
            onClick={() => { if (infoVisible.current) { closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); } else { infoVisible.current = true; setInfoOpen(true); reveal(); } }}><Info size={16} data-tauri-drag-region="false" /></button>
          {infoOpen && current && <div id={infoId} ref={infoPanel} className="photo-review-info-panel" role="dialog" aria-modal={false} aria-labelledby={`${infoId}-title`} tabIndex={-1} data-tauri-drag-region="false"
            onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}>
            <h3 id={`${infoId}-title`}>{name}</h3>
            <dl>
              {current.originalName && current.originalName !== name && <><dt>文件名</dt><dd>{current.originalName}</dd></>}
              {current.width > 0 && current.height > 0 && <><dt>尺寸</dt><dd>{current.width} × {current.height}</dd></>}
              {captured && Number.isFinite(captured.getTime()) && <><dt>拍摄时间</dt><dd>{captured.toLocaleString('zh-CN', { hour12: false })}</dd></>}
              {current.location?.trim() && <><dt>地点</dt><dd>{current.location}</dd></>}
              {current.source?.trim() && <><dt>来源</dt><dd>{current.source}</dd></>}
            </dl>
          </div>}
        </div>
      </header>
    </div>
    <div ref={stage} className="photo-review-stage" tabIndex={-1} aria-label={`${context}，照片预览，左右键切换，Esc 返回`} aria-busy={images.waiting}>
      {current ? <PhotoReviewImage state={images} controller={controller} onRelink={onRelink} busy={busy} /> : <p role="status">当前结果中没有这张照片，请返回照片墙。</p>}
    </div>
    <footer className="photo-review-footer" inert={!awake} aria-hidden={!awake} {...toolbarEvents} data-tauri-drag-region="false">
      <nav className="photo-review-navigation" aria-label="照片切换" data-tauri-drag-region="false">
        <IconButton label="上一张" disabled={requestedIndex <= 0} onClick={() => navigateFromControl(-1)}><ArrowLeft size={16} data-tauri-drag-region="false" /></IconButton>
        <span className="photo-review-position" aria-live="polite">{index < 0 ? 0 : index + 1}<span> / {photos.length}</span></span>
        <IconButton label="下一张" disabled={requestedIndex < 0 || requestedIndex >= photos.length - 1} onClick={() => navigateFromControl(1)}><ArrowRight size={16} data-tauri-drag-region="false" /></IconButton>
      </nav>
    </footer>
  </dialog>;
}

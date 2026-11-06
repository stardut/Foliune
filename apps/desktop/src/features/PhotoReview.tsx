import { presentModal } from '../lib/modal-stack';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronLeft, Info } from 'lucide-react';
import type { Photo } from '../lib/types';
import { PhotoReviewImage, useReviewPresentation } from './PhotoReviewImage';
import { PhotoReviewInfo } from './PhotoReviewInfo';
import { startReviewEntry, type ReviewEntrySource } from './review-entry';
import { IconButton } from '../components/ui';
import { useDismiss } from '../components/beui/hooks/use-dismiss';
import './photo-review.css';

export function PhotoReview({ photos, initialPhotoId, context, busy, onClose, onRelink, entrySource, returnLabel = '返回照片墙' }: {
  photos: Photo[]; initialPhotoId: string; context: string; busy: boolean;
  onClose: (visiblePhotoId: string | undefined) => void; onRelink: (photo: Photo) => Promise<void>; entrySource?: ReviewEntrySource; returnLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const infoId = useId();
  const infoScope = useRef<HTMLDivElement>(null);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const infoPanel = useRef<HTMLDivElement>(null);
  const dismissReview = useRef<(() => void) | null>(null);
  const cancelEntry = useRef<(() => void) | undefined>(undefined);
  const stopEntry = useCallback(() => {
    cancelEntry.current?.();
    cancelEntry.current = undefined;
  }, []);
  const [openInfoKey, setOpenInfoKey] = useState<string | null>(null);
  const visibleInfoKey = useRef<string | null>(null);
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
  const snapshotPhoto = photos[index];
  // A replacement can enter the snapshot while the previous image is still on screen.
  const infoPhoto = current && snapshotPhoto?.originalPath === current.originalPath
    && snapshotPhoto.originalAvailable === current.originalAvailable ? snapshotPhoto : undefined;
  const infoKey = infoPhoto ? JSON.stringify([infoPhoto.id, infoPhoto.originalPath, infoPhoto.originalAvailable]) : null;
  const infoOpen = openInfoKey !== null && openInfoKey === infoKey;
  const closeInfo = useCallback(() => { visibleInfoKey.current = null; setOpenInfoKey(null); reveal(); }, []);
  const dismissOutside = useCallback(() => {
    const focusedPanel = infoPanel.current?.contains(document.activeElement);
    closeInfo();
    if (focusedPanel) infoFocusFrame.current = requestAnimationFrame(() => {
      infoFocusFrame.current = null;
      const focused = document.activeElement;
      // Let the outside gesture focus its new control first. Only repair the
      // root/disconnected focus left behind by removing the information panel.
      if (active.current && !visibleInfoKey.current && !dialog.current?.contains(focused)
        && (focused === document.body || focused === document.documentElement || !focused?.isConnected)) stage.current?.focus({ preventScroll: true });
    });
  }, [closeInfo]);
  useDismiss(infoOpen, dismissOutside, infoScope, { escape: false });
  useLayoutEffect(() => {
    if (visibleInfoKey.current && visibleInfoKey.current !== infoKey) {
      if (!dialog.current?.contains(document.activeElement)) stage.current?.focus({ preventScroll: true });
      closeInfo();
    }
  }, [infoKey, closeInfo]);
  useEffect(() => { if (infoOpen) infoPanel.current?.focus({ preventScroll: true }); }, [infoOpen]);
  useLayoutEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const dismissModal = presentModal(element!);
    const dismiss = () => {
      if (dismissReview.current !== dismiss) return;
      dismissReview.current = null;
      stopEntry();
      dismissModal();
      previous?.focus({ preventScroll: true });
    };
    dismissReview.current = dismiss;
    if (entrySource) cancelEntry.current = startReviewEntry(element!, entrySource);
    stage.current?.focus({ preventScroll: true });
    reveal();
    return () => {
      active.current = false;
      if (infoFocusFrame.current !== null) cancelAnimationFrame(infoFocusFrame.current);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      dismiss();
    };
  }, []);
  useLayoutEffect(() => {
    if (!images.current || images.current.kind === 'error') stopEntry();
  }, [images.current]);
  function closeReview() {
    // Close the modal before its parent restores focus to a different photo.
    dismissReview.current?.();
    onClose(images.current?.photo.id);
  }
  function checkIdle() {
    hideTimer.current = null;
    if (!active.current) return;
    const focused = document.activeElement;
    const toolFocus = focused instanceof Element && dialog.current?.contains(focused)
      && focused.closest('.photo-review-header, .photo-review-footer');
    if (visibleInfoKey.current || hoveringTools.current || (toolFocus && document.documentElement.dataset.inputMode === 'keyboard')) return;
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
      stopEntry();
      if (visibleInfoKey.current) {
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
    onCancel={(event) => { event.preventDefault(); if (visibleInfoKey.current) { closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); } else closeReview(); }}
    onKeyDown={(event) => {
      if (visibleInfoKey.current && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); return;
      }
      // Tab's default focus search must see the controls after inert is removed.
      if (event.key === 'Tab') stopEntry();
      if (!visible.current) flushSync(reveal); else reveal();
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); advance(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}>
    <div className="photo-review-header-region" data-tauri-drag-region="deep">
      <header className="photo-review-header" inert={!awake} aria-hidden={!awake} {...toolbarEvents}>
        <div className="photo-review-leading">
          <button type="button" className="text-button photo-review-back" data-tauri-drag-region="false" aria-label={returnLabel} title={returnLabel} onClick={closeReview}><ChevronLeft size={20} data-tauri-drag-region="false" /></button>
          <h2 id={titleId} className="photo-review-title">{name}</h2>
        </div>
        <div className="photo-review-info-scope" ref={infoScope} data-tauri-drag-region="false">
          <button type="button" className="photo-review-info-button" ref={infoTrigger} aria-label="照片信息" title="照片信息" disabled={!infoKey} aria-haspopup="dialog" aria-expanded={infoOpen} aria-controls={infoOpen ? infoId : undefined}
            onClick={() => {
              stopEntry();
              if (visibleInfoKey.current) { closeInfo(); infoTrigger.current?.focus({ preventScroll: true }); }
              else if (infoKey) { visibleInfoKey.current = infoKey; setOpenInfoKey(infoKey); reveal(); }
            }}><Info size={16} data-tauri-drag-region="false" /></button>
          {infoOpen && infoPhoto && <div id={infoId} ref={infoPanel} className="photo-review-info-panel" role="dialog" aria-modal={false} aria-labelledby={`${infoId}-title`} tabIndex={-1} data-tauri-drag-region="false"
            onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}>
            <PhotoReviewInfo photo={infoPhoto} titleId={`${infoId}-title`} />
          </div>}
        </div>
      </header>
    </div>
    <div ref={stage} className="photo-review-stage" tabIndex={-1} aria-label={`${context}，照片预览，左右键切换，Esc 返回`} aria-busy={images.waiting}>
      {current ? <PhotoReviewImage state={images} controller={controller} onRelink={onRelink} busy={busy} onEntryZoom={entrySource ? stopEntry : undefined} /> : <p role="status">当前结果中没有这张照片，请返回照片墙。</p>}
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

import type { Photo } from '../lib/types';

type FrameKind = 'image' | 'thumbnail' | 'error';
export interface ReviewFrame { key: number; photo: Photo; src: string; kind: FrameKind; }
export interface ReviewPresentationState {
  current: ReviewFrame | null; incoming: ReviewFrame | null; outgoing: ReviewFrame | null;
  entering: boolean; direction: number; waiting: boolean;
}
const identity = (photo: Photo) => JSON.stringify([photo.id, photo.originalUrl, photo.originalAvailable]);

// Only detached preload images live here. Eviction never changes a displayed
// DOM image's src; completed resources outside the three-slot window are released.
class ReviewImageCache {
  private entries = new Map<string, { image: HTMLImageElement; pending: boolean; promise: Promise<boolean> }>();
  retain(photos: Photo[]) {
    const keep = new Set(photos.map(identity));
    for (const [key, entry] of this.entries) if (!keep.has(key)) {
      this.entries.delete(key);
      if (entry.pending) entry.image.removeAttribute('src');
    }
  }
  load(photo: Photo) {
    const key = identity(photo), previous = this.entries.get(key);
    if (previous) return previous.promise;
    const image = new Image(); image.decoding = 'async'; image.src = photo.originalUrl;
    const entry = { image, pending: true, promise: Promise.resolve(false) };
    entry.promise = image.decode().then(() => image.naturalWidth > 0, () => false).then((ready) => { entry.pending = false; return ready; });
    this.entries.set(key, entry);
    return entry.promise;
  }
  clear() { this.retain([]); }
  invalidate(photo: Photo) {
    const key = identity(photo), entry = this.entries.get(key);
    if (entry?.pending) entry.image.removeAttribute('src');
    this.entries.delete(key);
  }
}

export class ReviewPresentation {
  state: ReviewPresentationState;
  private cache = new ReviewImageCache();
  private serial = 0;
  private generation = 0;
  private targetKey = '';
  private target: Photo | undefined;
  private photos: Photo[] = [];
  private requestedId: string;
  private reduced = false;
  private disposed = false;
  private loadingTimer: ReturnType<typeof setTimeout> | undefined;
  private transitionTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(initial: Photo | undefined, private publish: (state: ReviewPresentationState) => void) {
    this.requestedId = initial?.id || '';
    this.state = { current: initial && !initial.originalAvailable ? this.frame(initial, 'error')
      : initial?.thumbnailAvailable && initial.thumbnailUrl ? this.frame(initial, 'thumbnail') : null,
    incoming: null, outgoing: null, entering: false, direction: 0, waiting: false };
  }
  private frame(photo: Photo, kind: FrameKind): ReviewFrame {
    return { key: ++this.serial, photo, kind, src: kind === 'thumbnail' ? photo.thumbnailUrl : photo.originalUrl };
  }
  private set(patch: Partial<ReviewPresentationState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.publish(this.state);
  }
  private stopWaiting() { clearTimeout(this.loadingTimer); this.loadingTimer = undefined; }
  private stopTransition() { clearTimeout(this.transitionTimer); this.transitionTimer = undefined; }
  update(photos: Photo[], requestedId: string, direction: number, reduced: boolean) {
    if (this.disposed) return;
    this.photos = photos; this.requestedId = requestedId; this.reduced = reduced;
    const target = photos.find((photo) => photo.id === requestedId);
    const window = target ? [target, photos[photos.indexOf(target) - 1], photos[photos.indexOf(target) + 1]].filter((photo): photo is Photo => !!photo && photo.originalAvailable) : [];
    this.cache.retain(window);
    const exists = (frame: ReviewFrame | null) => !frame || photos.some((photo) => photo.id === frame.photo.id);
    if (!exists(this.state.current) || !exists(this.state.outgoing)) this.set({
      current: exists(this.state.current) ? this.state.current : null,
      outgoing: exists(this.state.outgoing) ? this.state.outgoing : null,
    });
    if (!target) {
      ++this.generation; this.targetKey = ''; this.target = undefined;
      this.stopWaiting(); this.stopTransition();
      if (this.state.current || this.state.incoming || this.state.outgoing || this.state.entering || this.state.waiting) this.set({ current: null, incoming: null, outgoing: null, entering: false, waiting: false });
      return;
    }
    const key = identity(target);
    if (key === this.targetKey) {
      this.target = target;
      if (reduced && (this.state.outgoing || this.state.entering)) { this.stopTransition(); this.set({ outgoing: null, entering: false }); }
      for (const neighbor of window) if (neighbor.id !== target.id) void this.cache.load(neighbor);
      return;
    }
    this.target = target; this.targetKey = key;
    const generation = ++this.generation;
    this.stopWaiting(); this.stopTransition();
    this.set({ incoming: null, outgoing: null, entering: false, waiting: false, direction });
    if (!target.originalAvailable) { this.set({ current: this.frame(target, 'error') }); return; }
    if (this.state.current?.kind === 'image' && identity(this.state.current.photo) === key) return;
    this.loadingTimer = setTimeout(() => { if (this.valid(generation)) this.set({ waiting: true }); }, 350);
    void this.cache.load(target).then((ready) => {
      if (!this.valid(generation)) return;
      if (ready) this.set({ incoming: this.frame(this.target!, 'image') });
      else this.failTarget();
    });
    for (const neighbor of window.slice(1)) void this.cache.load(neighbor);
  }
  private valid(generation: number) { return !this.disposed && generation === this.generation; }
  // Preloading does not prove that the newly mounted DOM image can paint.
  // Keep the current layer above it until THIS image has loaded and decoded.
  async domReady(key: number, image: HTMLImageElement) {
    const generation = this.generation;
    if (this.state.incoming?.key !== key) return;
    try { await image.decode(); if (!image.naturalWidth) throw new Error('empty image'); }
    catch { if (this.valid(generation) && this.state.incoming?.key === key) this.failTarget(); return; }
    if (!this.valid(generation) || this.state.incoming?.key !== key) return;
    const next = this.state.incoming, old = this.state.current;
    this.stopWaiting(); this.stopTransition();
    const animate = !this.reduced && !!old && old.kind !== 'error';
    this.set({ current: next, incoming: null, outgoing: animate ? old : null, entering: animate && this.state.direction !== 0, waiting: false });
    if (animate) this.transitionTimer = setTimeout(() => { if (this.valid(generation)) this.set({ outgoing: null, entering: false }); }, 240);
  }
  domFailed(key: number) {
    if (this.state.incoming?.key === key) { this.failTarget(); return; }
    if (this.state.current?.key !== key) return;
    if (this.state.current.kind === 'image' && this.target && identity(this.state.current.photo) === identity(this.target)) this.failTarget();
    else this.set({ current: null }); // A failed thumbnail never overrides an original request.
  }
  private failTarget() {
    this.stopWaiting(); this.stopTransition();
    this.set({ current: this.target ? this.frame(this.target, 'error') : null, incoming: null, outgoing: null, entering: false, waiting: false });
  }
  retry() {
    if (!this.target || this.disposed) return;
    this.cache.invalidate(this.target); this.targetKey = '';
    this.update(this.photos, this.requestedId, 0, this.reduced);
  }
  dispose() {
    this.disposed = true; ++this.generation;
    this.stopWaiting(); this.stopTransition(); this.cache.clear();
  }
}

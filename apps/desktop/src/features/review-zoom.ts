import type { ReviewFrame } from './review-presentation';

type Pose = { scale: number; x: number; y: number };
type Layer = { frame: ReviewFrame; element: HTMLElement };
type Geometry = { rect: DOMRect; width: number; height: number };
const identity = (frame: ReviewFrame) => JSON.stringify([frame.photo.id, frame.photo.originalUrl]);
const fit = (): Pose => ({ scale: 1, x: 0, y: 0 });

// A single preview's input/geometry owner. It only transforms inner image layers;
// the outer frames continue to own the 240ms navigation animation.
export class ReviewZoom {
  private viewport: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private onEntryZoom: (() => void) | undefined;
  private layers = new Map<number, Layer>();
  private poses = new Map<string, Pose>();
  private active: number | null = null;
  private activeIdentity = '';
  private drag: { id: number; key: number; x: number; y: number; pose: Pose; moved: boolean } | null = null;
  private suppressDoubleClickUntil = 0;
  private reduced = false;
  private interruptedTarget: { scale: number; until: number } | null = null;
  private animation: { handle: number; key: string; from: Pose; to: Pose; start: number } | null = null;
  private wheelMotion: { handle: number; key: string; scale: number; direction: number; x: number; y: number; last: number; deadline: number } | null = null;
  register(frame: ReviewFrame, element: HTMLElement | null) {
    if (element) { this.layers.set(frame.key, { frame, element }); this.draw(); }
    else this.layers.delete(frame.key);
  }
  imageLoaded(key: number) { if (this.layers.has(key)) this.draw(); }
  reset() {
    this.stopWheel(); this.stopAnimation(); this.finishDrag();
    if (this.activeIdentity) this.poses.set(this.activeIdentity, fit());
    this.draw();
  }
  update(frames: ReviewFrame[], current: ReviewFrame | null, reduced = false) {
    const keys = new Set(frames.map((frame) => frame.key));
    const identities = new Set(frames.filter((frame) => frame.kind !== 'error').map(identity));
    for (const key of this.layers.keys()) if (!keys.has(key)) this.layers.delete(key);
    for (const key of this.poses.keys()) if (!identities.has(key)) this.poses.delete(key);
    const next = current && current.kind !== 'error' ? identity(current) : '';
    if (next !== this.activeIdentity) {
      this.stopWheel(); this.stopAnimation(); this.finishDrag(); this.suppressDoubleClickUntil = 0;
      if (next) this.poses.set(next, fit());
    } else if (this.drag && current) this.drag.key = current.key;
    if (reduced && this.animation) {
      this.poses.set(this.animation.key, this.animation.to); this.stopAnimation();
    }
    if (reduced && this.wheelMotion) this.advanceWheel(this.wheelMotion.deadline);
    this.reduced = reduced;
    this.activeIdentity = next; this.active = next && current ? current.key : null;
    this.draw();
  }
  attach(viewport: HTMLElement, onEntryZoom?: () => void) {
    this.viewport = viewport;
    this.onEntryZoom = onEntryZoom;
    viewport.addEventListener('wheel', this.wheel, { passive: false });
    viewport.addEventListener('pointerdown', this.down);
    viewport.addEventListener('pointermove', this.move);
    viewport.addEventListener('pointerup', this.up);
    viewport.addEventListener('pointercancel', this.cancel);
    viewport.addEventListener('lostpointercapture', this.cancel);
    viewport.addEventListener('dblclick', this.doubleClick);
    this.observer = new ResizeObserver(() => { this.stopWheel(); this.stopAnimation(); this.finishDrag(); this.draw(); });
    this.observer.observe(viewport); this.draw();
  }
  detach() {
    this.stopWheel(); this.stopAnimation(); this.finishDrag(); this.observer?.disconnect(); this.observer = null;
    this.onEntryZoom = undefined;
    const viewport = this.viewport; this.viewport = null;
    if (!viewport) return;
    viewport.removeEventListener('wheel', this.wheel);
    viewport.removeEventListener('pointerdown', this.down);
    viewport.removeEventListener('pointermove', this.move);
    viewport.removeEventListener('pointerup', this.up);
    viewport.removeEventListener('pointercancel', this.cancel);
    viewport.removeEventListener('lostpointercapture', this.cancel);
    viewport.removeEventListener('dblclick', this.doubleClick);
  }
  private pose(frame: ReviewFrame) {
    const key = identity(frame); let pose = this.poses.get(key);
    if (!pose) { pose = fit(); this.poses.set(key, pose); }
    return pose;
  }
  private geometry(layer: Layer) {
    const rect = layer.element.parentElement!.getBoundingClientRect();
    const image = layer.element.querySelector('img');
    const width = image?.naturalWidth || layer.frame.photo.width, height = image?.naturalHeight || layer.frame.photo.height;
    const factor = Math.min(rect.width / width, rect.height / height);
    return { rect, width: width * factor, height: height * factor };
  }
  private clamp(geometry: Geometry, pose: Pose): Pose {
    const { rect, width, height } = geometry;
    const scale = Math.max(1, Math.min(8, pose.scale));
    const boundX = Math.max(0, (width * scale - rect.width) / 2), boundY = Math.max(0, (height * scale - rect.height) / 2);
    return { scale, x: Math.max(-boundX, Math.min(boundX, pose.x)), y: Math.max(-boundY, Math.min(boundY, pose.y)) };
  }
  private hit(x: number, y: number) {
    const layer = this.active === null ? undefined : this.layers.get(this.active);
    if (!layer || !this.viewport) return null;
    const view = this.viewport.getBoundingClientRect(), geometry = this.geometry(layer), { rect, width, height } = geometry, pose = this.pose(layer.frame);
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) return null;
    const localX = x - rect.left - rect.width / 2, localY = y - rect.top - rect.height / 2;
    return Math.abs(localX - pose.x) <= width * pose.scale / 2 && Math.abs(localY - pose.y) <= height * pose.scale / 2
      ? { layer, geometry, pose, x: localX, y: localY } : null;
  }
  private zoomHit(x: number, y: number) {
    const hit = this.hit(x, y);
    const viewport = this.viewport;
    if (!hit || !this.onEntryZoom || !viewport?.closest('[data-entering-from-wall]')) return hit;
    // Hit test the moving photo before cancelling; the browser also accounts
    // for the scroll clip transferred from a partially visible wall tile.
    if (!viewport.contains(document.elementFromPoint(x, y))) return null;
    this.onEntryZoom();
    const geometry = this.geometry(hit.layer);
    return { ...hit, geometry, x: hit.x / hit.geometry.width * geometry.width, y: hit.y / hit.geometry.height * geometry.height };
  }
  private draw(measured?: { layer: Layer; geometry: Geometry }) {
    if (!this.viewport) return;
    // Measure all frame geometry before writing transforms; reuse the input hit's snapshot.
    const snapshots = Array.from(this.layers.values(), (layer) => ({ layer,
      pose: this.clamp(measured?.layer === layer ? measured.geometry : this.geometry(layer), this.pose(layer.frame)),
    }));
    for (const { layer, pose } of snapshots) {
      this.poses.set(identity(layer.frame), pose);
      layer.element.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) scale(${pose.scale})`;
      layer.element.parentElement!.dataset.zoomed = String(pose.scale > 1);
    }
    const current = this.active === null ? undefined : this.layers.get(this.active);
    this.viewport.dataset.zoomed = String(!!current && this.pose(current.frame).scale > 1);
    this.viewport.dataset.dragging = String(!!this.drag);
    this.viewport.style.cursor = this.drag ? 'grabbing' : current && this.pose(current.frame).scale > 1 ? 'grab' : '';
  }
  private target(hit: NonNullable<ReturnType<ReviewZoom['hit']>>, scale: number) {
    const next = Math.max(1, Math.min(8, scale)), ratio = next / hit.pose.scale;
    return next === 1 ? fit() : this.clamp(hit.geometry, {
      scale: next, x: hit.x - (hit.x - hit.pose.x) * ratio, y: hit.y - (hit.y - hit.pose.y) * ratio,
    });
  }
  private stopAnimation(keepDoubleClickTarget = false) {
    if (!keepDoubleClickTarget) this.interruptedTarget = null;
    if (this.animation) cancelAnimationFrame(this.animation.handle);
    this.animation = null;
  }
  private animate(hit: NonNullable<ReturnType<ReviewZoom['hit']>>, scale: number) {
    this.stopAnimation();
    const key = identity(hit.layer.frame), to = this.target(hit, scale);
    if (this.reduced) { this.poses.set(key, to); this.draw(hit); return; }
    const animation = { handle: 0, key, from: { ...hit.pose }, to, start: performance.now() };
    this.animation = animation;
    const tick = (time: number) => {
      if (this.animation !== animation) return;
      const t = Math.max(0, Math.min(1, (time - animation.start) / 240));
      const eased = 1 - (1 - t) ** 3;
      this.poses.set(key, { scale: animation.from.scale + (to.scale - animation.from.scale) * eased,
        x: animation.from.x + (to.x - animation.from.x) * eased, y: animation.from.y + (to.y - animation.from.y) * eased });
      this.draw();
      if (t < 1) animation.handle = requestAnimationFrame(tick);
      else this.animation = null;
    };
    animation.handle = requestAnimationFrame(tick);
  }
  private stopWheel() {
    if (this.wheelMotion) cancelAnimationFrame(this.wheelMotion.handle);
    this.wheelMotion = null;
  }
  private advanceWheel(time: number, measured?: { layer: Layer; geometry: Geometry }) {
    const motion = this.wheelMotion;
    const layer = this.active === null ? undefined : this.layers.get(this.active);
    if (!motion || !layer || identity(layer.frame) !== motion.key) { this.stopWheel(); return; }
    const geometry = measured?.layer === layer ? measured.geometry : this.geometry(layer), { rect } = geometry, pose = this.pose(layer.frame);
    // A finite exponential response: 40ms time constant, exact arrival within
    // 100ms of the latest input. No velocity or queued per-event animations.
    const remaining = motion.deadline - motion.last, dt = Math.max(0, Math.min(time - motion.last, remaining));
    const fraction = remaining <= 0 ? 1 : (1 - Math.exp(-dt / 40)) / (1 - Math.exp(-remaining / 40));
    const next = Math.exp(Math.log(pose.scale) + (Math.log(motion.scale) - Math.log(pose.scale)) * fraction);
    const done = time >= motion.deadline || Math.abs(Math.log(motion.scale / next)) < .0001;
    const scale = done ? motion.scale : next;
    this.poses.set(motion.key, this.target({ layer, geometry, pose,
      x: motion.x - rect.left - rect.width / 2, y: motion.y - rect.top - rect.height / 2 }, scale));
    this.draw({ layer, geometry }); motion.last = time;
    if (done) this.stopWheel();
  }
  private scheduleWheel() {
    const motion = this.wheelMotion;
    if (motion) motion.handle = requestAnimationFrame((time) => {
      if (this.wheelMotion !== motion) return;
      this.advanceWheel(time); this.scheduleWheel();
    });
  }
  private wheel = (event: WheelEvent) => {
    if (!event.deltaY) return;
    const hit = this.zoomHit(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    this.stopAnimation(); this.finishDrag();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport!.clientHeight : 1;
    const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
    if (this.reduced) {
      this.poses.set(identity(hit.layer.frame), this.target(hit, hit.pose.scale * Math.exp(-delta * .006))); this.draw(hit); return;
    }
    const { rect } = hit.geometry;
    const x = rect.left + rect.width / 2 + hit.x, y = rect.top + rect.height / 2 + hit.y;
    const time = performance.now(), direction = Math.sign(-delta), previous = this.wheelMotion;
    const reverse = !!previous && previous.direction !== direction;
    const scale = Math.max(1, Math.min(8, (previous && !reverse ? previous.scale : hit.pose.scale) * Math.exp(-delta * .006)));
    if (previous) {
      previous.scale = scale; previous.direction = direction; previous.x = x; previous.y = y; previous.deadline = time + 100;
      // Reversal discards the old outstanding distance and responds this event.
      if (reverse) { previous.last = time - 8; this.advanceWheel(time, hit); }
    } else {
      this.wheelMotion = { handle: 0, key: identity(hit.layer.frame), scale, direction,
        x, y, last: time - 8, deadline: time + 100 };
      this.advanceWheel(time, hit); this.scheduleWheel();
    }
  };
  private down = (event: PointerEvent) => {
    const hit = this.hit(event.clientX, event.clientY);
    if (event.button !== 0 || !hit || this.drag) return;
    this.stopWheel();
    // A second double-click's pointerdowns arrive before dblclick. Preserve the
    // interrupted destination briefly so restoring→double-click reverses to 2x.
    if (this.animation) this.interruptedTarget = { scale: this.animation.to.scale, until: performance.now() + 500 };
    this.stopAnimation(true);
    if (hit.pose.scale <= 1) return;
    event.preventDefault();
    this.drag = { id: event.pointerId, key: hit.layer.frame.key, x: event.clientX, y: event.clientY, pose: { ...hit.pose }, moved: false };
    this.viewport!.setPointerCapture(event.pointerId); this.draw(hit);
  };
  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!this.viewport) return;
    if (!drag) {
      const hit = this.hit(event.clientX, event.clientY);
      this.viewport.style.cursor = hit ? hit.pose.scale > 1 ? 'grab' : 'zoom-in' : '';
      return;
    }
    if (event.pointerId !== drag.id) return;
    const layer = this.layers.get(drag.key); if (!layer) { this.finishDrag(); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) { drag.moved = true; this.interruptedTarget = null; }
    event.preventDefault();
    this.poses.set(identity(layer.frame), { ...drag.pose, x: drag.pose.x + dx, y: drag.pose.y + dy }); this.draw();
  };
  private finishDrag() {
    const drag = this.drag; this.drag = null;
    if (drag?.moved) this.suppressDoubleClickUntil = Date.now() + 300;
    if (drag && this.viewport?.hasPointerCapture(drag.id)) this.viewport.releasePointerCapture(drag.id);
    if (this.viewport) this.viewport.dataset.dragging = 'false';
  }
  private up = (event: PointerEvent) => { if (event.pointerId === this.drag?.id) { this.finishDrag(); this.draw(); } };
  private cancel = (event: PointerEvent) => { if (event.pointerId === this.drag?.id) { this.finishDrag(); this.draw(); } };
  private doubleClick = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const hit = this.zoomHit(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    if (Date.now() < this.suppressDoubleClickUntil) return;
    const pendingTarget = this.animation?.to.scale ?? (this.interruptedTarget && performance.now() < this.interruptedTarget.until ? this.interruptedTarget.scale : null);
    const target = pendingTarget !== null ? pendingTarget === 1 ? 2 : 1 : hit.pose.scale > 1 ? 1 : 2;
    this.stopWheel(); this.finishDrag(); this.animate(hit, target);
  };
}

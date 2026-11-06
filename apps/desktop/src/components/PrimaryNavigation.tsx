import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { animate, useMotionValue } from 'motion/react';

type TabBounds = { left: number; top: number; width: number; height: number };
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

function getReducedMotion() {
  return window.matchMedia(reducedMotionQuery).matches;
}

/** App navigation stays native buttons; the moving surface is only decoration. */
export function PrimaryNavigation<Value extends string>({ items, value, durationMs, onChange }: {
  items: readonly { id: Value; label: string }[];
  value: Value;
  durationMs: number;
  onChange: (value: Value) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const lastValue = useRef<Value | null>(null);
  const baseWidth = useRef(0);
  const leftEdge = useMotionValue(0);
  const rightEdge = useMotionValue(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion);
  const selectedIndex = items.findIndex((item) => item.id === value);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill || selectedIndex < 0 || reducedMotion) {
      nav?.removeAttribute('data-liquid-ready');
      lastValue.current = null;
      return;
    }
    let disposed = false;
    let frame = 0;
    let scaleX = 1;
    let scaleY = 1;
    let controls: { stop: () => void }[] = [];
    const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'));
    const labels = Array.from(nav.querySelectorAll<HTMLSpanElement>('[data-liquid-label]'));

    function measure() {
      const bounds = nav!.getBoundingClientRect();
      const tabs = buttons.map((button): TabBounds => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left - bounds.left - nav!.clientLeft, top: rect.top - bounds.top - nav!.clientTop, width: rect.width, height: rect.height };
      });
      return { tabs, signature: tabs.map((tab) => `${tab.left}:${tab.top}:${tab.width}:${tab.height}`).join('|') };
    }
    let geometry = measure();

    function updateShape() {
      const width = baseWidth.current;
      if (!width) return;
      const left = leftEdge.get();
      const right = rightEdge.get();
      const stretch = Math.max(1, right - left) / width;
      // Independent edges pull the head forward before the tail catches up.
      // Keep drawing on transforms; button geometry and label text never scale.
      scaleX = stretch;
      scaleY = Math.min(1, Math.max(.91, Math.pow(stretch, -.18)));
      // One DOM writer owns this transform, including the final selected state.
      // Mixing a manual snap with Motion's render queue can restore a stale
      // transform in WKWebView after the content has already changed.
      pill!.style.transform = `translateX(${(left + right - width) / 2}px) scale(${scaleX}, ${scaleY})`;
    }
    const unsubscribeLeft = leftEdge.on('change', updateShape);
    const unsubscribeRight = rightEdge.on('change', updateShape);

    function stop() {
      controls.forEach((control) => control.stop());
      controls = [];
      cancelAnimationFrame(frame);
      frame = 0;
    }
    function clipLabels() {
      // Batch every geometry read before the clip writes; no per-label reflow loop.
      const surface = pill!.getBoundingClientRect();
      const rows = labels.map((label) => ({ label, bounds: label.getBoundingClientRect() }));
      const radiusX = geometry.tabs[selectedIndex].height / 2 * scaleX;
      const radiusY = geometry.tabs[selectedIndex].height / 2 * scaleY;
      for (const { label, bounds } of rows) {
        const overlaps = surface.right > bounds.left && surface.left < bounds.right && surface.bottom > bounds.top && surface.top < bounds.bottom;
        label.style.clipPath = overlaps
          ? `inset(${surface.top - bounds.top}px ${bounds.right - surface.right}px ${bounds.bottom - surface.bottom}px ${surface.left - bounds.left}px round ${radiusX}px / ${radiusY}px)`
          : 'inset(0 100% 0 0)';
      }
    }
    function snap(target: TabBounds) {
      baseWidth.current = target.width;
      leftEdge.set(target.left);
      rightEdge.set(target.left + target.width);
      scaleX = 1;
      scaleY = 1;
      pill!.style.width = `${target.width}px`;
      pill!.style.height = `${target.height}px`;
      pill!.style.top = `${target.top}px`;
      // Apply the measured first frame synchronously; never wait for Motion to show it.
      pill!.style.transform = `translateX(${target.left}px) scale(1, 1)`;
      nav!.dataset.liquidReady = 'true';
      clipLabels();
    }
    function tick() {
      if (disposed) return;
      clipLabels();
      frame = requestAnimationFrame(tick);
    }
    const target = geometry.tabs[selectedIndex];
    const moving = lastValue.current !== null && lastValue.current !== value && nav.dataset.liquidReady === 'true';
    lastValue.current = value;
    if (!moving) {
      snap(target);
    } else {
      const movingRight = target.left + target.width / 2 >= (leftEdge.get() + rightEdge.get()) / 2;
      const frontEase = [.20, .65, .25, 1] as const;
      const tailEase = [.44, .08, .34, 1] as const;
      const duration = durationMs / 1000;
      let completed = 0;
      const finish = () => {
        if (!disposed && ++completed === 2) { stop(); snap(geometry.tabs[selectedIndex]); }
      };
      pill.style.top = `${target.top}px`;
      controls = [
        animate(leftEdge, target.left, { duration, ease: movingRight ? tailEase : frontEase, onComplete: finish }),
        animate(rightEdge, target.left + target.width, { duration, ease: movingRight ? frontEase : tailEase, onComplete: finish }),
      ];
      frame = requestAnimationFrame(tick);
    }

    function align() {
      stop();
      geometry = measure();
      snap(geometry.tabs[selectedIndex]);
    }
    const observer = new ResizeObserver(() => {
      const next = measure();
      // A new observer's initial delivery must not cancel a just-started slide.
      if (next.signature === geometry.signature) return;
      stop();
      geometry = next;
      snap(geometry.tabs[selectedIndex]);
    });
    observer.observe(nav);
    buttons.forEach((button) => observer.observe(button));
    window.addEventListener('resize', align);
    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      unsubscribeLeft();
      unsubscribeRight();
      window.removeEventListener('resize', align);
    };
  }, [items, value, selectedIndex, durationMs, reducedMotion, leftEdge, rightEdge]);

  return <nav ref={navRef} className="primary-navigation" aria-label="工作区">
    {selectedIndex >= 0 && !reducedMotion && <span ref={pillRef} className="navigation-liquid-pill" aria-hidden="true" />}
    {items.map((item) => <button type="button" key={item.id} className={value === item.id ? 'current' : ''} aria-current={value === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
      <span>{item.label}</span>
      <span className="navigation-liquid-label" data-liquid-label aria-hidden="true" style={{ clipPath: 'inset(0 100% 0 0)' }}>{item.label}</span>
    </button>)}
  </nav>;
}

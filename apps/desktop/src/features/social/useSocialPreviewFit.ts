import { useLayoutEffect, useRef, useState } from 'react';
import type { SocialPlatform } from '../../lib/social-types';

/** Measure the actual platform paper; only very long content needs local scrolling. */
export function useSocialPreviewFit(platform: SocialPlatform) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ width: 340, height: 0, scale: 1 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const paper = paperRef.current;
    if (!viewport || !paper) return;
    const measure = () => {
      const availableWidth = Math.max(1, viewport.clientWidth - 8);
      const availableHeight = Math.max(1, viewport.clientHeight - 8);
      // A smaller natural carousel keeps controls and short captions on-screen
      // at compact window heights without squeezing the platform's image ratio.
      const width = Math.min(availableWidth, platform === 'moments' ? 520 : Math.max(270, Math.min(420, (availableHeight - 155) * .8)));
      paper.style.width = `${width}px`;
      const height = Math.ceil(parseFloat(getComputedStyle(paper).height));
      const scale = Math.min(1, Math.max(.85, availableHeight / Math.max(1, height)));
      setFit((previous) => previous.width === width && previous.height === height && previous.scale === scale ? previous : { width, height, scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(paper);
    measure();
    return () => observer.disconnect();
  }, [platform]);
  return { viewportRef, paperRef, fit };
}

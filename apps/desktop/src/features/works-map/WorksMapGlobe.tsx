import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { geoOrthographic, geoPath } from 'd3-geo';
import { drawWorksMapGlobe, prepareWorksMapGlobe } from './works-map-globe';
import { worksMapDrawingBounds, type MapRect, type WorksMapView } from './works-map-layout';
import type { WorksMapRegionData } from './works-map-regions';

export type WorksMapAtlas = { basemap: { land: string; lakes: string }; regionData: WorksMapRegionData };

const colors = {
  landFill: '#d9d9dc30',
  coastStroke: '#e5e5e729',
  lakeStroke: '#d5d5d721',
  boundaryStroke: '#dedee01c',
  selectedFill: '#e6eaef1a',
  selectedStroke: '#e5e9ee76',
  graticuleStroke: '#d8d8da0d',
};

const loadingGuides = {
  type: 'MultiLineString' as const,
  coordinates: [
    ...[-150, -90, -30, 30, 90, 150].map(lon => [[lon, -90], [lon, 0], [lon, 90]]),
    ...[-26, 28].map(lat => Array.from({ length: 61 }, (_, index) => [-180 + index * 6, lat])),
  ],
};
const loadingYaw = -9;
const loadingSpeed = (elapsed: number) => 30 + 38 * Math.exp(-elapsed / 265);
const handoffSpinDuration = 180;
const handoffFadeDuration = 200;
const createLoadingProjection = () => geoOrthographic()
  .translate([50, 50]).scale(49.7).clipAngle(90).precision(.12).rotate([loadingYaw, -14, -12]);
const stillLoadingGuides = geoPath(createLoadingProjection()).digits(2)(loadingGuides) ?? '';

function LoadingGraticule({ loading }: { loading: boolean }) {
  const guides = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const pose = useRef({ longitude: 0, loadingElapsed: 0 });

  useLayoutEffect(() => {
    const overlay = guides.current;
    const element = path.current;
    if (!overlay || !element) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const projection = createLoadingProjection();
    const draw = geoPath(projection).digits(2);
    const motion = pose.current;
    const releaseSpeed = loadingSpeed(motion.loadingElapsed);
    const fade = !loading && !preference.matches ? overlay.animate([
      { opacity: 1, visibility: 'visible' },
      { opacity: 0, visibility: 'visible' },
    ], { duration: handoffFadeDuration, easing: 'ease-out', fill: 'backwards' }) : undefined;
    let frame = 0;
    let previousTime: number | undefined;
    let handoffElapsed = 0;

    function rotate(now: number) {
      frame = 0;
      // Start each phase at its first animation frame, excluding synchronous canvas preparation.
      const elapsed = previousTime === undefined ? 0 : Math.max(0, now - previousTime);
      previousTime = now;
      const step = loading ? Math.min(elapsed, 33)
        : Math.min(elapsed, 1000 / 60, handoffSpinDuration - handoffElapsed);
      const speed = loading ? loadingSpeed(motion.loadingElapsed + step / 2)
        : releaseSpeed * (1 - (handoffElapsed + step / 2) / handoffSpinDuration);
      motion.longitude = (motion.longitude + step * speed / 1000) % 360;
      if (loading) motion.loadingElapsed += step;
      else handoffElapsed += step;
      projection.rotate([loadingYaw - motion.longitude, -14, -12]);
      element?.setAttribute('d', draw(loadingGuides) ?? '');
      if (loading || (handoffElapsed < handoffSpinDuration && fade?.playState === 'running')) frame = requestAnimationFrame(rotate);
    }
    function syncMotion() {
      if (preference.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        previousTime = undefined;
        fade?.cancel();
      } else if (!frame && (loading || fade?.playState === 'running')) {
        frame = requestAnimationFrame(rotate);
      }
    }
    syncMotion();
    preference.addEventListener('change', syncMotion);
    return () => {
      cancelAnimationFrame(frame);
      fade?.cancel();
      preference.removeEventListener('change', syncMotion);
    };
  }, [loading]);

  return <svg ref={guides} className="works-map-globe-placeholder" viewBox="0 0 100 100">
    <path ref={path} d={stillLoadingGuides} vectorEffect="non-scaling-stroke" />
  </svg>;
}

export const WorksMapGlobe = memo(function WorksMapGlobe({ atlas, selectedRegionId, view, map, globe, visibleRadius }: {
  atlas: WorksMapAtlas | null;
  selectedRegionId?: string;
  view: WorksMapView;
  map: MapRect;
  globe: MapRect;
  visibleRadius: number;
}) {
  const detail = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const blurredCanvas = useRef<HTMLCanvasElement>(null);
  const geometry = useMemo(() => atlas && prepareWorksMapGlobe(atlas.basemap, atlas.regionData.boundaries), [atlas]);
  const selectedOutline = useMemo(() => selectedRegionId ? atlas?.regionData.outline(selectedRegionId) : undefined,
    [atlas, selectedRegionId]);
  const pixelRatio = window.devicePixelRatio || 1;
  const drawing = useMemo(() => worksMapDrawingBounds(view, map), [view, map]);
  const feather = Math.min(view.scale - visibleRadius, 20, Math.max(12, visibleRadius * .072));
  const edgeStart = visibleRadius - feather;
  const blurStart = Math.max(0, edgeStart - Math.min(3, feather * .25));
  const blurEnd = edgeStart + feather * .42;
  const softEdge = feather > 0;
  const fade = softEdge ? `radial-gradient(circle, #000 ${edgeStart}px, #000d ${edgeStart + feather * .25}px, #0004 ${edgeStart + feather * .75}px, transparent ${visibleRadius}px)` : undefined;
  const sharpMask = softEdge ? `radial-gradient(circle, #000 ${blurStart}px, transparent ${blurEnd}px)` : undefined;
  const blurMask = softEdge ? `radial-gradient(circle, transparent ${blurStart}px, #000 ${blurEnd}px)` : undefined;
  const canvasSize = { width: Math.ceil(drawing.width * pixelRatio), height: Math.ceil(drawing.height * pixelRatio) };

  useEffect(() => {
    if (!geometry) return;
    // Keep the finer paths out of the first reveal for the overview.
    let disposed = false;
    let cancel: (() => void) | undefined;
    const prepareDetail = () => { void geometry.detailed; };
    function schedule() {
      if (disposed) return;
      if (window.requestIdleCallback) {
        const id = window.requestIdleCallback(prepareDetail, { timeout: 200 });
        cancel = () => window.cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(prepareDetail, 16);
        cancel = () => window.clearTimeout(id);
      }
    }
    const arrival = detail.current?.getAnimations()[0];
    if (arrival) void arrival.finished.then(schedule, schedule);
    else schedule();
    return () => { disposed = true; cancel?.(); };
  }, [geometry]);

  useLayoutEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || !geometry) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, -drawing.x * pixelRatio, -drawing.y * pixelRatio);
    drawWorksMapGlobe(context, geometry, view, map, colors, selectedOutline);
    const blur = blurredCanvas.current?.getContext('2d');
    if (blur) {
      blur.clearRect(0, 0, element.width, element.height);
      blur.drawImage(element, 0, 0);
    }
  }, [drawing, geometry, map, pixelRatio, selectedOutline, view]);

  return <div className="works-map-globe" aria-hidden="true" data-loading={!atlas || undefined} style={{
    left: drawing.x, top: drawing.y, width: drawing.width, height: drawing.height,
    clipPath: softEdge ? `circle(${visibleRadius}px)` : undefined,
    maskImage: fade, WebkitMaskImage: fade,
  }}>
    <div className="works-map-globe-surface" style={{ left: globe.x - drawing.x, top: globe.y - drawing.y, width: globe.width, height: globe.height }}>
      <LoadingGraticule loading={!atlas} />
    </div>
    {geometry && <div ref={detail} className="works-map-globe-detail" style={{ '--works-map-radius': `${visibleRadius}px` } as CSSProperties}>
      <canvas ref={canvas} {...canvasSize} style={{ maskImage: sharpMask, WebkitMaskImage: sharpMask }} />
      {softEdge && <canvas ref={blurredCanvas} className="works-map-globe-blur" {...canvasSize}
        style={{ maskImage: blurMask, WebkitMaskImage: blurMask }} />}
    </div>}
  </div>;
});

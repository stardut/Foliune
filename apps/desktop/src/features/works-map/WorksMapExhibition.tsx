import { getLocale, photoCount, t } from '../../lib/i18n';
import { LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DropdownMenu } from '../../components/DropdownMenu';
import { PhotoImage } from '../../components/PhotoImage';
import { IconButton } from '../../components/ui';
import type { Photo } from '../../lib/types';
import { PhotoReview } from '../PhotoReview';
import { useWorksMapPhotoDock } from './use-works-map-photo-dock';
import { useWorksMapView } from './use-works-map-view';
import { WorksMapGlobe, type WorksMapAtlas } from './WorksMapGlobe';
import {
  centerWorksMapView, createWorksMapFrame, fitWorksMapView, interpolateWorksMapLayout, layoutWorksMap, previewWorksMapCard,
  projectWorksMapCoordinate, selectWorksMapRegions,
  worksMapGlobeBounds, worksMapVisibleCircle,
  type MapPoint, type MapRect, type WorksMapCard, type WorksMapRegionGroup,
} from './works-map-layout';

type Review = { id: string; regionId: string; trigger: HTMLButtonElement };
type GroupSelection = { trigger?: HTMLButtonElement; keyboard: boolean };
const PIN_HIT_SIZE = 28;
const PIN_RADIUS = 4;
const PIN_HALO_RADIUS = 6;
const PIN_VISUAL_GAP = 0.9;
const PRINT_HOVER_TRANSFER_MS = 650;
const PRINT_ROUTE_MS = 450;
const REGION_BUTTONS = '.works-map-pin, .works-map-print';

function rectStyle({ x, y, width, height }: MapRect) {
  return { left: x, top: y, width, height };
}

export function WorksMapExhibition({ regions: overview, atlas, onReviewChange }: {
  regions: WorksMapRegionGroup<Photo>[];
  atlas: WorksMapAtlas | null;
  onReviewChange: (open: boolean) => void;
}) {
  const exhibition = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const groupId = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<{ id: string; trigger: HTMLButtonElement; keyboard: boolean }>();
  const [skipPrintArrival, setSkipPrintArrival] = useState(false);
  const [review, setReview] = useState<Review>();
  const selection = useRef<GroupSelection>(null);
  const pendingSelection = useRef(false);
  const hoverTransfer = useRef<{ timer: number; started: number; candidate?: string }>(null);
  const restoreFocus = useRef<{ trigger?: HTMLButtonElement; regionId?: string }>(null);

  useLayoutEffect(() => {
    const element = stage.current!;
    function measure() {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    onReviewChange(!!review);
    return () => { if (review) onReviewChange(false); };
  }, [review, onReviewChange]);
  useEffect(() => () => window.clearTimeout(hoverTransfer.current?.timer), []);

  const frame = useMemo(() => size.width && size.height ? createWorksMapFrame(size.width, size.height) : undefined, [size]);
  const coordinates = useMemo(() => overview.map(({ representative }) => representative.coordinate), [overview]);
  const camera = useWorksMapView(coordinates, atlas ? frame?.map : undefined, stage);
  const { view, dragOrigin, zoomTransition } = camera;
  const lastRegions = useRef<{ overview: typeof overview; displayed: ReturnType<typeof selectWorksMapRegions<Photo>> }>(null);
  const groupingView = dragOrigin ?? zoomTransition?.start ?? view;
  const keepGroups = !!(dragOrigin || zoomTransition || selectedId || focused || restoreFocus.current?.regionId);
  const displayed = useMemo(() => {
    // Keep the same groups throughout a gesture and while their photos or keyboard focus are active.
    if (keepGroups && lastRegions.current?.overview === overview) return lastRegions.current.displayed;
    return frame && groupingView ? selectWorksMapRegions(overview, frame, groupingView) : { groups: overview, menuOnly: [] };
  }, [frame, groupingView, keepGroups, overview]);
  useLayoutEffect(() => { lastRegions.current = { overview, displayed }; }, [overview, displayed]);
  const { groups: regions, menuOnly } = displayed;
  const regionsById = useMemo(() => new Map([...regions, ...menuOnly].map((region) => [region.id, region])), [regions, menuOnly]);
  const qualifiersByName = useMemo(() => {
    const qualifiers = new Map<string, Set<string>>();
    for (const { name, country, parentName } of regionsById.values()) {
      const qualifier = parentName ?? country;
      const known = qualifiers.get(name);
      if (known) known.add(qualifier);
      else qualifiers.set(name, new Set([qualifier]));
    }
    return qualifiers;
  }, [regionsById]);
  const displayView = useMemo(() => view ?? (frame && fitWorksMapView([], frame.map)), [frame, view]);
  const globe = useMemo(() => frame && displayView && worksMapGlobeBounds(displayView, frame.map), [frame, displayView]);
  const visible = frame && view && worksMapVisibleCircle(view, frame.map);
  const globeClipId = `${groupId}-globe`;
  const layoutView = dragOrigin ?? view;
  const layoutAt = useCallback((position: typeof view) =>
    frame && position ? layoutWorksMap(regions, frame, position) : undefined, [frame, regions]);
  const currentLayout = useMemo(() => !zoomTransition ? layoutAt(layoutView) : undefined, [layoutAt, layoutView, zoomTransition]);
  const lastLayout = useRef({ frame, regions, layout: currentLayout });
  const transitionLayouts = useMemo(() => {
    if (!zoomTransition) return undefined;
    return { start: lastLayout.current.layout, target: layoutAt(zoomTransition.target) };
  }, [layoutAt, zoomTransition]);
  const layout = useMemo(() => {
    if (dragOrigin && lastLayout.current.frame === frame && lastLayout.current.regions === regions) {
      return lastLayout.current.layout ?? currentLayout;
    }
    if (!frame || !view || !zoomTransition || !transitionLayouts?.start
      || !transitionLayouts.target) return currentLayout ?? layoutAt(view);
    const { start, target } = zoomTransition;
    const progress = (view.scale - start.scale) / (target.scale - start.scale);
    return interpolateWorksMapLayout(transitionLayouts.start, transitionLayouts.target, regions, frame, view, progress);
  }, [currentLayout, dragOrigin, frame, layoutAt, regions, transitionLayouts, view, zoomTransition]);
  useLayoutEffect(() => { lastLayout.current = { frame, regions, layout }; }, [frame, layout, regions]);
  const pinAreas = useMemo(() => {
    const markers = layout?.markers ?? [];
    const points = markers.map(({ point }) => point);
    return new Map(markers.map(({ group, point }, index) => {
      const half = PIN_HIT_SIZE / 2;
      const hit = clipPinArea(point, points, half);
      const visible = clipPinArea(point, points, PIN_HALO_RADIUS + 1, PIN_VISUAL_GAP);
      return [group.id, {
        hit: hit && `polygon(${hit.map(({ x, y }) => `${(x + half).toFixed(3)}px ${(y + half).toFixed(3)}px`).join(',')})`,
        visible: visible && visible.map(({ x, y }) => `${(x + point.x).toFixed(3)},${(y + point.y).toFixed(3)}`).join(' '),
        clipId: `${groupId}-pin-${index}`,
      }];
    }));
  }, [groupId, layout]);
  const baseCardsByRegion = useMemo(() => new Map(layout?.cards.map((card) => [card.regionId, card])), [layout]);
  const keyboardFocus = focused?.keyboard ? focused.id : undefined;
  const highlighted = [hovered, keyboardFocus, selectedId].find((id) => layout?.markers.some(({ group }) => group.id === id));
  const preview = useMemo(() => highlighted && frame && view && layout && !dragOrigin && !zoomTransition
    ? previewWorksMapCard(highlighted, layout, frame, view) : undefined, [highlighted, frame, view, layout, dragOrigin, zoomTransition]);
  const cardsByRegion = useMemo(() => {
    if (!preview) return baseCardsByRegion;
    return new Map(baseCardsByRegion).set(preview.regionId, preview);
  }, [baseCardsByRegion, preview]);
  const regionsToFind = useMemo(() => {
    if (!layout) return [];
    const points = new Map(layout.markers.map(({ group, point }) => [group.id, point]));
    const missing = regions.filter(({ id }) => {
      const point = points.get(id);
      return !point || (!baseCardsByRegion.has(id) && layout.markers.some(({ group, point: other }) =>
        id !== group.id && Math.hypot(point.x - other.x, point.y - other.y) < PIN_RADIUS * 2 + 1));
    });
    return [...menuOnly, ...missing].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
  }, [baseCardsByRegion, layout, menuOnly, regions]);
  const selected = selectedId ? regionsById.get(selectedId) : undefined;
  const reviewRegion = review && regionsById.get(review.regionId);
  // Show the region name in the map's read-only review with the original library assets.
  const reviewPhotos = useMemo(() => reviewRegion?.photos.map(({ photo }) => ({ ...photo, location: reviewRegion.name })) ?? [], [reviewRegion]);

  function exposeGroup() {
    const rail = strip.current;
    if (!pendingSelection.current || !rail) return;
    pendingSelection.current = false;
    if (selection.current?.keyboard) {
      rail.scrollLeft = 0;
      rail.querySelector<HTMLButtonElement>('.works-map-thumbnail')?.focus({ preventScroll: true });
    }
  }
  useLayoutEffect(exposeGroup, [selected]);
  useWorksMapPhotoDock(strip, selected?.id, !!review);
  useLayoutEffect(() => {
    const removedFocusId = focused && !focused.trigger.isConnected ? focused.id : undefined;
    const target = restoreFocus.current ?? (removedFocusId ? { regionId: removedFocusId } : null);
    if (!target) return;
    restoreFocus.current = null;
    if (removedFocusId) setFocused(undefined);
    // A selected region can have a temporary print that is removed on close.
    if (target.trigger?.isConnected) {
      target.trigger.focus({ preventScroll: true });
      return;
    }
    const fallback = target.regionId
      ? stage.current?.querySelector<HTMLButtonElement>(`.works-map-pin[data-region-id="${CSS.escape(target.regionId)}"]`)
      : strip.current?.querySelector<HTMLButtonElement>('.works-map-thumbnail');
    (fallback ?? viewport.current)?.focus({ preventScroll: true });
  }, [focused, layout, selectedId, review]);

  function pick(region: WorksMapRegionGroup<Photo>, origin: GroupSelection) {
    selection.current = origin;
    pendingSelection.current = true;
    if (selected?.id === region.id) exposeGroup();
    else setSelectedId(region.id);
  }
  function revealRegion(region: WorksMapRegionGroup<Photo>) {
    const keyboard = document.documentElement.dataset.inputMode === 'keyboard';
    const staysInMenu = menuOnly.includes(region);
    const trigger = staysInMenu && document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined;
    // The menu may disappear once the globe faces the chosen region.
    viewport.current?.focus({ preventScroll: true });
    if (!staysInMenu) {
      if (region.parentId && frame && view) {
        // A city found from the menu may be offscreen, with its province still grouped in the current view.
        const destination = centerWorksMapView(view, region.representative.coordinate);
        const next = selectWorksMapRegions(overview, frame, destination);
        if (next.groups.some(({ id }) => id === region.id)) lastRegions.current = { overview, displayed: next };
      }
      camera.centerOn(region.representative.coordinate);
    }
    pick(region, { keyboard, trigger });
  }
  const clearGroup = useCallback((keyboard = false) => {
    if (!selectedId || review) return;
    if (keyboard) restoreFocus.current = { trigger: selection.current?.trigger, regionId: selectedId };
    selection.current = null;
    pendingSelection.current = false;
    setSelectedId(undefined);
  }, [selectedId, review]);

  useEffect(() => {
    const content = exhibition.current;
    if (!content || !selectedId || review) return;
    const workspace = content.closest('main') ?? content;
    let pressedBackground: EventTarget | null = null;
    function rememberBackground(event: PointerEvent) {
      const target = event.target;
      pressedBackground = event.button === 0 && (target === workspace || target === content
        || target === stage.current || target === footer.current) ? target : null;
    }
    function dismissBackground(event: globalThis.MouseEvent) {
      if (pressedBackground && pressedBackground === event.target) clearGroup();
      pressedBackground = null;
    }
    function dismissFromKeyboard(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
      event.preventDefault();
      clearGroup(true);
    }
    workspace.addEventListener('pointerdown', rememberBackground);
    workspace.addEventListener('click', dismissBackground);
    document.addEventListener('keydown', dismissFromKeyboard);
    return () => {
      workspace.removeEventListener('pointerdown', rememberBackground);
      workspace.removeEventListener('click', dismissBackground);
      document.removeEventListener('keydown', dismissFromKeyboard);
    };
  }, [clearGroup, selectedId, review]);
  function closeReview() {
    restoreFocus.current = { trigger: review?.trigger };
    setReview(undefined);
  }
  function regionName({ name, country, parentName }: WorksMapRegionGroup<Photo>) {
    return (qualifiersByName.get(name)?.size ?? 0) > 1 ? `${name} · ${parentName ?? country}` : name;
  }
  function transferringToPrint(regionId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!preview || regionId === hovered || preview.regionId !== hovered || !hoverTransfer.current
      || performance.now() - hoverTransfer.current.started > PRINT_ROUTE_MS || !stage.current) return false;
    const { from } = preview.line;
    const rect = printRect(preview);
    const stageBounds = stage.current.getBoundingClientRect();
    const x = event.clientX - stageBounds.left;
    const y = event.clientY - stageBounds.top;
    const horizontalGap = Math.max(0, rect.x - from.x, from.x - rect.x - rect.width);
    const verticalGap = Math.max(0, rect.y - from.y, from.y - rect.y - rect.height);
    const [start, crossStart, cursor, crossCursor, edge, span, crossEdge, crossSpan] = horizontalGap > verticalGap
      ? [from.x, from.y, x, y, rect.x, rect.width, rect.y, rect.height]
      : [from.y, from.x, y, x, rect.y, rect.height, rect.x, rect.width];
    const [near, far] = start < edge ? [edge, edge + span] : [edge + span, edge];
    const progress = (cursor - start) / (near - start);
    if (progress <= 0 || (cursor - start) / (far - start) > 1) return false;
    // Protect the direction toward any part of the print, not just the end of its leader.
    const amount = Math.min(1, progress);
    const limit = crossStart + (crossEdge - crossStart) * amount;
    const margin = PIN_HIT_SIZE / 2;
    return crossCursor >= limit - margin && crossCursor <= limit + crossSpan * amount + margin;
  }
  function regionButtonProps(region: WorksMapRegionGroup<Photo>, label: string) {
    const isSelected = selected?.id === region.id;
    return {
      'aria-label': label,
      'aria-expanded': isSelected,
      'aria-controls': isSelected ? groupId : undefined,
      'data-selected': isSelected || undefined,
      'data-highlighted': highlighted === region.id || undefined,
      onPointerEnter: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (hoverTransfer.current && transferringToPrint(region.id, event)) {
          hoverTransfer.current.candidate = region.id;
          return;
        }
        window.clearTimeout(hoverTransfer.current?.timer);
        hoverTransfer.current = null;
        setSkipPrintArrival(true);
        setHovered(region.id);
      },
      onPointerLeave: () => {
        if (hoverTransfer.current?.candidate === region.id) hoverTransfer.current.candidate = undefined;
        if (hovered !== region.id) return;
        const clear = () => {
          const candidate = hoverTransfer.current?.candidate;
          hoverTransfer.current = null;
          setHovered((current) => current === region.id ? candidate : current);
        };
        if (baseCardsByRegion.has(region.id)) clear();
        // Briefly keep a temporary print reachable across the gap from its pin.
        else hoverTransfer.current = { timer: window.setTimeout(clear, PRINT_HOVER_TRANSFER_MS), started: performance.now() };
      },
      onFocus: ({ currentTarget }: FocusEvent<HTMLButtonElement>) => {
        const keyboard = document.documentElement.dataset.inputMode === 'keyboard';
        if (keyboard) setHovered(undefined);
        setFocused({ id: region.id, trigger: currentTarget, keyboard });
      },
      onBlur: ({ relatedTarget }: FocusEvent<HTMLButtonElement>) => {
        if (!(relatedTarget instanceof Element && relatedTarget.matches(REGION_BUTTONS))) setFocused(undefined);
      },
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        const keyboard = event.detail === 0;
        if (keyboard || hovered !== region.id) setHovered(undefined);
        pick(region, { trigger: event.currentTarget, keyboard });
      },
    };
  }
  const highlightedLine = highlighted !== undefined && cardsByRegion.has(highlighted);
  const markerPaintOrder = [...(layout?.markers ?? [])].sort((a, b) => Number(a.group.id === highlighted) - Number(b.group.id === highlighted));
  const ready = !!(frame && view && visible && layout);

  return <div ref={exhibition} className="works-map-exhibition" onPointerDownCapture={() => {
    if (focused?.keyboard) setFocused({ ...focused, keyboard: false });
  }}>
    {atlas && <div className="works-map-top-tools">
      <small title="CTAmap, Rui Cheng, Yunfeng Hu, Chiwei Xiao, Yanjun Wang, CC BY 4.0. https://doi.org/10.5281/zenodo.22179207">Natural Earth · CTAmap</small>
      <div className="works-map-tools">
        {regionsToFind.length > 0 && <DropdownMenu label={t('查找拍摄地区', 'Find a Region')}
          triggerLabel={t('查找拍摄地区', 'Find a Region')} triggerText={t('地区', 'Regions')} icon={<MapPin size={15} aria-hidden="true" />}
          groups={[{ items: regionsToFind.map((region) => ({
            id: region.id,
            label: regionName(region),
            run: () => revealRegion(region),
          })) }]} />}
        <div className="works-map-controls" role="group" aria-label={t('地图缩放', 'Map Zoom')}>
          <IconButton label={t('缩小地图', 'Zoom Out')} disabled={camera.controlsScale === undefined || camera.controlsScale <= camera.minimum} onClick={camera.zoomOut}><Minus size={16} aria-hidden="true" /></IconButton>
          <IconButton label={t('放大地图', 'Zoom In')} disabled={camera.controlsScale === undefined || camera.controlsScale >= camera.maximum} onClick={camera.zoomIn}><Plus size={16} aria-hidden="true" /></IconButton>
          <IconButton label={t('复位视野', 'Reset Map View')} disabled={camera.isFitted} onClick={camera.reset}><LocateFixed size={16} aria-hidden="true" /></IconButton>
        </div>
      </div>
    </div>}
    <div ref={stage} className="works-map-stage" onPointerLeave={() => setHovered(undefined)}
      data-loading={!atlas || undefined} data-ready={ready || undefined} data-narrow={frame?.narrow || undefined}
      data-highlighted={highlightedLine || undefined} data-dragging={!!dragOrigin || undefined}>
      {frame && displayView && globe && <WorksMapGlobe atlas={atlas}
        view={displayView} map={frame.map} globe={globe} visibleRadius={visible?.radius ?? displayView.scale} />}
      {ready && <>
        <div ref={viewport} className="works-map-viewport" style={rectStyle({
          x: visible.center.x - visible.radius, y: visible.center.y - visible.radius,
          width: visible.radius * 2, height: visible.radius * 2,
        })}
          tabIndex={0} aria-label={t('地球', 'Globe')} role="group" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home"
          onKeyDown={camera.mapKeys}>
          <div className="works-map-rotation-surface"
            {...camera.panHandlers} onPointerUp={(event) => {
              if (camera.panHandlers.onPointerUp(event)) clearGroup();
            }} onPointerDown={(event) => {
              if (event.button === 0) {
                setHovered(undefined);
                viewport.current?.focus({ preventScroll: true });
              }
              camera.panHandlers.onPointerDown(event);
            }} />
        </div>
        <svg className="works-map-leaders" aria-hidden="true">
          <defs>
            <clipPath id={globeClipId}>
              <circle cx={visible.center.x} cy={visible.center.y} r={visible.radius} />
            </clipPath>
            {[...pinAreas.values()].map(({ clipId, visible }) => visible && <clipPath key={clipId} id={clipId}>
              <polygon points={visible} />
            </clipPath>)}
          </defs>
          <g className="works-map-leader-paths">
            {markerPaintOrder.map(({ group }) => {
              const card = cardsByRegion.get(group.id);
              if (!card) return null;
              const { from, to } = card.line;
              return <path key={group.id} pathLength={1} data-region-id={group.id} data-highlighted={highlighted === group.id || undefined}
                d={`M${from.x} ${from.y}L${to.x} ${to.y}`} />;
            })}
          </g>
          <g clipPath={`url(#${globeClipId})`}>
            {markerPaintOrder.map(({ group, point }) => {
              const area = pinAreas.get(group.id);
              const active = highlighted === group.id || undefined;
              return <g key={group.id} className="works-map-anchor-shape" data-region-id={group.id}
                clipPath={area?.visible ? `url(#${area.clipId})` : undefined}>
                <circle className="works-map-anchor-halo" data-highlighted={active} cx={point.x} cy={point.y} r={PIN_HALO_RADIUS} />
                <circle className="works-map-anchor" data-region-id={group.id} data-highlighted={active}
                  data-focused={keyboardFocus === group.id || undefined} cx={point.x} cy={point.y} r={PIN_RADIUS} />
              </g>;
            })}
          </g>
        </svg>
        <div className="works-map-pins" style={{ clipPath: `circle(${visible.radius}px at ${visible.center.x}px ${visible.center.y}px)` }}>
          {layout.markers.map(({ group: region, point }) => {
            const name = regionName(region);
            const label = t(`${name}，${region.photos.length} 张照片`, `${name}, ${photoCount(region.photos.length)}`);
            return <button key={region.id} type="button" className="works-map-pin" title={label} data-region-id={region.id}
              style={{ left: point.x, top: point.y, width: PIN_HIT_SIZE, height: PIN_HIT_SIZE, clipPath: pinAreas.get(region.id)?.hit }}
              {...regionButtonProps(region, label)} />;
          })}
        </div>
        <div className="works-map-prints" data-revealed={skipPrintArrival || undefined} onFocus={() => setSkipPrintArrival(true)}>
          {[...cardsByRegion.values()].map((card) => {
            const region = regionsById.get(card.regionId)!;
            if (dragOrigin && !projectWorksMapCoordinate(region.representative.coordinate, view, frame.map)) return null;
            const label = regionName(region);
            return <button type="button" className="works-map-print" key={region.id} data-region-id={region.id} title={label} style={rectStyle(printRect(card))}
              {...regionButtonProps(region, t(`${label}，${region.photos.length} 张照片，代表作 ${photoName(card.photo)}`, `${label}, ${photoCount(region.photos.length)}, cover photo ${photoName(card.photo)}`))}>
              <span className="works-map-print-image" style={printPart(card, card.rect)} aria-hidden="true"><PhotoImage photo={card.photo} thumbnailOnly /></span>
              <span className="works-map-print-caption" style={printPart(card, card.captionRect)} aria-hidden="true">
                <span>{label}</span>{region.photos.length > 1 && <span>×{region.photos.length}</span>}
              </span>
            </button>;
          })}
        </div>
      </>}
    </div>
    <div ref={footer} className="works-map-footer">
      {!atlas && <small role="status">{t('正在读取离线地图', 'Loading offline map')}</small>}
    </div>
    {selected && <section id={groupId} className="works-map-group" aria-labelledby={`${groupId}-title`} aria-keyshortcuts="Escape">
      <div className="works-map-group-content">
        <header className="works-map-group-title">
          <h2 id={`${groupId}-title`} title={selected.name}>{selected.name}</h2>
          <span>{photoCount(selected.photos.length)}</span>
        </header>
        <div key={selected.id} ref={strip} className="works-map-thumbnails">
          <div className="works-map-thumbnail-track">
            {selected.photos.map(({ photo }) => <WorksMapThumbnail key={photo.id} photo={photo} onOpen={(trigger) => {
              trigger.focus({ preventScroll: true });
              setReview({ id: photo.id, regionId: selected.id, trigger });
            }} />)}
          </div>
        </div>
      </div>
    </section>}
    {review && <PhotoReview photos={reviewPhotos} initialPhotoId={review.id} context={reviewRegion?.name ?? t('作品地图', 'Work Map')} busy={false}
      onClose={closeReview} fullscreen="available" returnLabel={t('返回作品地图', 'Back to Work Map')} />}
  </div>;
}

function clipPinArea(point: MapPoint, points: readonly MapPoint[], half: number, gap = 0) {
  let polygon = [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
  let clipped = false;

  // The hit area reaches the bisector. The painted shapes leave a gap while retaining their centers.
  for (const neighbor of points) {
    const dx = neighbor.x - point.x;
    const dy = neighbor.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (!distanceSquared || distanceSquared >= (2 * Math.SQRT2 * half + gap) ** 2) continue;
    const distance = Math.sqrt(distanceSquared);
    const inset = Math.min(gap / 2, distance / 4);
    const edge = distanceSquared / 2 - distance * inset;
    const side = ({ x, y }: MapPoint) => dx * x + dy * y - edge;
    const next: MapPoint[] = [];
    let previous = polygon[polygon.length - 1];
    for (const vertex of polygon) {
      const start = side(previous);
      const end = side(vertex);
      if ((start > 0) !== (end > 0)) {
        const ratio = start / (start - end);
        next.push({ x: previous.x + (vertex.x - previous.x) * ratio, y: previous.y + (vertex.y - previous.y) * ratio });
        clipped = true;
      }
      if (end <= 0) next.push(vertex);
      previous = vertex;
    }
    polygon = next;
  }
  return clipped ? polygon : undefined;
}

function photoName(photo: Photo) { return photo.title || photo.originalName; }

function WorksMapThumbnail({ photo, onOpen }: { photo: Photo; onOpen: (trigger: HTMLButtonElement) => void }) {
  const aspectRatio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;
  return <button type="button" className="works-map-thumbnail" style={{ aspectRatio }} aria-label={t(`查看 ${photoName(photo)}`, `View ${photoName(photo)}`)} title={photoName(photo)}
    onClick={(event) => onOpen(event.currentTarget)}><span className="works-map-image" aria-hidden="true"><PhotoImage photo={photo} thumbnailOnly lazy /></span></button>;
}

function printRect({ rect, captionRect }: WorksMapCard<Photo>): MapRect {
  const x = Math.min(rect.x, captionRect.x);
  const y = Math.min(rect.y, captionRect.y);
  return { x, y, width: Math.max(rect.x + rect.width, captionRect.x + captionRect.width) - x,
    height: Math.max(rect.y + rect.height, captionRect.y + captionRect.height) - y };
}

function printPart({ rect, captionRect }: WorksMapCard<Photo>, part: MapRect) {
  return rectStyle({ ...part, x: part.x - Math.min(rect.x, captionRect.x), y: part.y - Math.min(rect.y, captionRect.y) });
}

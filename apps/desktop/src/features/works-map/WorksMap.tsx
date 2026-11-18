import { getLocale, photoCount, t } from '../../lib/i18n';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../../components/ui';
import type { LibraryAlbum } from '../library-albums';
import { WorksMapExhibition } from './WorksMapExhibition';
import type { WorksMapAtlas } from './WorksMapGlobe';
import { groupWorksMapPhotos, locateMapPhotos } from './works-map-layout';
import { loadWorksMapRegionData } from './works-map-regions';
import './works-map.css';

export function WorksMap({ albums, hiddenPhotoIds, onBack, onReviewChange }: {
  albums: LibraryAlbum[];
  hiddenPhotoIds?: string[];
  onBack: () => void;
  onReviewChange: (open: boolean) => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const located = useMemo(() => {
    const hidden = new Set(hiddenPhotoIds);
    return locateMapPhotos(albums.flatMap(({ photos }) => photos.filter((photo) => !hidden.has(photo.id))));
  }, [albums, hiddenPhotoIds]);
  const [data, setData] = useState<WorksMapAtlas | 'failed' | null>(null);
  const hasPhotos = located.length > 0;
  useLayoutEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!hasPhotos) return;
    let active = true;
    // Both datasets are bundled with the app and loaded on demand.
    void Promise.all([import('./natural-earth.json'), loadWorksMapRegionData(getLocale())]).then(([{ default: basemap }, regionData]) => {
      if (active) setData({ basemap, regionData });
    }, () => { if (active) setData('failed'); });
    return () => { active = false; };
  }, [hasPhotos]);
  const atlas = data === 'failed' ? null : data;
  const regions = useMemo(() => atlas ? groupWorksMapPhotos(located, atlas.regionData) : [], [atlas, located]);
  const count = regions.reduce((total, region) => total + region.photos.length, 0);
  const backLabel = t('返回作品相簿', 'Back to Work Albums');

  return <>
    <header className="workspace-intro works-map-header">
      <button ref={back} type="button" className="icon-button" onClick={onBack} aria-label={backLabel} title={backLabel}><ArrowLeft size={18} aria-hidden="true" /></button>
      <div className="workspace-title">
        <h1>{t('作品地图', 'Work Map')}</h1>
        {count > 0 && <p className="photo-count">{photoCount(count)}</p>}
      </div>
    </header>
    {!hasPhotos || (atlas && !regions.length) ? <EmptyState title={t('暂无可归入地区的作品', 'No photos match a region')} />
      : data === 'failed' ? <div role="alert"><EmptyState title={t('无法读取离线地图', 'Could not load the offline map')} /></div>
        : <WorksMapExhibition regions={regions} atlas={atlas} onReviewChange={onReviewChange} />}
  </>;
}

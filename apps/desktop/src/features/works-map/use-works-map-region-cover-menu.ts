import { useRef } from 'react';
import { t } from '../../lib/i18n';
import type { Photo } from '../../lib/types';
import { useContextMenu, type ContextMenuPosition } from '../use-context-menu';
import type { WorksMapRegionGroup } from './works-map-layout';

export function useWorksMapRegionCoverMenu({ selected, busy, reviewOpen, regionCovers, onSetCover, onFeedback }: {
  selected?: WorksMapRegionGroup<Photo>;
  busy: boolean;
  reviewOpen: boolean;
  regionCovers: Readonly<Record<string, string>>;
  onSetCover: (regionId: string, photoId: string | null) => Promise<void>;
  onFeedback: (message: string, error?: boolean) => void;
}) {
  const savingCover = useRef(false);
  const coverMenuState = useRef({ selected, busy, reviewOpen, regionCovers });
  coverMenuState.current = { selected, busy, reviewOpen, regionCovers };
  const openPhotoMenu = useContextMenu('photo', JSON.stringify([selected?.id, reviewOpen]), (message) => onFeedback(message, true));

  return function showPhotoMenu(photo: Photo, at: ContextMenuPosition, trigger: HTMLButtonElement) {
    const regionId = selected?.id;
    if (!regionId) return;
    const allowed = () => {
      const current = coverMenuState.current;
      return !current.busy && !current.reviewOpen && !savingCover.current && current.selected?.id === regionId
        && current.selected.photosById?.has(photo.id) === true;
    };
    const currentCover = regionCovers[regionId] === photo.id;
    const canSet = () => allowed() && coverMenuState.current.regionCovers[regionId] !== photo.id;
    const canReset = () => allowed() && !!coverMenuState.current.regionCovers[regionId];
    const save = async (photoId: string | null) => {
      savingCover.current = true;
      try { await onSetCover(regionId, photoId); }
      catch (cause) { onFeedback(cause instanceof Error ? cause.message : String(cause), true); }
      finally { savingCover.current = false; }
    };
    void openPhotoMenu([
      { id: 'map-region-cover', text: currentCover ? t('设为地区封面（当前封面）', 'Set as Region Cover (Current)') : t('设为地区封面', 'Set as Region Cover'),
        disabled: !canSet(), allowed: canSet, run: () => void save(photo.id) },
      { id: 'map-region-cover-auto', text: t('恢复自动封面', 'Restore Automatic Cover'),
        disabled: !canReset(), allowed: canReset, run: () => void save(null) },
    ], at, trigger);
  }
}

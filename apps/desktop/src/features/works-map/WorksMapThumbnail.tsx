import { PhotoImage } from '../../components/PhotoImage';
import { t } from '../../lib/i18n';
import type { Photo } from '../../lib/types';
import type { ContextMenuPosition } from '../use-context-menu';

export function WorksMapThumbnail({ photo, onOpen, onMenu }: {
  photo: Photo;
  onOpen: (trigger: HTMLButtonElement) => void;
  onMenu: (photo: Photo, at: ContextMenuPosition, trigger: HTMLButtonElement) => void;
}) {
  const name = photo.title || photo.originalName;
  const aspectRatio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;
  return <button type="button" className="works-map-thumbnail" style={{ aspectRatio }} aria-label={t(`查看 ${name}`, `View ${name}`)} title={name}
    aria-haspopup="menu" aria-keyshortcuts="Shift+F10"
    onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onMenu(photo, { x: event.clientX, y: event.clientY, source: 'mouse' }, event.currentTarget);
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      onMenu(photo, { x: rect.left + 12, y: rect.bottom, source: 'position' }, event.currentTarget);
    }}
    onClick={(event) => onOpen(event.currentTarget)}><span className="works-map-image" aria-hidden="true"><PhotoImage photo={photo} thumbnailOnly lazy /></span></button>;
}

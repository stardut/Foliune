import { Images } from 'lucide-react';
import { PhotoImage } from '../components/PhotoImage';
import type { Group, Photo } from '../lib/types';
import type { LibraryAlbum } from './library-albums';

export function AlbumOverview({ albums, ungrouped, busy, onOpen, onUngrouped, onMenu }: {
  albums: LibraryAlbum[]; ungrouped: Photo[];
  busy: boolean;
  onOpen: (id: string) => void; onUngrouped: () => void;
  onMenu: (group: Group, at: { x: number; y: number }, trigger: HTMLElement) => void;
}) {
  return <div className="album-overview">
    {albums.map(({ group, photos }) => <article className="album-item" key={group.id}>
      <button type="button" className="album-open" disabled={busy} onClick={() => onOpen(group.id)} aria-label={`打开相簿 ${group.name}，${photos.length} 张照片${group.capacity !== null ? `，容量 ${group.capacity} 张` : ''}`}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onMenu(group, { x: event.clientX, y: event.clientY }, event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault(); event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(group, { x: rect.left + 24, y: rect.top + 32 }, event.currentTarget);
        }}>
        <div className={`album-cover ${photos.length ? '' : 'album-cover-empty'}`}>{photos[0] ? <PhotoImage photo={photos[0]} lazy /> : <div className="album-empty" aria-hidden="true"><Images size={28} strokeWidth={1.1} /></div>}</div>
        <div className="album-caption">
          <div className="album-heading"><h2 title={group.name}>{group.name}</h2><span className="album-count">{photos.length.toLocaleString()} <span>张</span></span></div>
        </div>
      </button>
    </article>)}
    {ungrouped.length > 0 && <article className="album-item album-ungrouped">
      <button type="button" className="album-open" disabled={busy} onClick={onUngrouped} aria-label={`未归入相簿，${ungrouped.length} 张照片`}>
        <div className="album-cover"><PhotoImage photo={ungrouped[0]} lazy /></div>
        <div className="album-caption"><div className="album-heading"><h2>未归入相簿</h2><span className="album-count">{ungrouped.length.toLocaleString()} <span>张</span></span></div></div>
      </button>
    </article>}
  </div>;
}

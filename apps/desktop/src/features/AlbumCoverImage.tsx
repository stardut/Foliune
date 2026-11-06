import { useEffect, useRef, useState } from 'react';
import { PhotoImage } from '../components/PhotoImage';
import { isDesktop, readAlbumCover } from '../lib/api';
import type { AlbumCover, Photo } from '../lib/types';

const pendingCovers = new Set<() => Promise<void>>();
let runningCovers = 0;

function loadPendingCovers() {
  // Share the limit across workspaces, including reads still finishing after navigation.
  for (const load of pendingCovers) {
    if (runningCovers === 2) break;
    pendingCovers.delete(load);
    runningCovers++;
    void load().finally(() => { runningCovers--; loadPendingCovers(); });
  }
}

export function AlbumCoverImage({ groupId, photo, cover }: { groupId: string; photo: Photo; cover: AlbumCover | null }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const highResolutionRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  const { id: photoId, originalPath, thumbnailPath } = photo;
  const offsetX = cover?.offsetX;
  const offsetY = cover?.offsetY;
  const zoom = cover?.zoom;

  useEffect(() => {
    const preview = previewRef.current;
    const image = highResolutionRef.current;
    if (!isDesktop() || !preview || !image) return;
    const expectedCover = offsetX !== undefined && offsetY !== undefined && zoom !== undefined ? { photoId, offsetX, offsetY, zoom } : null;
    let cancelLoad: (() => void) | undefined;
    let disposed = false;
    const observer = new IntersectionObserver((entries) => {
      if (disposed) return;
      if (!entries[entries.length - 1].isIntersecting) {
        cancelLoad?.();
        cancelLoad = undefined;
        setReady(false);
        return;
      }
      if (cancelLoad) return;
      let active = true;
      let url: string | undefined;
      const releaseImage = () => {
        if (!url) return;
        image.removeAttribute('src');
        URL.revokeObjectURL(url);
        url = undefined;
      };
      const load = async () => {
        try {
          const bytes = await readAlbumCover(groupId, photoId, originalPath, thumbnailPath, expectedCover);
          if (!active) return;
          url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          image.src = url;
          await image.decode();
          if (active) setReady(true);
        } catch {
          if (active) releaseImage();
        }
      };
      cancelLoad = () => {
        active = false;
        pendingCovers.delete(load);
        releaseImage();
      };
      pendingCovers.add(load);
      loadPendingCovers();
    }, { root: preview.closest('main'), rootMargin: '160px 0px' });
    observer.observe(preview);
    return () => { disposed = true; observer.disconnect(); cancelLoad?.(); };
  }, [groupId, photoId, originalPath, thumbnailPath, offsetX, offsetY, zoom]);

  return <div ref={previewRef} className="album-cover-preview">
    {!ready && <PhotoImage photo={photo} thumbnailOnly lazy />}
    <img ref={highResolutionRef} className="album-cover-hd" hidden={!ready} width={1200} height={800} alt={photo.title || photo.originalName} />
  </div>;
}

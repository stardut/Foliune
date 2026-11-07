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
    setReady(false);
    if (!isDesktop() || !preview || !image) return;
    const expectedCover = offsetX !== undefined && offsetY !== undefined && zoom !== undefined ? { photoId, offsetX, offsetY, zoom } : null;
    let disposed = false;
    let status: 'idle' | 'queued' | 'loading' | 'ready' | 'failed' = 'idle';
    let url: string | undefined;
    const releaseImage = () => {
      if (!url) return;
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
      url = undefined;
    };
    const load = async () => {
      status = 'loading';
      try {
        const bytes = await readAlbumCover(groupId, photoId, originalPath, thumbnailPath, expectedCover);
        if (disposed) return;
        url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        image.src = url;
        await image.decode();
        if (!disposed) { status = 'ready'; setReady(true); }
      } catch {
        if (!disposed) { status = 'failed'; releaseImage(); }
      }
    };
    const onIntersection = (entries: IntersectionObserverEntry[]) => {
      if (!entries[entries.length - 1].isIntersecting) {
        // Drop only work that has not started. A read/decode and its successful
        // result belong to this mounted cover, even while it is offscreen.
        if (status === 'queued') { pendingCovers.delete(load); status = 'idle'; }
        if (status === 'failed') status = 'idle';
        return;
      }
      if (status !== 'idle') return;
      status = 'queued';
      pendingCovers.add(load);
      loadPendingCovers();
    };
    const main = preview.closest('main');
    let observer: IntersectionObserver | undefined;
    let viewportHeight = -1;
    const measure = () => {
      if (disposed) return;
      const nextHeight = main ? main.clientHeight : window.innerHeight;
      if (nextHeight === viewportHeight) return;
      viewportHeight = nextHeight;
      observer?.disconnect();
      // IntersectionObserver percentages use root width, so express one screen
      // above and below the scrolling main in measured pixels.
      const current = new IntersectionObserver((entries) => {
        if (!disposed && observer === current) onIntersection(entries);
      }, { root: main, rootMargin: `${viewportHeight}px 0px` });
      observer = current;
      current.observe(preview);
    };
    const resize = new ResizeObserver(measure);
    if (main) resize.observe(main);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      disposed = true;
      observer?.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', measure);
      pendingCovers.delete(load);
      releaseImage();
    };
  }, [groupId, photoId, originalPath, thumbnailPath, offsetX, offsetY, zoom]);

  return <div ref={previewRef} className="album-cover-preview">
    {!ready && <PhotoImage photo={photo} thumbnailOnly lazy />}
    <img ref={highResolutionRef} className="album-cover-hd" hidden={!ready} width={1200} height={800} alt={photo.title || photo.originalName} />
  </div>;
}

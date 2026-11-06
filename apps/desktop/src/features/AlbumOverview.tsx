import { useId, useState, type CSSProperties } from 'react';
import { ChevronRight, Images } from 'lucide-react';
import { PhotoImage } from '../components/PhotoImage';
import { Modal } from '../components/ui';
import type { Group, Photo } from '../lib/types';
import type { WorkDirectoryJob } from '../lib/work-directory-api';
import type { LibraryAlbum } from './library-albums';
import { albumCoverStyle } from './album-cover';
import { WorkDirectorySourceIcon } from './WorkDirectorySourceIcon';

export function AlbumOverview({ albums, busy, jobs = [], retrying, onRetry, onOpen, onMenu }: {
  albums: LibraryAlbum[];
  busy: boolean;
  jobs?: WorkDirectoryJob[];
  retrying?: ReadonlySet<string>;
  onRetry?: (job: WorkDirectoryJob) => void;
  onOpen: (id: string) => void;
  onMenu: (group: Group, at: { x: number; y: number }, trigger: HTMLElement) => void;
}) {
  const byAlbumId = new Map(jobs.map((job) => [job.albumId, job]));
  const albumIds = new Set(albums.map(({ group }) => group.id));
  const cards = [
    ...albums.map(({ group, photos }) => ({ id: group.id, group, photos, job: byAlbumId.get(group.id) })),
    ...jobs.filter((job) => job.createdAlbum && !albumIds.has(job.albumId)).map((job) => ({ id: job.albumId, group: undefined, photos: [], job })),
  ];
  return <div className="album-overview">
    {cards.map(({ id, group, photos, job }) => <AlbumCard key={id} group={group} photos={photos} job={job}
      busy={busy} retrying={!!job && !!retrying?.has(job.id)} onRetry={onRetry} onOpen={onOpen} onMenu={onMenu} />)}
  </div>;
}

function AlbumCard({ group, photos, job, busy, retrying, onRetry, onOpen, onMenu }: {
  group?: Group; photos: Photo[]; job?: WorkDirectoryJob; busy: boolean; retrying: boolean;
  onRetry?: (job: WorkDirectoryJob) => void;
  onOpen: (id: string) => void;
  onMenu: (group: Group, at: { x: number; y: number }, trigger: HTMLElement) => void;
}) {
  const statusId = useId();
  const sourceId = `${statusId}-source`;
  const [failureDetails, setFailureDetails] = useState(false);
  const name = group?.name ?? job?.folderName;
  const directorySource = !!group?.boundFolder || (!group && !!job);
  const description = [directorySource && sourceId, job && statusId].filter(Boolean).join(' ') || undefined;
  const isFailed = job?.status === 'failed';
  const isRunning = job?.status === 'running';
  const isReady = isRunning && job.processed === job.fileCount;
  const status = retrying ? '正在重试' : isFailed ? '同步失败' : isReady ? '写入相簿' : isRunning ? '同步中' : '等待同步';
  const fraction = job ? job.processed / job.fileCount : 0;
  const cover = group?.cover;
  const coverPhoto = cover && photos.find((photo) => photo.id === cover.photoId);
  const photo = coverPhoto || photos[0];
  const content = <>
    <div className={`album-cover ${photo ? '' : 'album-cover-empty'}`} style={coverPhoto && cover ? albumCoverStyle(cover) : undefined}>
      {photo ? <PhotoImage key={photo.id} photo={photo} lazy /> : <div className="album-empty" aria-hidden="true"><Images size={28} strokeWidth={1.1} /></div>}
      {job && <div className="album-sync-line" data-running={isRunning} style={{ '--sync-fraction': fraction } as CSSProperties} aria-hidden="true"><span /></div>}
    </div>
    <div className="album-caption">
      <div className="album-heading">
        <h2 title={name}>{name}</h2>
        {(group || directorySource) && <div className="album-caption-meta">
          {group && <span className="album-count">{photos.length.toLocaleString()} <span>张</span></span>}
          {directorySource && <WorkDirectorySourceIcon id={sourceId} />}
        </div>}
      </div>
    </div>
  </>;
  return <article className={`album-item${job ? ' album-item-syncing' : ''}`}>
    {group ? <button type="button" className="album-open" disabled={busy} onClick={() => onOpen(group.id)}
        aria-label={`打开相簿 ${group.name}，${photos.length} 张照片${group.capacity !== null ? `，容量 ${group.capacity} 张` : ''}`}
        aria-describedby={description}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onMenu(group, { x: event.clientX, y: event.clientY }, event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault(); event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(group, { x: rect.left + 24, y: rect.top + 32 }, event.currentTarget);
        }}>
      {content}
    </button> : <div className="album-open album-open-placeholder">{content}</div>}
    {job && <div className="album-sync-caption">
      <span id={statusId} role="status" className={isFailed ? 'sr-only' : undefined}>{status}</span>
      {isFailed && (job.error
        ? <button type="button" className="text-button album-sync-failure" aria-haspopup="dialog" aria-label={`查看「${name}」同步失败原因`} onClick={() => setFailureDetails(true)}>
          {status}<ChevronRight size={12} aria-hidden="true" />
        </button>
        : <span className="album-sync-failure-label" aria-hidden="true">{status}</span>)}
      {isFailed ? <button type="button" className="text-button album-sync-retry" onClick={() => onRetry?.(job)}
        disabled={retrying} aria-label={`重试同步 ${name}`} aria-describedby={statusId}>重试</button>
        : <span role="progressbar" aria-label={`${name} 同步进度`} aria-valuemin={0} aria-valuenow={job.processed} aria-valuemax={job.fileCount}
          aria-valuetext={`${job.processed} / ${job.fileCount} 张`}>{job.processed.toLocaleString()} / {job.fileCount.toLocaleString()} 张</span>}
    </div>}
    {failureDetails && isFailed && job?.error && <Modal title={`「${name}」同步失败`} onClose={() => setFailureDetails(false)}>
      <p className="form-error work-directory-sync-error">{job.error}</p>
    </Modal>}
  </article>;
}

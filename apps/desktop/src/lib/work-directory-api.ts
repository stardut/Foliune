import { open } from '@tauri-apps/plugin-dialog';
import { call } from './api';
import type { Group, Membership, Photo } from './types';

export interface WorkDirectoryCandidate {
  id: string;
  folderName: string;
  albumId: string | null;
  fileNames: string[];
}

export interface WorkDirectoryState {
  libraryId: string;
  path: string | null;
  status: 'unbound' | 'connected' | 'unavailable';
  candidates: WorkDirectoryCandidate[];
  jobs: WorkDirectoryJob[];
}

export interface WorkDirectoryJob {
  id: string;
  folderName: string;
  albumId: string;
  createdAlbum: boolean;
  fileCount: number;
  processed: number;
  status: 'queued' | 'running' | 'failed';
  error?: string | null;
}

export interface WorkDirectoryCommit {
  libraryId: string;
  jobId: string;
  album: Group;
  createdAlbum: boolean;
  photos: Photo[];
  memberships: Membership[];
}

export interface WorkDirectoryChange {
  libraryId: string;
  refreshSnapshot: boolean;
  synced?: WorkDirectoryCommit | null;
}

export type WorkDirectoryDecision = 'sync' | 'ignore';

export const getWorkDirectory = () => call<WorkDirectoryState>('get_work_directory');
export const bindWorkDirectory = (path: string) => call<WorkDirectoryState>('bind_work_directory', { path });
export const relinkWorkDirectory = (path: string) => call<WorkDirectoryState>('relink_work_directory', { path });
export const unbindWorkDirectory = () => call<WorkDirectoryState>('unbind_work_directory');
export const resolveWorkDirectory = (candidateIds: string[], decision: WorkDirectoryDecision) =>
  call<WorkDirectoryState>('resolve_work_directory', { input: { candidateIds, decision } });
export const retryWorkDirectoryJob = (jobId: string) => call<WorkDirectoryState>('retry_work_directory_job', { jobId });

export const selectWorkDirectory = (relink: boolean) => open({
  multiple: false,
  directory: true,
  title: relink ? '重新定位作品目录' : '选择作品目录（原件留在原处）',
});

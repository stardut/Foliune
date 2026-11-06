import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '../components/ToastProvider';
import { isDesktop, loadSnapshot, withPhotoUrls } from '../lib/api';
import type { LibrarySnapshot } from '../lib/types';
import { getWorkDirectory, retryWorkDirectoryJob, type WorkDirectoryCandidate, type WorkDirectoryChange, type WorkDirectoryCommit, type WorkDirectoryJob, type WorkDirectoryState } from '../lib/work-directory-api';

function createSession() {
  return {
    libraryId: null as string | null,
    completed: new Set<string>(),
    earlyCommits: [] as WorkDirectoryCommit[],
    operation: 0,
    locked: false,
    retrying: new Set<string>(),
    refresh: () => {},
  };
}

const noJobs: WorkDirectoryJob[] = [];

export function useWorkDirectory(
  ready: boolean,
  onSynced: (commit: WorkDirectoryCommit) => void,
  onAvailability: (snapshot: LibrarySnapshot) => void,
) {
  const toast = useToast();
  const [session] = useState(createSession);

  const [state, setState] = useState<WorkDirectoryState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [request, setRequest] = useState<{ blocking: boolean } | null>(null);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>();
  const busy = request !== null;
  const blocking = request?.blocking ?? false;

  const receiveCommit = useCallback((commit: WorkDirectoryCommit) => {
    if (session.libraryId === null) { session.earlyCommits.push(commit); return; }
    if (commit.libraryId !== session.libraryId || session.completed.has(commit.jobId)) return;
    session.completed.add(commit.jobId);
    onSynced({ ...commit, photos: commit.photos.map(withPhotoUrls) });
    setState((current) => current?.jobs.some((job) => job.id === commit.jobId)
      ? { ...current, jobs: current.jobs.filter((job) => job.id !== commit.jobId) }
      : current);
  }, [onSynced, session]);

  const receiveState = useCallback((value: WorkDirectoryState) => {
    if (session.libraryId !== null && value.libraryId !== session.libraryId) return false;
    session.libraryId = value.libraryId;
    for (const commit of session.earlyCommits.splice(0)) receiveCommit(commit);
    const jobs = value.jobs.filter((job) => !session.completed.has(job.id));
    setState({ ...value, jobs });
    return true;
  }, [receiveCommit, session]);

  useEffect(() => {
    if (!ready || !isDesktop()) return;
    let active = true;
    let stop: (() => void) | undefined;
    let reading = false;
    let pending = false;
    let snapshotPending = false;
    async function refresh() {
      if (!active || reading || session.locked || !pending) return;
      reading = true;
      pending = false;
      const refreshSnapshot = snapshotPending;
      snapshotPending = false;
      const started = session.operation;
      try {
        const next = await getWorkDirectory();
        if (!active || started !== session.operation) return;
        if (!receiveState(next)) return;
        if (refreshSnapshot) {
          const fresh = await loadSnapshot();
          if (active && started === session.operation) onAvailability(fresh);
        }
      } catch (cause) {
        if (active && started === session.operation) toast({ title: `无法读取作品目录：${message(cause)}`, status: 'error' });
      } finally {
        reading = false;
        if (active && started !== session.operation && refreshSnapshot) { pending = true; snapshotPending = true; }
        if (pending) void refresh();
      }
    }
    function schedule(refreshSnapshot: boolean) {
      pending = true;
      snapshotPending ||= refreshSnapshot;
      void refresh();
    }
    session.refresh = () => schedule(false);
    void listen<WorkDirectoryChange>('work-directory-changed', ({ payload }) => {
      if (!active || (session.libraryId !== null && payload.libraryId !== session.libraryId)) return;
      if (payload.synced) receiveCommit(payload.synced);
      schedule(payload.refreshSnapshot && !payload.synced);
    }).then((unlisten) => { if (active) { stop = unlisten; schedule(true); } else unlisten(); })
      .catch((cause) => {
        if (active) { toast({ title: `无法监听作品目录：${message(cause)}`, status: 'error' }); schedule(false); }
      });
    return () => { active = false; stop?.(); };
  }, [ready, onAvailability, receiveCommit, receiveState, session, toast]);

  async function run(action: () => Promise<WorkDirectoryState | null>, refreshSnapshot: boolean, blocksWorkspace = true) {
    if (session.locked || session.retrying.size) return null;
    session.locked = true;
    session.operation += 1;
    setRequest({ blocking: blocksWorkspace });
    try {
      const next = await action();
      if (!next || !receiveState(next)) return null;
      if (refreshSnapshot) {
        try { onAvailability(await loadSnapshot()); }
        catch (cause) { toast({ title: `目录已更新，无法刷新图库：${message(cause)}`, status: 'error' }); }
      }
      return next;
    } finally {
      session.locked = false;
      setRequest(null);
      session.refresh();
    }
  }

  async function retryJob(job: WorkDirectoryJob) {
    if (session.locked || session.retrying.has(job.id)) return;
    session.retrying.add(job.id);
    setRetrying(new Set(session.retrying));
    try {
      const next = await retryWorkDirectoryJob(job.id);
      const updated = next.jobs.find((item) => item.id === job.id);
      if (!updated || next.libraryId !== session.libraryId) return;
      // The retry response only updates its own card; other cards may already be ahead.
      setState((current) => current?.jobs.includes(job)
        ? { ...current, jobs: current.jobs.map((item) => item === job ? updated : item) }
        : current);
    } catch (cause) {
      toast({ title: message(cause), status: 'error' });
    } finally {
      session.retrying.delete(job.id);
      setRetrying(new Set(session.retrying));
      session.refresh();
    }
  }

  const jobs = state?.jobs ?? noJobs;
  return {
    state, busy, blocking, run, jobs, retrying, retryJob,
    retryPending: state?.status === 'connected' && failed === batchKey(state.candidates),
    blockFailedBatch: (candidates: WorkDirectoryCandidate[]) => setFailed(batchKey(candidates)),
    retryFailedBatch: () => setFailed(null),
  };
}

function batchKey(candidates: WorkDirectoryCandidate[]) { return JSON.stringify(candidates.map((candidate) => candidate.id).sort()); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

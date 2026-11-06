import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  libraryRevision: number,
  onSynced: (commit: WorkDirectoryCommit, revision: number) => void,
  onAvailability: (snapshot: LibrarySnapshot, revision: number) => void,
) {
  const toast = useToast();
  const session = useMemo(createSession, [libraryRevision]);
  const latest = useRef(session);
  useLayoutEffect(() => { latest.current = session; }, [session]);

  const [entry, setEntry] = useState<{ revision: number; value: WorkDirectoryState } | null>(null);
  const [failed, setFailed] = useState<{ revision: number; key: string } | null>(null);
  const [request, setRequest] = useState<{ revision: number; blocking: boolean } | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ revision: number; ids: ReadonlySet<string> } | null>(null);
  const busy = request?.revision === libraryRevision;
  const blocking = busy && request.blocking;
  const retrying = retryRequest?.revision === libraryRevision ? retryRequest.ids : undefined;

  const receiveCommit = useCallback((commit: WorkDirectoryCommit) => {
    if (latest.current !== session) return;
    if (session.libraryId === null) { session.earlyCommits.push(commit); return; }
    if (commit.libraryId !== session.libraryId || session.completed.has(commit.jobId)) return;
    session.completed.add(commit.jobId);
    onSynced({ ...commit, photos: commit.photos.map(withPhotoUrls) }, libraryRevision);
    setEntry((current) => current?.revision === libraryRevision && current.value.jobs.some((job) => job.id === commit.jobId)
      ? { ...current, value: { ...current.value, jobs: current.value.jobs.filter((job) => job.id !== commit.jobId) } }
      : current);
  }, [libraryRevision, onSynced, session]);

  const receiveState = useCallback((value: WorkDirectoryState) => {
    if (latest.current !== session || (session.libraryId !== null && value.libraryId !== session.libraryId)) return false;
    session.libraryId = value.libraryId;
    for (const commit of session.earlyCommits.splice(0)) receiveCommit(commit);
    const jobs = value.jobs.filter((job) => !session.completed.has(job.id));
    setEntry({ revision: libraryRevision, value: { ...value, jobs } });
    return true;
  }, [libraryRevision, receiveCommit, session]);

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
          if (active && started === session.operation) onAvailability(fresh, libraryRevision);
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
  }, [ready, libraryRevision, onAvailability, receiveCommit, receiveState, session, toast]);

  async function run(action: () => Promise<WorkDirectoryState | null>, refreshSnapshot: boolean, blocksWorkspace = true) {
    if (session.locked || session.retrying.size) return null;
    session.locked = true;
    session.operation += 1;
    setRequest({ revision: libraryRevision, blocking: blocksWorkspace });
    try {
      const next = await action();
      if (!next || !receiveState(next)) return null;
      if (refreshSnapshot) {
        try { onAvailability(await loadSnapshot(), libraryRevision); }
        catch (cause) { if (latest.current === session) toast({ title: `目录已更新，无法刷新图库：${message(cause)}`, status: 'error' }); }
      }
      return next;
    } finally {
      session.locked = false;
      if (latest.current === session) {
        setRequest(null);
        session.refresh();
      }
    }
  }

  async function retryJob(job: WorkDirectoryJob) {
    if (session.locked || session.retrying.has(job.id)) return;
    session.retrying.add(job.id);
    setRetryRequest({ revision: libraryRevision, ids: new Set(session.retrying) });
    try {
      const next = await retryWorkDirectoryJob(job.id);
      const updated = next.jobs.find((item) => item.id === job.id);
      if (!updated || latest.current !== session || next.libraryId !== session.libraryId) return;
      // The retry response only updates its own card; other cards may already be ahead.
      setEntry((current) => current?.revision === libraryRevision && current.value.jobs.includes(job)
        ? { ...current, value: { ...current.value, jobs: current.value.jobs.map((item) => item === job ? updated : item) } }
        : current);
    } catch (cause) {
      if (latest.current === session) toast({ title: message(cause), status: 'error' });
    } finally {
      session.retrying.delete(job.id);
      if (latest.current === session) {
        setRetryRequest({ revision: libraryRevision, ids: new Set(session.retrying) });
        session.refresh();
      }
    }
  }

  const state = entry?.revision === libraryRevision ? entry.value : null;
  const jobs = state?.jobs ?? noJobs;
  return {
    state, busy, blocking, run, jobs, retrying, retryJob,
    retryPending: failed?.revision === libraryRevision && state?.status === 'connected' && failed.key === batchKey(state.candidates),
    blockFailedBatch: (candidates: WorkDirectoryCandidate[]) => setFailed({ revision: libraryRevision, key: batchKey(candidates) }),
    retryFailedBatch: () => setFailed(null),
  };
}

function batchKey(candidates: WorkDirectoryCandidate[]) { return JSON.stringify(candidates.map((candidate) => candidate.id).sort()); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

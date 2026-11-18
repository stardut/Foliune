import { t } from '../lib/i18n.ts';
import { useEffect, useRef, useState } from 'react';
import { cancelCuration, chooseLocalPhotoSources, commitCuration, prepareImportFiles } from '../lib/curation-api';
import { cancelLinkImport, prepareLinkImport } from '../lib/photo-import-api';
import type { CurationDraft } from '../lib/curation-types';
import type { LibraryKind, LibrarySnapshot, Photo } from '../lib/types';

function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

// Each preparation owns its draft even after the dialog has moved to another source.
// The generation check disposes late results instead of publishing them into a new session.
export function usePhotoSourceImport({ library, groupId, onBusyChange }: {
  library: LibraryKind; groupId?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<CurationDraft | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [linkProgress, setLinkProgress] = useState<{ total: number | null; photos: Photo[] } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const generation = useRef(0);
  const currentDraft = useRef<CurationDraft | null>(null);
  const request = useRef<string | null>(null);
  const committingRef = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const busy = choosing || preparing || committing || cleaning;
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      const pendingRequest = request.current;
      const pendingDraft = currentDraft.current;
      request.current = null;
      currentDraft.current = null;
      if (pendingRequest) void cancelLinkImport(pendingRequest).catch((cause) => console.error(t('取消链接获取失败', 'Could not cancel link download'), cause));
      if (pendingDraft) void cancelCuration(pendingDraft.id).catch((cause) => console.error(t('清理照片候选失败', 'Could not clear the photo selection draft'), cause));
      busyCallback.current?.(false);
    };
  }, []);

  async function clear(rethrow = false): Promise<boolean> {
    if (committingRef.current) return false;
    generation.current += 1;
    const pendingRequest = request.current;
    const pendingDraft = currentDraft.current;
    request.current = null;
    // Keep ownership until cancellation succeeds, so a failed cleanup can be retried.
    setChoosing(false);
    setPreparing(false);
    setLinkProgress(null);
    setCleaning(true);
    setError('');
    try {
      if (pendingRequest) await cancelLinkImport(pendingRequest);
      if (pendingDraft) await cancelCuration(pendingDraft.id);
      if (currentDraft.current?.id === pendingDraft?.id) currentDraft.current = null;
      if (mounted.current) setDraft(null);
      return true;
    } catch (cause) {
      if (pendingRequest) request.current = pendingRequest;
      const error = new Error(t(`取消失败：${messageOf(cause)}`, `Could not cancel: ${messageOf(cause)}`));
      if (mounted.current) setError(error.message);
      if (rethrow) throw error;
      return false;
    } finally {
      if (mounted.current) setCleaning(false);
    }
  }

  async function chooseLocalPaths() {
    const ownGeneration = generation.current;
    setChoosing(true);
    setError('');
    try {
      const paths = await chooseLocalPhotoSources();
      if (mounted.current && generation.current === ownGeneration) return paths;
    } catch (cause) {
      if (mounted.current && generation.current === ownGeneration) setError(messageOf(cause));
    } finally {
      if (mounted.current && generation.current === ownGeneration) setChoosing(false);
    }
    return [];
  }

  async function prepare(source: 'local' | 'link', input: string, onPreparing: () => void) {
    // Leaving the system picker empty does not start a new import attempt.
    const paths = source === 'local' ? await chooseLocalPaths() : [];
    if (source === 'local' && paths.length === 0) return;
    if (!await clear() || !mounted.current) return;
    const ownGeneration = ++generation.current;
    const requestId = source === 'link' ? crypto.randomUUID() : null;
    request.current = requestId;
    setPreparing(true);
    onPreparing();
    if (requestId) setLinkProgress({ total: null, photos: [] });
    setError('');
    try {
      const next = requestId
        ? await prepareLinkImport(input, library, groupId, requestId, ({ total, photo }) => {
          if (!mounted.current || generation.current !== ownGeneration || request.current !== requestId) return;
          setLinkProgress((current) => current && { total, photos: photo ? [...current.photos, photo] : current.photos });
        })
        : await prepareImportFiles(paths, library, groupId);
      if (!mounted.current || generation.current !== ownGeneration) {
        if (next) await cancelCuration(next.id);
        return;
      }
      currentDraft.current = next;
      setDraft(next);
      return next;
    } catch (cause) {
      if (mounted.current && generation.current === ownGeneration) setError(messageOf(cause));
      else console.error(t('过期照片候选请求或清理失败', 'Stale photo selection request or cleanup failed'), cause);
    } finally {
      if (generation.current === ownGeneration) {
        request.current = null;
        if (mounted.current) {
          setPreparing(false);
          setLinkProgress(null);
        }
      }
    }
  }

  async function commit(draftId: string, keepIds: string[]): Promise<LibrarySnapshot | null> {
    if (currentDraft.current?.id !== draftId || committingRef.current) return null;
    committingRef.current = true;
    setCommitting(true);
    setError('');
    // commit_curation consumes the session on both success and failure.
    currentDraft.current = null;
    try {
      const snapshot = await commitCuration(draftId, keepIds);
      if (mounted.current) setDraft(null);
      return snapshot;
    } catch (cause) {
      if (mounted.current) {
        setDraft(null);
        setError(t(`导入未完成：${messageOf(cause)}。请重新准备照片后再试。`, `Import did not finish: ${messageOf(cause)}. Prepare the photos again and retry.`));
      }
      return null;
    } finally {
      committingRef.current = false;
      if (mounted.current) setCommitting(false);
    }
  }

  return { draft, preparing, linkProgress, committing, cleaning, busy, error, clear, prepare, commit, isMounted: () => mounted.current };
}

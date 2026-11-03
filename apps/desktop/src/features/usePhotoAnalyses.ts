import { useCallback, useEffect, useRef, useState } from 'react';
import { listPhotoAnalyses } from '../lib/ai-api';
import type { PhotoAnalysis } from '../lib/ai-types';

export function usePhotoAnalyses(ready: boolean, libraryRevision: number) {
  const [analyses, setAnalyses] = useState<PhotoAnalysis[]>([]);
  const [error, setError] = useState('');
  const request = useRef(0);
  const reload = useCallback(async () => { const token = ++request.current; setError(''); try { const result = await listPhotoAnalyses(); if (token === request.current) setAnalyses(result); } catch (cause) { if (token !== request.current) return; setAnalyses([]); setError(cause instanceof Error ? cause.message : String(cause)); } }, []);
  useEffect(() => { setAnalyses([]); if (ready) void reload(); return () => { request.current++; }; }, [ready, libraryRevision, reload]);
  const record = useCallback((next: PhotoAnalysis) => setAnalyses((previous) => [next, ...previous.filter((item) => item.photoId !== next.photoId)]), []);
  return { analyses, record, error, reload };
}

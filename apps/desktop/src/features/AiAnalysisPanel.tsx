import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Photo } from '../lib/types';
import { providerName, type AiSettings, type PhotoAnalysis } from '../lib/ai-types';
import { analyzePhoto, loadAiSettings } from '../lib/ai-api';

export function AiAnalysisPanel({ photo, analyses, onAnalysis, onSettings }: { photo: Photo; analyses: PhotoAnalysis[]; onAnalysis: (analysis: PhotoAnalysis) => void; onSettings: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    loadAiSettings().then((value) => { if (!alive) return; setSettings(value); }).catch((cause) => { if (alive) setError(message(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const selected = settings?.connection;
  const results = analyses.filter((analysis) => analysis.photoId === photo.id);
  async function analyze() {
    if (!selected?.vision || !selected.hasKey || busy) return;
    setBusy(true); setError('');
    try { const result = await analyzePhoto(photo.id, selected.provider, prompt.trim() || undefined); if (alive.current) onAnalysis(result); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="ai-analysis">
    <div className="ai-analysis-title"><h3><Sparkles size={13} />AI 分析</h3><button type="button" className="text-button" onClick={onSettings} disabled={busy}>接入设置</button></div>
    {loading ? <p className="muted">正在读取 AI 设置…</p> : !settings ? <p className="muted">AI 设置读取失败，请重新打开照片重试。</p> : !selected ? <p className="muted">请先在接入设置中保存一个模型。</p> : <>
      <p className="muted">{providerName(selected.provider)} · {selected.model}</p>
      {selected.vision && selected.hasKey ? <>
        <label>分析方向（可选）<textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：画面光线与构图" disabled={busy} /></label>
        <p className="muted">点击后将照片预览发送给{providerName(selected.provider)}，按其 API 计费。结果独立保存。</p>
      </> : <p className="muted">{!selected.hasKey ? '请在接入设置中保存 API Key。' : '当前模型未启用图像输入，请在接入设置中修改。'}</p>}
      <button type="button" className="button" disabled={busy || !selected.vision || !selected.hasKey || !photo.originalAvailable} onClick={() => void analyze()}><Sparkles size={13} />{busy ? '正在分析…' : '分析这张照片'}</button>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ai-results">{results.map((result) => <article key={`${result.provider}:${result.analyzedAt}`}><p>{providerName(result.provider)} · {result.model}<span>{new Date(result.analyzedAt).toLocaleString('zh-CN')}</span></p><div>{result.text}</div></article>)}</div>
  </section>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

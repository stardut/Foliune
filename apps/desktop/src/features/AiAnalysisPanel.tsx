import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Photo } from '../lib/types';
import type { AiProvider, AiSettings, PhotoAnalysis } from '../lib/ai-types';
import { analyzePhoto, loadAiSettings } from '../lib/ai-api';

export function AiAnalysisPanel({ photo, analyses, onAnalysis, onSettings }: { photo: Photo; analyses: PhotoAnalysis[]; onAnalysis: (analysis: PhotoAnalysis) => void; onSettings: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let alive = true;
    loadAiSettings().then((value) => { if (!alive) return; setSettings(value); const available = value.providers.find((item) => item.vision && item.hasKey); if (available) setProvider(available.provider); }).catch((cause) => { if (alive) setError(message(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const selected = settings?.providers.find((item) => item.provider === provider);
  const results = analyses.filter((analysis) => analysis.photoId === photo.id);
  async function analyze() {
    setBusy(true); setError('');
    try { const result = await analyzePhoto(photo.id, provider, prompt.trim() || undefined); if (alive.current) onAnalysis(result); }
    catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="ai-analysis"><div className="ai-analysis-title"><h3><Sparkles size={13} />AI 分析</h3><button type="button" className="text-button" onClick={onSettings}>接入设置</button></div>{loading ? <p className="muted">正在读取 AI 设置…</p> : <><label>提供方<select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)} disabled={busy}>{settings?.providers.map((item) => <option key={item.provider} value={item.provider}>{providerName(item.provider)} · {item.model}</option>)}</select></label><label>分析方向（可选）<textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：画面光线与构图" disabled={busy} /></label><p className="muted">点击后将照片预览发给所选提供方，按其 API 计费。结果独立保存，不改人工标注。</p>{selected && !selected.vision && <p className="muted">当前所选模型未启用图像输入，请在设置中选择支持视觉的模型。</p>}{selected && !selected.hasKey && <p className="muted">请先在设置中保存此提供方的 API Key。</p>}<button type="button" className="button" disabled={busy || !selected?.vision || !selected.hasKey || !photo.originalAvailable} onClick={() => void analyze()}><Sparkles size={13} />{busy ? '正在分析…' : '分析这张照片'}</button></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="ai-results">{results.map((result) => <article key={`${result.provider}:${result.analyzedAt}`}><p>{providerName(result.provider)} · {result.model}<span>{new Date(result.analyzedAt).toLocaleString('zh-CN')}</span></p><div>{result.text}</div></article>)}</div></section>;
}
export function providerName(provider: AiProvider) { return ({ openai: 'OpenAI', anthropic: 'Claude', deepseek: 'DeepSeek' })[provider]; }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

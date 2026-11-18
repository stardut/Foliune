import { getLocale, t } from '../lib/i18n';
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
    <div className="ai-analysis-title"><h3><Sparkles size={13} />{t('AI 分析', 'AI Analysis')}</h3><button type="button" className="text-button" onClick={onSettings} disabled={busy}>{t('接入设置', 'Connection Settings')}</button></div>
    {loading ? <p className="muted">{t('正在读取 AI 设置…', 'Loading AI settings…')}</p> : !settings ? <p className="muted">{t('AI 设置读取失败，请重新打开照片重试。', 'Could not load AI settings. Reopen the photo to try again.')}</p> : !selected ? <p className="muted">{t('请先在接入设置中保存一个模型。', 'Save a model in Connection Settings first.')}</p> : <>
      <p className="muted">{providerName(selected.provider)} · {selected.model}</p>
      {selected.vision && selected.hasKey ? <>
        <label>{t('分析方向（可选）', 'Analysis focus (optional)')}<textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('例如：画面光线与构图', 'For example, lighting and composition')} disabled={busy} /></label>
        <p className="muted">{t(`点击后将照片预览发送给 ${providerName(selected.provider)}，按其 API 计费。结果独立保存。`, `The photo preview will be sent to ${providerName(selected.provider)}. API charges apply. Results are saved separately.`)}</p>
      </> : <p className="muted">{!selected.hasKey ? t('请在接入设置中保存 API Key。', 'Save an API key in Connection Settings.') : t('当前模型未启用图像输入，请在接入设置中修改。', 'The current model has image input disabled. Enable it in Connection Settings.')}</p>}
      <button type="button" className="button" disabled={busy || !selected.vision || !selected.hasKey || !photo.originalAvailable} onClick={() => void analyze()}><Sparkles size={13} />{busy ? t('正在分析…', 'Analyzing…') : t('分析这张照片', 'Analyze This Photo')}</button>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ai-results">{results.map((result) => <article key={`${result.provider}:${result.analyzedAt}`}><p>{providerName(result.provider)} · {result.model}<span>{new Date(result.analyzedAt).toLocaleString(getLocale())}</span></p><div>{result.text}</div></article>)}</div>
  </section>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { DropdownSelect } from '../components/DropdownSelect';
import { aiProviders, type AiProvider, type AiSettings, type AiSettingsInput } from '../lib/ai-types';

const providerOptions = aiProviders.map(({ id, name }) => ({ value: id, label: name }));

export function AiConnectionForm({ settings, disabled, onSave, onRemove }: {
  settings: AiSettings;
  disabled: boolean;
  onSave: (input: AiSettingsInput) => Promise<void>;
  onRemove: (provider: AiProvider) => Promise<void>;
}) {
  const saved = settings.connection;
  const [provider, setProvider] = useState<AiProvider>(saved?.provider ?? 'openai');
  const [model, setModel] = useState(saved?.model ?? aiProviders[0].model);
  const [vision, setVision] = useState(saved?.vision ?? true);
  const [key, setKey] = useState('');
  const [operation, setOperation] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const hasSavedKey = saved?.provider === provider && saved.hasKey;
  const textOnly = provider === 'deepseek' && ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'].includes(model.trim());
  const locked = disabled || operation !== null;
  function selectProvider(next: AiProvider) {
    setProvider(next); setKey(''); setError('');
    setModel(saved?.provider === next ? saved.model : aiProviders.find((item) => item.id === next)!.model);
    setVision(saved?.provider === next ? saved.vision : true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    setOperation('save'); setError('');
    try { await onSave({ provider, model: model.trim(), vision: !textOnly && vision, ...(key.trim() ? { apiKey: key.trim() } : {}) }); setKey(''); }
    catch (cause) { setError(message(cause)); }
    finally { setOperation(null); }
  }
  async function remove() {
    if (locked || !saved) return;
    setOperation('remove'); setError('');
    try { await onRemove(saved.provider); setKey(''); }
    catch (cause) { setError(message(cause)); }
    finally { setOperation(null); }
  }
  return <form className="provider-form" onSubmit={(event) => void save(event)} aria-busy={operation !== null}>
    <div className="provider-fields">
      <DropdownSelect label="提供方" field value={provider} options={providerOptions} disabled={locked} onChange={selectProvider} />
      <label>模型<input required maxLength={200} value={model} disabled={locked} onChange={(event) => setModel(event.target.value)} /></label>
      <label className="provider-key">API Key<input type="password" autoComplete="off" spellCheck={false} required={!hasSavedKey} value={key} disabled={locked} onChange={(event) => setKey(event.target.value)} placeholder={hasSavedKey ? '留空保留已保存的 Key' : '输入此提供方的 API Key'} /></label>
    </div>
    <div className="provider-actions">
      <label><input type="checkbox" checked={!textOnly && vision} disabled={locked || textOnly} onChange={(event) => setVision(event.target.checked)} />图像输入</label>
      {hasSavedKey && <span className="provider-key-state"><KeyRound size={11} />Key 已保存</span>}
      {saved?.provider === provider && <button type="button" className="text-button" disabled={locked} onClick={() => void remove()} title="移除当前接入及其系统 API Key">{operation === 'remove' ? '移除中…' : '移除接入与 Key'}</button>}
      <button className="button button-primary" type="submit" disabled={locked}>{operation === 'save' ? '保存中…' : '保存'}</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

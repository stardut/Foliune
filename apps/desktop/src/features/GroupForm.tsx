import { useState, type FormEvent } from 'react';
import type { Group } from '../lib/types';
import { Modal } from '../components/ui';

export function GroupForm({ group, defaultCapacity, counts, busy, onClose, onSave }: {
  group?: Group; defaultCapacity?: number; counts?: { active: number; discarded: number }; busy: boolean; onClose: () => void;
  onSave: (values: { name: string; description: string; capacity: number | null }) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [capacity, setCapacity] = useState((group ? group.capacity : defaultCapacity)?.toString() ?? '');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!name.trim()) { setError('请填写相簿名称'); return; }
    const parsed = capacity.trim() ? Number(capacity) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) { setError('上限需为正整数，留空表示不限'); return; }
    try { await onSave({ name: name.trim(), description: description.trim(), capacity: parsed }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title={group ? '相簿信息' : '新建相簿'} onClose={onClose}><form onSubmit={submit} className="stack-form">{counts && <p className="album-info-count">{counts.active} 张照片{counts.discarded > 0 ? ` · 已废弃 ${counts.discarded} 张` : ''}</p>}<label>名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label><label>简介<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label><label>照片上限<input type="number" min="1" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="不限" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" onClick={onClose}>取消</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div></form></Modal>;
}

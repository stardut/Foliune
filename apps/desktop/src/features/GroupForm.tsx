import { photoCount, t } from '../lib/i18n';
import { useState, type FormEvent } from 'react';
import type { GroupInfoInput } from '../lib/curation-types';
import type { Group } from '../lib/types';
import { Modal } from '../components/ui';

export function GroupForm({ group, defaultCapacity, counts, busy, onClose, onSave }: {
  group?: Group; defaultCapacity?: number; counts?: { active: number; discarded: number }; busy: boolean; onClose: () => void;
  onSave: (values: GroupInfoInput) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || '');
  const [description, setDescription] = useState(group?.description || '');
  const [capacity, setCapacity] = useState((group ? group.capacity : defaultCapacity)?.toString() ?? '');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!name.trim()) { setError(t('请填写相簿名称', 'Enter an album name')); return; }
    const parsed = capacity.trim() ? Number(capacity) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) { setError(t('上限需为正整数，留空表示不限', 'Enter a positive whole number or leave blank for no limit')); return; }
    try { await onSave({ name: name.trim(), description: description.trim(), capacity: parsed }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title={group ? t('相簿信息', 'Album Info') : t('新建相簿', 'New Album')} onClose={onClose} closeDisabled={busy} glass><form onSubmit={submit} className="stack-form">{counts && <p className="album-info-count">{photoCount(counts.active)}{counts.discarded > 0 ? t(` · 已废弃 ${counts.discarded} 张`, ` · ${counts.discarded} rejected`) : ''}</p>}<label>{t('名称', 'Name')}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label><label>{t('简介', 'Description')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label><label>{t('照片上限', 'Photo Limit')}<input type="number" min="1" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder={t('不限', 'Unlimited')} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>{t('取消', 'Cancel')}</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button></div></form></Modal>;
}

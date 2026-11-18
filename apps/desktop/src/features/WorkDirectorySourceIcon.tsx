import { t } from '../lib/i18n';
import { FolderSync } from 'lucide-react';

export function WorkDirectorySourceIcon({ id }: { id?: string }) {
  return <span id={id} className="work-directory-source" role="img" aria-label={t('来自作品目录', 'From the Work Folder')} title={t('来自作品目录', 'From the Work Folder')}>
    <FolderSync size={14} strokeWidth={1.6} aria-hidden="true" />
  </span>;
}

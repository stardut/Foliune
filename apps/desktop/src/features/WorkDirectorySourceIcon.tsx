import { FolderSync } from 'lucide-react';

export function WorkDirectorySourceIcon({ id }: { id?: string }) {
  return <span id={id} className="work-directory-source" role="img" aria-label="来自作品目录" title="来自作品目录">
    <FolderSync size={14} strokeWidth={1.6} aria-hidden="true" />
  </span>;
}

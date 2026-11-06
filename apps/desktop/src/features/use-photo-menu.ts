import { useContextMenu, type ContextMenuAction } from './use-context-menu';

export { isContextMenuTracking as isPhotoMenuTracking } from './use-context-menu';

export interface PhotoMenuAction extends ContextMenuAction {
  id: 'preview' | 'detail' | 'select' | 'cover' | 'compare' | 'play' | 'book' | 'group' | 'membership' | 'collage' | 'airdrop';
}

export function usePhotoMenu(context: string, onError: (message: string) => void) {
  return useContextMenu('photo', context, onError);
}

export type OptionalWorkspace = 'models' | 'planning';
export type WorkspaceVisibility = Readonly<Record<OptionalWorkspace, boolean>>;

export const defaultWorkspaceVisibility: WorkspaceVisibility = { models: true, planning: true };

function preferenceKey(workspace: OptionalWorkspace) {
  return `foliune.workspace.${workspace}`;
}

export function readWorkspaceVisibility(): WorkspaceVisibility {
  try {
    return {
      models: window.localStorage.getItem(preferenceKey('models')) !== 'hidden',
      planning: window.localStorage.getItem(preferenceKey('planning')) !== 'hidden',
    };
  } catch { return defaultWorkspaceVisibility; }
}

export function saveWorkspaceVisibility(workspace: OptionalWorkspace, visible: boolean) {
  window.localStorage.setItem(preferenceKey(workspace), visible ? 'visible' : 'hidden');
}

export function isWorkspaceVisible(workspace: string, visibility: WorkspaceVisibility) {
  return (workspace !== 'models' && workspace !== 'planning') || visibility[workspace];
}

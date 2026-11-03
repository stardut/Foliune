import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ModelInput, ModelProfile } from './model-types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中使用模特档案。');
  try { return await invoke<T>(command, args); }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : String(cause)); }
}

export const listModels = (): Promise<ModelProfile[]> => call('models_list');
export const saveModel = (id: string | null, input: ModelInput): Promise<ModelProfile> => call('models_save', { id, input });
export const deleteModel = (id: string): Promise<void> => call('models_delete', { id });

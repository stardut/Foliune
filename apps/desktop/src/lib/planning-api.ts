import { invoke, isTauri } from '@tauri-apps/api/core';
import { withImageUrls } from './api';
import { PLAN_PNG_MAX_BYTES, type ShootPlan, type ShootPlanInput } from './planning-types';
import type { LibrarySnapshot } from './types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中使用拍摄策划。');
  try { return await invoke<T>(command, args); }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : String(cause)); }
}

export const listPlans = (): Promise<ShootPlan[]> => call('plans_list');
export const savePlan = (id: string | null, input: ShootPlanInput): Promise<ShootPlan> => call('plans_save', { id, input });
export const deletePlan = async (id: string) => withImageUrls(await call<LibrarySnapshot>('plans_delete', { id }));

export async function exportPlanPng(directory: string, title: string, png: Uint8Array): Promise<string> {
  if (!png.length || png.length > PLAN_PNG_MAX_BYTES) throw new Error('策划长图不能为空，且不能超过 64 MiB。');
  return call<string>('plans_export_png', { directory, title, bytes: Array.from(png) });
}

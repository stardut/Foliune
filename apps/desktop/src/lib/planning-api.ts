import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { PLAN_PNG_MAX_BYTES, type ShootPlan, type ShootPlanInput } from './planning-types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中使用拍摄策划。');
  try { return await invoke<T>(command, args); }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : String(cause)); }
}

export const listPlans = (): Promise<ShootPlan[]> => call('plans_list');
export const savePlan = (id: string | null, input: ShootPlanInput): Promise<ShootPlan> => call('plans_save', { id, input });
export const deletePlan = (id: string): Promise<void> => call('plans_delete', { id });

export async function exportPlanPng(title: string, png: Uint8Array): Promise<string | null> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中导出拍摄策划。');
  if (!png.length || png.length > PLAN_PNG_MAX_BYTES) throw new Error('策划长图不能为空，且不能超过 64 MiB。');
  const safeName = Array.from(title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'))
    .slice(0, 60).join('').replace(/[. ]+$/, '') || '拍摄策划';
  const path = await save({ title: '导出拍摄策划长图', defaultPath: `${safeName}.png`, filters: [{ name: 'PNG 长图', extensions: ['png'] }] });
  if (!path) return null;
  await call<void>('plans_export_png', { path, bytes: Array.from(png) });
  return path;
}

import type { PlanReference, ShootPlanInput } from '../../lib/planning-types';
import { partFields, partName, priorityLabels, sharedFields, shotFields, shotName } from './plan-content.ts';

export type PlanExportBlock =
  | { kind: 'section-start'; scope: 'overview' | 'preparation' | 'scene' | 'execution' }
  | { kind: 'section-end' }
  | { kind: 'section'; value: string }
  | { kind: 'field'; label: string; value: string }
  | { kind: 'scene-heading'; title: string; time: string }
  | { kind: 'text'; role: 'title' | 'shot' | 'body' | 'meta'; value: string }
  | { kind: 'reference-row'; scope: 'scene'; columns: 1 | 2; references: PlanReference[] };

/** Phone reading order; explicit semantic sections never depend on matching written labels. */
export function planExportBlocks(plan: ShootPlanInput): PlanExportBlock[] {
  const blocks: PlanExportBlock[] = [];
  function text(role: Extract<PlanExportBlock, { kind: 'text' }>['role'], value: string) { if (value.trim()) blocks.push({ kind: 'text', role, value }); }
  function field(label: string, value: string) { if (value.trim()) blocks.push({ kind: 'field', label, value }); }
  function section(value: string) { blocks.push({ kind: 'section', value }); }
  function group(scope: Extract<PlanExportBlock, { kind: 'section-start' }>['scope'], content: () => void) {
    blocks.push({ kind: 'section-start', scope }); content(); blocks.push({ kind: 'section-end' });
  }
  function referenceNotes(refs: PlanReference[]) { return refs.filter((ref) => ref.intent.trim()).map((ref) => ref.intent).join('\n'); }
  group('overview', () => {
    text('title', plan.title);
    field('创作构想', plan.concept);
    for (const [key, label] of [['shootDate', '拍摄时间'], ['location', '地点'], ['team', '出镜与团队'], ['deliverables', '成片与用途']] as const) field(label, plan[key]);
    const overallNotes = referenceNotes(plan.references);
    if (plan.visualDirection.trim() || overallNotes) { section('整体视觉'); text('body', plan.visualDirection); field('参考要点', overallNotes); }
  });
  if (sharedFields.some(([key]) => plan[key].trim())) group('preparation', () => {
    section('整组准备');
    for (const [key, label] of sharedFields) field(label, plan[key]);
  });
  for (const [partIndex, part] of plan.parts.entries()) group('scene', () => {
    blocks.push({ kind: 'scene-heading', title: `场景 ${String(partIndex + 1).padStart(2, '0')} · ${partName(part, partIndex)}`, time: part.timeWindow });
    text('body', part.description);
    section('参考图');
    if (!part.references.length) text('meta', '暂无参考图');
    // Two columns remain constant in continuation rows, including historical over-limit scenes.
    for (let index = 0; index < part.references.length; index += 2) blocks.push({ kind: 'reference-row', scope: 'scene', columns: part.references.length === 1 ? 1 : 2, references: part.references.slice(index, index + 2) });
    section('拍摄参数');
    for (const [key, label] of partFields) field(label, part[key]);
    if (!partFields.some(([key]) => part[key].trim())) text('meta', '暂无拍摄参数');
    section('镜头清单');
    if (!part.shots.length) text('meta', '暂无镜头');
    for (const [shotIndex, shot] of part.shots.entries()) {
      text('shot', `${String(shotIndex + 1).padStart(2, '0')} · ${shotName(shot, shotIndex)}${shot.priority === 'normal' ? '' : `  /  ${priorityLabels[shot.priority]}`}`);
      field('关键拍法', shot.description);
      for (const [key, label] of shotFields) field(label, shot[key]);
      field('参考要点', referenceNotes(shot.references));
    }
  });
  if (plan.preparation.trim()) group('execution', () => { section('执行准备'); text('body', plan.preparation); });
  return blocks;
}

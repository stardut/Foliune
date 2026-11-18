import { t } from '../../lib/i18n.ts';
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
    field(t('创作构想', 'Concept'), plan.concept);
    for (const [key, label] of [['shootDate', t('拍摄时间', 'Shoot Hours')], ['location', t('地点', 'Location')], ['team', t('出镜与团队', 'Cast and Crew')], ['deliverables', t('成片与用途', 'Deliverables and Usage')]] as const) field(label, plan[key]);
    const overallNotes = referenceNotes(plan.references);
    if (plan.visualDirection.trim() || overallNotes) { section(t('整体视觉', 'Visual Direction')); text('body', plan.visualDirection); field(t('参考要点', 'Reference Notes'), overallNotes); }
  });
  if (sharedFields.some(([key]) => plan[key].trim())) group('preparation', () => {
    section(t('整组准备', 'Shoot Setup'));
    for (const [key, label] of sharedFields) field(label, plan[key]);
  });
  for (const [partIndex, part] of plan.parts.entries()) group('scene', () => {
    blocks.push({ kind: 'scene-heading', title: t(`场景 ${String(partIndex + 1).padStart(2, '0')} · ${partName(part, partIndex)}`, `Scene ${String(partIndex + 1).padStart(2, '0')} · ${partName(part, partIndex)}`), time: part.timeWindow });
    text('body', part.description);
    section(t('参考图', 'Reference Photos'));
    if (!part.references.length) text('meta', t('暂无参考图', 'No Reference Photos'));
    // Two columns remain constant in continuation rows, including historical over-limit scenes.
    for (let index = 0; index < part.references.length; index += 2) blocks.push({ kind: 'reference-row', scope: 'scene', columns: part.references.length === 1 ? 1 : 2, references: part.references.slice(index, index + 2) });
    section(t('拍摄参数', 'Shooting Notes'));
    for (const [key, label] of partFields) field(label, part[key]);
    if (!partFields.some(([key]) => part[key].trim())) text('meta', t('暂无拍摄参数', 'No Shooting Notes'));
    section(t('镜头清单', 'Shot List'));
    if (!part.shots.length) text('meta', t('暂无镜头', 'No Shots Yet'));
    for (const [shotIndex, shot] of part.shots.entries()) {
      text('shot', `${String(shotIndex + 1).padStart(2, '0')} · ${shotName(shot, shotIndex)}${shot.priority === 'normal' ? '' : `  /  ${priorityLabels[shot.priority]}`}`);
      field(t('关键拍法', 'How to Shoot'), shot.description);
      for (const [key, label] of shotFields) field(label, shot[key]);
      field(t('参考要点', 'Reference Notes'), referenceNotes(shot.references));
    }
  });
  if (plan.preparation.trim()) group('execution', () => { section(t('执行准备', 'Logistics')); text('body', plan.preparation); });
  return blocks;
}

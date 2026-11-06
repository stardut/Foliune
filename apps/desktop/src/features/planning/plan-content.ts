import { PLAN_MAX_SCENE_REFERENCES, type PlanPart, type PlanShot, type ShootPlan, type ShootPlanInput } from '../../lib/planning-types.ts';

export const partFields = [['lighting', '光影'], ['focalLength', '镜头焦段'], ['scene', '场地'], ['styling', '场景补充'], ['mood', '情绪']] as const;
export const sharedFields = [['styling', '妆造'], ['props', '道具'], ['equipment', '器材']] as const;
export const shotFields = [['pose', '姿态与动作'], ['composition', '景别与构图'], ['lighting', '光线'], ['mood', '情绪']] as const;
export const priorityLabels = { normal: '常规', must: '必拍', try: '尝试' } as const;
export function inputOf(plan?: ShootPlan): ShootPlanInput {
  return structuredClone(plan ? {
    title: plan.title, concept: plan.concept, executionDate: plan.executionDate ?? '', shootDate: plan.shootDate, location: plan.location,
    team: plan.team, deliverables: plan.deliverables, visualDirection: plan.visualDirection,
    styling: plan.styling ?? '', props: plan.props ?? '', equipment: plan.equipment ?? '',
    preparation: plan.preparation, references: plan.references, parts: plan.parts.map((part) => ({ ...part, shotList: part.shotList ?? '', focalLength: part.focalLength ?? '' })),
  } : { title: '', concept: '', executionDate: '', shootDate: '', location: '', team: '', deliverables: '', visualDirection: '', styling: '', props: '', equipment: '', preparation: '', references: [], parts: [] });
}
export function newPart(): PlanPart { return { id: crypto.randomUUID(), title: '', description: '', shotList: '', scene: '', styling: '', lighting: '', focalLength: '', mood: '', timeWindow: '', references: [], shots: [] }; }
export function newShot(): PlanShot { return { id: crypto.randomUUID(), title: '', description: '', pose: '', composition: '', lighting: '', mood: '', priority: 'normal', references: [] }; }
export function referenceCount(plan: ShootPlanInput) { return plan.references.length + plan.parts.reduce((sum, part) => sum + part.references.length + part.shots.reduce((count, shot) => count + shot.references.length, 0), 0); }
export function shotCount(plan: ShootPlanInput) { return plan.parts.reduce((sum, part) => sum + part.shots.length, 0); }
export function hasContent(item: PlanPart | PlanShot): boolean { return Object.entries(item).some(([key, value]) => key !== 'id' && key !== 'priority' && (typeof value === 'string' ? !!value.trim() : Array.isArray(value) && value.length > 0)) || ('priority' in item && item.priority !== 'normal'); }
export function moved<T>(items: T[], index: number, offset: number): T[] { const next = [...items]; const target = index + offset; if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; }
export function partName(part: PlanPart, index: number) { return part.title.trim() || `场景 ${String(index + 1).padStart(2, '0')}`; }
export function shotName(shot: PlanShot, index: number) { return shot.title.trim() || `镜头 ${String(index + 1).padStart(2, '0')}`; }
export function planSearchFields(plan: ShootPlanInput): [label: string, value: string][] {
  const fields: [string, string][] = [
    ['标题', plan.title], ['主题', plan.concept], ['执行日期', plan.executionDate], ['拍摄时间', plan.shootDate],
    ['地点', plan.location], ['团队', plan.team], ['成片用途', plan.deliverables], ['整体视觉', plan.visualDirection],
  ];
  for (const [key, label] of sharedFields) fields.push([label, plan[key]]);
  fields.push(['执行准备', plan.preparation]);
  for (const reference of plan.references) fields.push(['整体视觉 · 参考意图', reference.intent]);
  plan.parts.forEach((part, index) => {
    const scene = partName(part, index);
    fields.push(['场景', part.title], [`${scene} · 拍摄时段`, part.timeWindow], [scene, part.description]);
    for (const [key, label] of partFields) fields.push([`${scene} · ${label}`, part[key]]);
    for (const reference of part.references) fields.push([`${scene} · 参考意图`, reference.intent]);
    part.shots.forEach((shot, shotIndex) => {
      const lens = `${scene} · ${shotName(shot, shotIndex)}`;
      fields.push([`${scene} · 镜头`, shot.title], [lens, shot.description]);
      for (const [key, label] of shotFields) fields.push([`${lens} · ${label}`, shot[key]]);
      for (const reference of shot.references) fields.push([`${lens} · 参考意图`, reference.intent]);
    });
  });
  return fields;
}
export function planSearchText(plan: ShootPlanInput) { return planSearchFields(plan).map(([, value]) => value).join(' '); }
export function comparePlanExecutionDate(a: ShootPlan, b: ShootPlan) {
  return (b.executionDate ?? '').localeCompare(a.executionDate ?? '') || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
export function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

export function sceneReferenceLimitError(plan: ShootPlanInput): string | null {
  const names = plan.parts.flatMap((part, index) => part.references.length > PLAN_MAX_SCENE_REFERENCES ? [partName(part, index)] : []);
  return names.length ? `场景“${names.join('”、“')}”的参考图超过 3 张，请移除多余引用后保存。` : null;
}

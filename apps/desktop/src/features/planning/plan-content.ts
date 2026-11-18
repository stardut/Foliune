import { t } from '../../lib/i18n.ts';
import { PLAN_MAX_SCENE_REFERENCES, type PlanPart, type PlanReference, type PlanShot, type ShootPlan, type ShootPlanInput } from '../../lib/planning-types.ts';

export const partFields = [['lighting', t('光影', 'Lighting')], ['focalLength', t('镜头焦段', 'Focal Length')], ['scene', t('场地', 'Location')], ['styling', t('场景补充', 'Scene Details')], ['mood', t('情绪', 'Mood')]] as const;
export const sharedFields = [['styling', t('妆造', 'Hair and Makeup')], ['props', t('道具', 'Props')], ['equipment', t('器材', 'Gear')]] as const;
export const shotFields = [['pose', t('姿态与动作', 'Pose and Action')], ['composition', t('景别与构图', 'Framing and Composition')], ['lighting', t('光线', 'Light')], ['mood', t('情绪', 'Mood')]] as const;
export const priorityLabels = { normal: t('常规', 'Normal'), must: t('必拍', 'Must Shoot'), try: t('尝试', 'Try') } as const;
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
export function referencesFromSelection(references: PlanReference[], photoIds: string[]): PlanReference[] {
  const selected = new Set(photoIds);
  const retained = references.filter((reference) => selected.has(reference.photoId));
  const existing = new Set(retained.map((reference) => reference.photoId));
  const added = [...selected].filter((photoId) => !existing.has(photoId))
    .map((photoId) => ({ id: crypto.randomUUID(), photoId, intent: '' }));
  return [...retained, ...added];
}
export function shotCount(plan: ShootPlanInput) { return plan.parts.reduce((sum, part) => sum + part.shots.length, 0); }
export function hasContent(item: PlanPart | PlanShot): boolean { return Object.entries(item).some(([key, value]) => key !== 'id' && key !== 'priority' && (typeof value === 'string' ? !!value.trim() : Array.isArray(value) && value.length > 0)) || ('priority' in item && item.priority !== 'normal'); }
export function moved<T>(items: T[], index: number, offset: number): T[] { const next = [...items]; const target = index + offset; if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; }
export function partName(part: PlanPart, index: number) { return part.title.trim() || t(`场景 ${String(index + 1).padStart(2, '0')}`, `Scene ${String(index + 1).padStart(2, '0')}`); }
export function shotName(shot: PlanShot, index: number) { return shot.title.trim() || t(`镜头 ${String(index + 1).padStart(2, '0')}`, `Shot ${String(index + 1).padStart(2, '0')}`); }
export function planSearchFields(plan: ShootPlanInput): [label: string, value: string][] {
  const fields: [string, string][] = [
    [t('标题', 'Title'), plan.title], [t('主题', 'Concept'), plan.concept], [t('执行日期', 'Shoot Date'), plan.executionDate], [t('拍摄时间', 'Shoot Hours'), plan.shootDate],
    [t('地点', 'Location'), plan.location], [t('团队', 'Cast and Crew'), plan.team], [t('成片用途', 'Deliverables and Usage'), plan.deliverables], [t('整体视觉', 'Visual Direction'), plan.visualDirection],
  ];
  for (const [key, label] of sharedFields) fields.push([label, plan[key]]);
  fields.push([t('执行准备', 'Logistics'), plan.preparation]);
  for (const reference of plan.references) fields.push([t('全案参考图 · 参考意图', 'Overall References · Note'), reference.intent]);
  plan.parts.forEach((part, index) => {
    const scene = partName(part, index);
    fields.push([t('场景', 'Scene'), part.title], [t(`${scene} · 拍摄时段`, `${scene} · Time Slot`), part.timeWindow], [scene, part.description]);
    for (const [key, label] of partFields) fields.push([`${scene} · ${label}`, part[key]]);
    for (const reference of part.references) fields.push([t(`${scene} · 参考意图`, `${scene} · Reference Note`), reference.intent]);
    part.shots.forEach((shot, shotIndex) => {
      const lens = `${scene} · ${shotName(shot, shotIndex)}`;
      fields.push([t(`${scene} · 镜头`, `${scene} · Shot`), shot.title], [lens, shot.description]);
      for (const [key, label] of shotFields) fields.push([`${lens} · ${label}`, shot[key]]);
      for (const reference of shot.references) fields.push([t(`${lens} · 参考意图`, `${lens} · Reference Note`), reference.intent]);
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
  return names.length ? t(`场景“${names.join('”、“')}”的参考图超过 3 张，请移除多余引用后保存。`, `Remove extra reference photos from these scenes before saving (maximum 3 per scene): ${names.map((name) => `“${name}”`).join(', ')}.`) : null;
}

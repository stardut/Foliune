export interface PlanReference {
  id: string;
  photoId: string;
  intent: string;
}

export interface PlanShot {
  id: string;
  title: string;
  description: string;
  pose: string;
  composition: string;
  lighting: string;
  mood: string;
  priority: 'normal' | 'must' | 'try';
  references: PlanReference[];
}

export interface PlanPart {
  id: string;
  title: string;
  description: string;
  shotList: string;
  scene: string;
  styling: string;
  lighting: string;
  focalLength: string;
  mood: string;
  timeWindow: string;
  references: PlanReference[];
  shots: PlanShot[];
}

export interface ShootPlanInput {
  title: string;
  concept: string;
  executionDate: string;
  shootDate: string;
  location: string;
  team: string;
  deliverables: string;
  visualDirection: string;
  styling: string;
  props: string;
  equipment: string;
  preparation: string;
  references: PlanReference[];
  parts: PlanPart[];
}

export interface ShootPlan extends ShootPlanInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// Keep these limits aligned with planning.rs and planning_export.rs.
export const PLAN_MAX_REFERENCES = 120;
export const PLAN_MAX_SCENE_REFERENCES = 3;
export const PLAN_MAX_PARTS = 20;
export const PLAN_MAX_SHOTS = 100;
export const PLAN_MAX_TEXT = 20_000;
export const PLAN_MAX_TITLE = 200;
export const PLAN_MAX_DATE = 100;
export const PLAN_PNG_MAX_EDGE = 32_768;
export const PLAN_PNG_MAX_PIXELS = 40_000_000;
export const PLAN_PNG_MAX_BYTES = 64 * 1024 * 1024;

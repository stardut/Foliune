import { call } from './api';
import type { CollageInput } from './collage-types';

export const exportCollagePng = (directory: string, input: CollageInput) =>
  call<string>('export_collage_png', { directory, input });

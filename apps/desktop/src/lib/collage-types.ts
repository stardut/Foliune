import type { LibraryKind } from './types';

export interface CollageItem {
  photoId: string;
  /** 整数输出像素，矩形须在画布内。 */
  x: number;
  y: number;
  width: number;
  height: number;
  fit: 'contain' | 'cover';
  /** cover 溢出部分的裁切比例，0 左/上、0.5 居中、1 右/下。 */
  offsetX: number;
  offsetY: number;
  /** cover 的 1–8 倍缩放；contain 固定为 1 并完整居中。 */
  zoom: number;
}

export interface CollageInput {
  library: LibraryKind;
  groupId: string;
  title: string;
  /** 默认保留来源有效像素；单边最多 32768，总像素最多 160,000,000。 */
  width: number;
  height: number;
  background: string;
  /** 1–100 张，按数组顺序合成。 */
  items: CollageItem[];
}

import { PLAN_PNG_MAX_BYTES, PLAN_PNG_MAX_EDGE, PLAN_PNG_MAX_PIXELS, type ShootPlanInput } from '../../lib/planning-types.ts';
import type { Photo } from '../../lib/types';
import { planExportBlocks, type PlanExportBlock } from './plan-export-content.ts';
import { wrapPlanText } from './plan-text.ts';

const WIDTH = 1080;
const MARGIN = 64;
const CONTENT_X = MARGIN;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;
const GROUP_GAP = 36;
const SCENE_GAP = 56;
const SCENE_RULE_GAP = 32;
const SCENE_RULE_HEIGHT = 2;
const EXECUTION_GAP = 48;
const FIELD_LABEL_WIDTH = 204;
const FIELD_GAP = 20;
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif';
const textStyles = {
  title: { size: 64, lineHeight: 84, weight: 500, color: '#24272b', before: 0, after: 24 },
  section: { size: 38, lineHeight: 56, weight: 500, color: '#3d4248', before: 24, after: 18 },
  part: { size: 48, lineHeight: 68, weight: 500, color: '#24272b', before: 0, after: 18 },
  shot: { size: 42, lineHeight: 60, weight: 500, color: '#24272b', before: 18, after: 12 },
  body: { size: 40, lineHeight: 60, weight: 400, color: '#24272b', before: 0, after: 16 },
  meta: { size: 36, lineHeight: 54, weight: 400, color: '#62686e', before: 0, after: 12 },
  intent: { size: 36, lineHeight: 54, weight: 400, color: '#555b62', before: 0, after: 16 },
} as const;
type TextStyle = { size: number; lineHeight: number; weight: number; color: string; before: number; after: number };
type TextBlock = { kind: 'text'; lines: string[]; x: number; y: number; style: TextStyle };
type ImageBlock = { kind: 'image'; photo: Photo; x: number; y: number; width: number; height: number };
type RuleBlock = { kind: 'rule'; x: number; y: number; width: number };
type Block = TextBlock | ImageBlock | RuleBlock;

async function loadOriginal(photo: Photo): Promise<HTMLImageElement> {
  if (!photo.originalAvailable || !photo.originalUrl) throw new Error(`参考图“${photo.title || photo.originalName}”原图缺失，请重新定位后导出。`);
  const image = new Image();
  // Tauri's asset protocol grants access for the window origin.
  image.crossOrigin = 'anonymous';
  image.src = photo.originalUrl;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图像尺寸无效');
    return image;
  } catch { image.src = ''; throw new Error(`参考图“${photo.title || photo.originalName}”无法解码，未导出长图。`); }
}
function assertHeight(height: number) {
  if (height > PLAN_PNG_MAX_EDGE || height * WIDTH > PLAN_PNG_MAX_PIXELS) throw new Error('长图超出可导出尺寸（最高 32768 像素），请缩减文字或参考图后导出。');
}
async function measureBlocks(context: CanvasRenderingContext2D, content: PlanExportBlock[], photos: Photo[]) {
  const blocks: Block[] = [];
  const map = new Map(photos.map((photo) => [photo.id, photo]));
  let y = MARGIN;
  let section: { scope: Extract<PlanExportBlock, { kind: 'section-start' }>['scope']; y: number } | undefined;
  let lastGap = 0;
  function linesFor(value: string, style: TextStyle, width: number) {
    context.font = `${style.weight} ${style.size}px ${FONT}`;
    return wrapPlanText(context, value, width);
  }
  function addText(value: string, style: TextStyle, x = CONTENT_X, width = CONTENT_WIDTH) {
    y += style.before;
    const lines = linesFor(value, style, width);
    blocks.push({ kind: 'text', lines, x, y, style });
    y += lines.length * style.lineHeight + style.after;
    lastGap = style.after;
  }
  for (const block of content) {
    if (block.kind === 'section-start') {
      if (section) throw new Error('策划长图章节结构无效。');
      if (block.scope === 'scene') {
        y += SCENE_GAP;
        blocks.push({ kind: 'rule', x: CONTENT_X, y, width: CONTENT_WIDTH });
        y += SCENE_RULE_HEIGHT + SCENE_RULE_GAP;
      } else if (block.scope !== 'overview') {
        y += block.scope === 'execution' ? EXECUTION_GAP : GROUP_GAP;
      }
      section = { scope: block.scope, y }; lastGap = 0;
    } else if (block.kind === 'section-end') {
      if (!section) throw new Error('策划长图章节结构无效。');
      y -= lastGap;
      section = undefined; lastGap = 0;
    } else if (block.kind === 'text') {
      addText(block.value, textStyles[block.role]);
    } else if (block.kind === 'scene-heading') {
      const titleStyle = textStyles.part;
      const timeStyle = textStyles.meta;
      const titleLines = linesFor(block.title, titleStyle, CONTENT_WIDTH);
      blocks.push({ kind: 'text', lines: titleLines, x: CONTENT_X, y, style: titleStyle });
      let height = titleLines.length * titleStyle.lineHeight;
      if (block.time.trim()) {
        const timeLines = linesFor(block.time, timeStyle, CONTENT_WIDTH);
        const timeWidth = context.measureText(block.time).width;
        context.font = `${titleStyle.weight} ${titleStyle.size}px ${FONT}`;
        const titleWidth = context.measureText(block.title).width;
        const gap = 24;
        const sameLine = titleLines.length === 1 && timeLines.length === 1 && titleWidth + gap + timeWidth <= CONTENT_WIDTH;
        // Align the smaller time to the title's baseline; wrapped times start below the entire title.
        const offset = sameLine ? titleStyle.size - timeStyle.size : height + 8;
        blocks.push({ kind: 'text', lines: timeLines, x: sameLine ? CONTENT_X + titleWidth + gap : CONTENT_X, y: y + offset, style: timeStyle });
        height = Math.max(height, offset + timeLines.length * timeStyle.lineHeight);
      }
      y += height + titleStyle.after;
      lastGap = titleStyle.after;
    } else if (block.kind === 'section') {
      const style = textStyles.section;
      // The opening heading of preparation/execution already has its group spacing.
      if (section && y === section.y) addText(block.value, { ...style, before: 0 });
      else addText(block.value, style);
    } else if (block.kind === 'field') {
      const labels = linesFor(block.label, textStyles.meta, FIELD_LABEL_WIDTH);
      const values = linesFor(block.value, textStyles.body, CONTENT_WIDTH - FIELD_LABEL_WIDTH - FIELD_GAP);
      blocks.push({ kind: 'text', lines: labels, x: CONTENT_X, y, style: textStyles.meta });
      blocks.push({ kind: 'text', lines: values, x: CONTENT_X + FIELD_LABEL_WIDTH + FIELD_GAP, y, style: textStyles.body });
      y += Math.max(labels.length * textStyles.meta.lineHeight, values.length * textStyles.body.lineHeight) + 12;
      lastGap = 12;
    } else {
      const gap = 24;
      const columnWidth = (CONTENT_WIDTH - gap * (block.columns - 1)) / block.columns;
      const maxImageHeight = block.columns === 1 ? 680 : 520;
      const entries = [];
      for (const reference of block.references) {
        const photo = map.get(reference.photoId);
        if (!photo) throw new Error('策划中的参考图记录缺失，请移除缺失引用后导出。');
        // Decode and release sequentially; dimensions come from each actual original.
        const image = await loadOriginal(photo);
        try {
          const scale = Math.min(columnWidth / image.naturalWidth, maxImageHeight / image.naturalHeight);
          entries.push({ photo, width: image.naturalWidth * scale, height: image.naturalHeight * scale, lines: reference.intent.trim() ? linesFor(reference.intent, textStyles.intent, columnWidth) : [] });
        } finally { image.src = ''; }
      }
      const imageHeight = Math.max(...entries.map((entry) => entry.height));
      let captionHeight = 0;
      entries.forEach((entry, index) => {
        const x = CONTENT_X + index * (columnWidth + gap);
        blocks.push({ kind: 'image', photo: entry.photo, x: x + (columnWidth - entry.width) / 2, y: y + (imageHeight - entry.height) / 2, width: entry.width, height: entry.height });
        if (entry.lines.length) {
          blocks.push({ kind: 'text', lines: entry.lines, x, y: y + imageHeight + 14, style: textStyles.intent });
          captionHeight = Math.max(captionHeight, entry.lines.length * textStyles.intent.lineHeight + 14);
        }
      });
      y += imageHeight + captionHeight + 20;
      lastGap = 20;
    }
    assertHeight(y + MARGIN);
  }
  if (section) throw new Error('策划长图章节结构无效。');
  return { blocks, height: Math.max(480, Math.ceil(y + MARGIN)) };
}

/** Independent of application styles and DOM screenshots. Never retains all decoded originals. */
export async function renderPlanPng(plan: ShootPlanInput, photos: Photo[]): Promise<Uint8Array> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  try {
    if (!context) throw new Error('当前环境无法创建长图画布。');
    const { blocks, height } = await measureBlocks(context, planExportBlocks(plan), photos);
    assertHeight(height);
    canvas.width = WIDTH; canvas.height = height;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, WIDTH, height);
    context.textBaseline = 'top';
    for (const block of blocks) {
      if (block.kind === 'rule') {
        context.fillStyle = '#e4e6e8'; context.fillRect(block.x, block.y, block.width, SCENE_RULE_HEIGHT);
      } else if (block.kind === 'text') {
        context.font = `${block.style.weight} ${block.style.size}px ${FONT}`;
        context.fillStyle = block.style.color;
        block.lines.forEach((line, index) => context.fillText(line, block.x, block.y + index * block.style.lineHeight));
      } else {
        const image = await loadOriginal(block.photo);
        try { context.drawImage(image, block.x, block.y, block.width, block.height); }
        finally { image.src = ''; }
      }
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('长图编码失败，请缩减内容后重试。')), 'image/png'));
    if (blob.size > PLAN_PNG_MAX_BYTES) throw new Error('长图超过 64MiB，请减少参考图或内容后导出。');
    return new Uint8Array(await blob.arrayBuffer());
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'SecurityError') throw new Error('原图读取权限不足，无法生成完整长图。');
    throw cause;
  } finally { canvas.width = 0; canvas.height = 0; }
}

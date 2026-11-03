import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapPlanText } from '../src/features/planning/plan-text.ts';

const context = { measureText: (value) => ({ width: Array.from(value).reduce((sum, character) => sum + (character === 'X' ? 3 : /[\u4e00-\u9fff]/u.test(character) ? 2 : 1), 0) }) };
test('a word carried after a space is remeasured when its final wide glyph overflows', () => {
  const lines = wrapPlanText(context, 'a 12345678X', 10);
  assert.deepEqual(lines, ['a', '12345678', 'X']);
  assert.ok(lines.every((line) => context.measureText(line).width <= 10));
});
test('mixed Chinese, long English words and blank lines retain content within the line width', () => {
  const text = '人像拍摄 PortraitPhotography123456789\n\n自然光和X\r\n结束';
  const lines = wrapPlanText(context, text, 10);
  assert.ok(lines.includes(''));
  assert.equal(lines.join('').replaceAll(' ', ''), text.replace(/\r?\n| /g, ''));
  assert.ok(lines.every((line) => context.measureText(line).width <= 10));
});
test('emoji families and combining accents remain whole graphemes at the wrap boundary', () => {
  const glyphContext = { measureText: (value) => ({ width: [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length }) };
  const lines = wrapPlanText(glyphContext, 'a👨‍👩‍👧‍👦e\u0301b', 2);
  assert.deepEqual(lines, ['a👨‍👩‍👧‍👦', 'e\u0301b']);
});
test('explicit trailing and consecutive line breaks remain present', () => {
  assert.deepEqual(wrapPlanText(context, '第一行\n\n第三行\n', 10), ['第一行', '', '第三行', '']);
});

test('a closing full stop in a portrait prompt carries its preceding Chinese glyph instead of occupying a new line', () => {
  const text = '先看窗外再回头，让肩膀自然放松。';
  // Reproduce a line with room for the complete prompt except its final full stop.
  const width = context.measureText(text.slice(0, -1)).width;
  const lines = wrapPlanText(context, text, width);
  assert.deepEqual(lines, ['先看窗外再回头，让肩膀自然放', '松。']);
  assert.equal(lines.join(''), text);
  assert.ok(lines.every((line) => context.measureText(line).width <= width));
});

test('Chinese closing punctuation and closing quote runs stay behind a full grapheme', () => {
  for (const punctuation of Array.from('。，、；：！？）】》〉〕」』”’')) {
    const text = `甲乙${punctuation}丙`;
    const lines = wrapPlanText(context, text, 4);
    assert.equal(lines.join(''), text);
    assert.ok(lines.every((line) => !line.startsWith(punctuation)), punctuation);
    assert.ok(lines.every((line) => context.measureText(line).width <= 4));
  }
  assert.deepEqual(wrapPlanText(context, '甲乙。”丙', 5), ['甲', '乙。”', '丙']);
  const glyphContext = { measureText: (value) => ({ width: [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length }) };
  assert.deepEqual(wrapPlanText(glyphContext, '甲👨‍👩‍👧‍👦。', 2), ['甲', '👨‍👩‍👧‍👦。']);
  assert.deepEqual(wrapPlanText(glyphContext, '甲e\u0301。', 2), ['甲', 'e\u0301。']);
});

test('unavoidable punctuation at tiny widths and explicit paragraph starts stays complete and never overflows', () => {
  const text = '甲乙。\n）丙';
  const lines = wrapPlanText(context, text, 2);
  assert.deepEqual(lines, ['甲', '乙', '。', '）', '丙']);
  assert.equal(lines.join(''), text.replaceAll('\n', ''));
  assert.ok(lines.every((line) => context.measureText(line).width <= 2));
  assert.deepEqual(wrapPlanText(context, '甲乙。”', 3), ['甲', '乙。', '”']);
});

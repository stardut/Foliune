import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePlanExecutionDate, inputOf, newPart, newShot, hasContent, referenceCount, shotCount, planSearchText, moved, sceneReferenceLimitError } from '../src/features/planning/plan-content.ts';
import { planExportBlocks } from '../src/features/planning/plan-export-content.ts';

function exportedText(blocks) { return blocks.flatMap((block) => block.kind === 'scene-heading' ? [block.title, block.time] : block.kind === 'field' ? [`${block.label}\n${block.value}`] : ['text', 'section'].includes(block.kind) ? [block.value] : []); }

function fixture() {
  const value = inputOf();
  const first = newPart();
  Object.assign(first, { title: '窗边', description: '共同拍法\n只写一次', shotList: '旧清单：先坐姿，再走动', scene: '咖啡馆', styling: '白衬衫', lighting: '柔侧光', mood: '放空', timeWindow: '15:00' });
  const shot = newShot();
  Object.assign(shot, { title: '回头', description: '先看窗外\n再回头', pose: '松肩', composition: '半身', lighting: '轮廓光', mood: '松弛', priority: 'must', references: [{ id: 'main', photoId: 'same-photo', intent: '只看姿态' }, { id: 'extra', photoId: 'supplement', intent: '只看光线' }] });
  first.references = [{ id: 'part-ref', photoId: 'styling', intent: '只看衣服' }];
  first.shots = [shot];
  const second = newPart();
  const other = newShot();
  other.references = [{ id: 'other-main', photoId: 'same-photo', intent: '这次只看表情' }];
  second.shots = [other];
  Object.assign(value, { title: '雨后', concept: '一组肖像', shootDate: '周日', location: '街角', team: '两人', deliverables: '八张', visualDirection: '低饱和', preparation: '带伞\n确认许可', references: [{ id: 'global', photoId: 'global-photo', intent: '整体气质' }], parts: [first, second] });
  return value;
}

test('PNG reading contract exports scene images once and retains active scene and shot text', () => {
  const plan = fixture();
  plan.parts[0].focalLength = '35mm';
  const original = structuredClone(plan);
  const blocks = planExportBlocks(plan);
  const images = blocks.flatMap((block) => block.kind === 'reference-row' ? block.references : []);
  assert.deepEqual(images.map((ref) => ref.id), ['part-ref']);
  const text = exportedText(blocks).join('\n');
  for (const expected of ['雨后', '一组肖像', '周日', '街角', '两人', '八张', '低饱和', '咖啡馆', '白衬衫', '柔侧光', '35mm', '放空', '15:00', '回头', '松肩', '半身', '轮廓光', '松弛', '必拍', '先看窗外\n再回头', '带伞\n确认许可']) assert.ok(text.includes(expected), expected);
  assert.equal(text.match(/共同拍法\n只写一次/g).length, 1);
  for (const intent of ['整体气质', '只看姿态', '只看光线', '这次只看表情']) assert.ok(text.includes(intent), intent);
  assert.ok(!text.includes('镜头参考'));
  assert.ok(!text.includes(plan.parts[0].shotList));
  assert.equal(blocks.filter((block) => block.kind === 'section' && block.value === '镜头清单').length, 2);
  assert.match(text, /场景 02/); assert.match(text, /镜头 01/);
  assert.equal(blocks.at(-2).value, plan.preparation);
  assert.deepEqual(plan, original, '导出不改动任何历史引用和内容');
});

test('empty optional sections are omitted while named-less drafts retain their sequence', () => {
  const value = inputOf(); value.title = '草稿'; const part = newPart(); part.shots = [newShot()]; value.parts = [part];
  const blocks = planExportBlocks(value);
  assert.equal(blocks.filter((block) => block.kind === 'reference-row').length, 0);
  assert.equal(blocks.filter((block) => block.kind === 'section').length, 3);
  assert.ok(blocks.some((block) => block.kind === 'scene-heading' && block.title.includes('场景 01')));
  assert.ok(blocks.some((block) => block.kind === 'text' && block.value.includes('镜头 01')));
});

test('search and limits count nested references per use, including separate intents on the same photo', () => {
  const plan = fixture();
  assert.equal(referenceCount(plan), 5); assert.equal(shotCount(plan), 2);
  const text = planSearchText(plan);
  for (const expected of ['这次只看表情', '共同拍法\n只写一次', '咖啡馆', '白衬衫', '柔侧光', '放空', '先看窗外\n再回头', '松肩', '半身', '轮廓光', '松弛']) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes(plan.parts[0].shotList));
});

test('draft copying is independent, reordering retains stable identities, and deletion distinguishes empty content', () => {
  const original = fixture(); const draft = inputOf({ ...original, id: 'plan', createdAt: '', updatedAt: '' });
  draft.parts[0].shots[0].references[0].intent = '改了';
  assert.equal(original.parts[0].shots[0].references[0].intent, '只看姿态');
  const sorted = moved(original.parts, 0, 1);
  assert.equal(sorted[1], original.parts[0]); assert.equal(original.parts[0].title, '窗边');
  assert.equal(hasContent(newPart()), false); assert.equal(hasContent(newShot()), false);
  const shot = newShot(); shot.priority = 'must'; assert.equal(hasContent(shot), true);
  const part = newPart(); part.shots = [newShot()]; assert.equal(hasContent(part), true);
  const ids = [part.id, shot.id, ...part.shots.map((item) => item.id)]; assert.equal(new Set(ids).size, ids.length);
});


test('scene reference limit names offenders, permits empty drafts, and keeps all historical references', () => {
  const plan = fixture();
  plan.parts[0].references = Array.from({ length: 4 }, (_, index) => ({ id: `historical-${index}`, photoId: `photo-${index}`, intent: `意图${index}` }));
  assert.match(sceneReferenceLimitError(plan), /窗边/);
  assert.equal(inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' }).parts[0].references.length, 4);
  const rows = planExportBlocks(plan).filter((block) => block.kind === 'reference-row' && block.scope === 'scene');
  assert.deepEqual(rows.map((block) => block.references.length), [2, 2]);
  assert.deepEqual(rows.flatMap((block) => block.references.map((ref) => ref.id)), plan.parts[0].references.map((ref) => ref.id));
  plan.parts[0].references.pop(); assert.equal(sceneReferenceLimitError(plan), null);
  plan.parts[0].references = []; assert.equal(sceneReferenceLimitError(plan), null);
});

test('historical free text stays in independent copies and deletion protection but is absent from search and export', () => {
  const plan = inputOf(); const part = newPart(); part.shotList = '先拍远景，再拍肩线'; plan.parts = [part];
  assert.equal(hasContent(part), true); assert.ok(!planSearchText(plan).includes('先拍远景'));
  assert.equal(shotCount(plan), 0); assert.equal(referenceCount(plan), 0);
  const blocks = planExportBlocks(plan);
  assert.ok(!exportedText(blocks).join('\n').includes(part.shotList));
  assert.ok(blocks.some((block) => block.kind === 'text' && block.value === '暂无镜头'));
  const copied = inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' });
  assert.equal(copied.parts[0].shotList, part.shotList);
  copied.parts[0].shotList = '修改';
  assert.equal(plan.parts[0].shotList, '先拍远景，再拍肩线');
  delete plan.parts[0].shotList;
  assert.equal(inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' }).parts[0].shotList, '');
});

test('scene focal length is copied, searchable, exported, and defaults to empty for old scenes', () => {
  const plan = inputOf();
  const scene = newPart();
  assert.equal(scene.focalLength, '');
  scene.focalLength = '35mm 环境／85mm 半身';
  plan.parts = [scene];
  assert.equal(hasContent(scene), true);
  assert.ok(planSearchText(plan).includes(scene.focalLength));
  assert.ok(planExportBlocks(plan).some((block) => block.kind === 'field' && block.label === '镜头焦段' && block.value === scene.focalLength));
  const copied = inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' });
  copied.parts[0].focalLength = '50mm';
  assert.equal(scene.focalLength, '35mm 环境／85mm 半身');
  delete scene.focalLength;
  assert.equal(inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' }).parts[0].focalLength, '');
  assert.equal('focalLength' in newShot(), false);
});

test('scene export orders title, notes, scene references, parameters, then structured shots', () => {
  const plan = fixture();
  plan.parts[0].focalLength = '35mm';
  plan.parts[0].references.push({ id: 'scene-same', photoId: 'same-photo', intent: '场景只看环境' });
  const blocks = planExportBlocks(plan);
  const sceneStart = blocks.findIndex((block) => block.kind === 'scene-heading');
  const notesIndex = blocks.findIndex((block) => block.kind === 'text' && block.value.includes('共同拍法'));
  const rowIndex = blocks.findIndex((block) => block.kind === 'reference-row');
  const listIndex = blocks.findIndex((block) => block.kind === 'section' && block.value === '镜头清单');
  const shotIndex = blocks.findIndex((block) => block.kind === 'text' && block.role === 'shot');
  const parameters = ['光影', '镜头焦段', '场地', '场景补充', '情绪'].map((label) => blocks.findIndex((block) => block.kind === 'field' && block.label === label));
  const order = [sceneStart, notesIndex, rowIndex, ...parameters, listIndex, shotIndex];
  assert.ok(order.every((index, position) => index >= 0 && (!position || order[position - 1] < index)));
  assert.equal(blocks[rowIndex].references[1].intent, '场景只看环境');
  assert.deepEqual(blocks.filter((block) => block.kind === 'reference-row').flatMap((block) => block.references.map((ref) => ref.id)), ['part-ref', 'scene-same']);
});

test('scene shoot time preserves existing values, remains independent of overview date and omits empty exports', () => {
  const plan = fixture();
  const original = structuredClone(plan);
  const copied = inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' });
  assert.equal(copied.shootDate, '周日');
  assert.equal(copied.parts[0].timeWindow, '15:00');
  copied.parts[0].timeWindow = '16:30–17:15，日落前';
  assert.equal(copied.shootDate, '周日');
  assert.equal(plan.parts[0].timeWindow, '15:00');
  assert.ok(planSearchText(copied).includes(copied.parts[0].timeWindow));
  const blocks = planExportBlocks(copied);
  assert.deepEqual(blocks.filter((block) => block.kind === 'field' && ['拍摄时间', '拍摄时段'].includes(block.label)), [
    { kind: 'field', label: '拍摄时间', value: '周日' },
  ]);
  assert.deepEqual(blocks.find((block) => block.kind === 'scene-heading'), { kind: 'scene-heading', title: '场景 01 · 窗边', time: '16:30–17:15，日落前' });
  assert.equal(exportedText(blocks).filter((text) => text === copied.parts[0].timeWindow).length, 1);
  assert.ok(!blocks.some((block) => block.kind === 'field' && ['时间窗口', '拍摄时段'].includes(block.label)));
  copied.parts[0].timeWindow = '   ';
  assert.equal(planExportBlocks(copied).find((block) => block.kind === 'scene-heading').time.trim(), '');
  const emptyScene = newPart();
  assert.equal(emptyScene.timeWindow, '');
  emptyScene.timeWindow = '日落前';
  assert.equal(hasContent(emptyScene), true);
  assert.deepEqual(plan, original);
});

test('execution date is independent of free-text shoot time and searchable without changing PNG content', () => {
  const oldPlan = { ...fixture(), id: 'saved', createdAt: '', updatedAt: '' };
  delete oldPlan.executionDate;
  assert.equal(inputOf().executionDate, '');
  assert.equal(inputOf(oldPlan).executionDate, '');

  const saved = { ...oldPlan, executionDate: '2028-02-29' };
  const draft = inputOf(saved);
  assert.equal(draft.executionDate, saved.executionDate);
  assert.equal(draft.shootDate, '周日');
  assert.ok(planSearchText(draft).includes(saved.executionDate));
  assert.deepEqual(planExportBlocks(draft), planExportBlocks(inputOf(oldPlan)));
});

test('execution date sorts newest dates first, then uses actual update time, and keeps undated plans last', () => {
  const plans = [
    { id: 'legacy', executionDate: '', updatedAt: '2030-01-01T00:00:00Z' },
    { id: 'earlier date', executionDate: '2026-11-01', updatedAt: '2026-11-10T00:00:00Z' },
    { id: 'earlier update', executionDate: '2026-12-01', updatedAt: '2026-11-06T10:30:00+08:00' },
    { id: 'later update', executionDate: '2026-12-01', updatedAt: '2026-11-06T04:30:00Z' },
  ];
  assert.deepEqual([...plans].sort(comparePlanExecutionDate).map((plan) => plan.id), [
    'later update', 'earlier update', 'earlier date', 'legacy',
  ]);
});

test('historical shot and global references preserve ordered nonempty notes without images', () => {
  const plan = fixture();
  plan.visualDirection = '';
  plan.parts[0].shots[0].references = Array.from({ length: 4 }, (_, index) => ({ id: `shot-${index}`, photoId: `p-${index}`, intent: `镜头独立意图${index}` }));
  plan.parts[0].shots[0].references.splice(1, 0, { id: 'empty-intent', photoId: 'unused', intent: '   ' });
  const original = structuredClone(plan);
  const blocks = planExportBlocks(plan);
  assert.ok(!blocks.some((block) => block.kind === 'reference-row' && block.scope !== 'scene'));
  assert.ok(!blocks.some((block) => block.kind === 'text' && block.value === '镜头参考'));
  const notes = blocks.filter((block) => block.kind === 'field' && block.label === '参考要点');
  assert.equal(notes[0].value, '整体气质');
  assert.equal(notes[1].value, '镜头独立意图0\n镜头独立意图1\n镜头独立意图2\n镜头独立意图3');
  assert.deepEqual(plan, original);
  plan.references[0].intent = ' ';
  plan.parts[0].shots.forEach((shot) => shot.references.forEach((ref) => { ref.intent = ''; }));
  plan.parts[1].shots.forEach((shot) => shot.references.forEach((ref) => { ref.intent = ''; }));
  const emptyNotes = planExportBlocks(plan);
  assert.ok(!emptyNotes.some((block) => (block.kind === 'section' && block.value === '整体视觉') || (block.kind === 'field' && block.label === '参考要点')));
  assert.deepEqual(original.parts[0].shots[0].references.map((ref) => ref.id), ['shot-0', 'empty-intent', 'shot-1', 'shot-2', 'shot-3']);
  assert.equal(sceneReferenceLimitError(plan), null);
});

test('shared preparation is copied, searchable and exported once before all scenes', () => {
  const plan = fixture();
  Object.assign(plan, { styling: '自然妆与低马尾', props: '旧书与透明伞', equipment: '35mm／85mm／反光板' });
  const copied = inputOf({ ...plan, id: 'saved', createdAt: '', updatedAt: '' });
  for (const key of ['styling', 'props', 'equipment']) {
    assert.equal(copied[key], plan[key]);
    assert.ok(planSearchText(plan).includes(plan[key]));
  }
  copied.styling = '修改';
  assert.equal(plan.styling, '自然妆与低马尾');
  const original = structuredClone(plan);
  const blocks = planExportBlocks(plan);
  const find = (value) => blocks.findIndex((block) => block.kind === 'field' ? `${block.label}\n${block.value}` === value : ['text', 'section'].includes(block.kind) && block.value === value);
  const order = ['整体视觉', '整组准备', '妆造\n自然妆与低马尾', '道具\n旧书与透明伞', '器材\n35mm／85mm／反光板'].map(find);
  const firstScene = blocks.findIndex((block) => block.kind === 'scene-heading');
  assert.ok([...order, firstScene].every((index, position, entries) => index >= 0 && (!position || entries[position - 1] < index)));
  const legacyStyling = find('场景补充\n白衬衫');
  const secondScene = blocks.findIndex((block) => block.kind === 'scene-heading' && block.title.includes('场景 02'));
  assert.ok(firstScene < legacyStyling && legacyStyling < secondScene);
  assert.ok(!blocks.some((block) => block.kind === 'text' && block.value.includes('造型与道具')));
  assert.equal(blocks.filter((block) => block.kind === 'section' && block.value === '整组准备').length, 1);
  for (const key of ['styling', 'props', 'equipment']) assert.equal(blocks.filter((block) => block.kind === 'field' && block.value === plan[key]).length, 1);
  assert.deepEqual(plan, original);
});

test('old plans default shared preparation to empty without promoting scene content', () => {
  const plan = fixture();
  for (const key of ['styling', 'props', 'equipment']) {
    assert.equal(inputOf()[key], '');
    delete plan[key];
  }
  const copied = inputOf({ ...plan, id: 'old', createdAt: '', updatedAt: '' });
  for (const key of ['styling', 'props', 'equipment']) assert.equal(copied[key], '');
  assert.equal(copied.parts[0].styling, '白衬衫');
  assert.ok(!planExportBlocks(copied).some((block) => block.kind === 'section' && block.value === '整组准备'));
  copied.props = '伞';
  const values = exportedText(planExportBlocks(copied));
  assert.ok(values.includes('整组准备'));
  assert.ok(values.includes('道具\n伞'));
  assert.ok(!values.includes('妆造') && !values.includes('器材'));
});

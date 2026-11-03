import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPlanPng } from '../src/features/planning/plan-export.ts';
import { planExportBlocks } from '../src/features/planning/plan-export-content.ts';
import { inputOf, newPart, newShot } from '../src/features/planning/plan-content.ts';

function setup({ dimensions = {}, decodeFailsAt = 0, bytes = 3, drawFails = false, encodeFails = false } = {}) {
  const calls = []; const draws = []; const texts = []; const loads = []; const rules = []; const pages = []; const operations = [];
  let active = 0; let peak = 0; let decoded = 0;
  const context = {
    font: '',
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] ?? 40);
      return { width: Array.from(text).reduce((sum, character) => sum + size * (/\p{Script=Han}/u.test(character) ? 1 : 0.56), 0) };
    },
    fillRect(x, y, width, height) {
      const rect = { x, y, width, height, color: this.fillStyle };
      if (x === 0 && y === 0) { pages.push(rect); operations.push('page'); }
      else { rules.push(rect); operations.push('rule'); }
    },
    roundRect() { assert.fail('连续纸张不应绘制圆角卡片'); },
    stroke() { assert.fail('连续纸张不应描边'); },
    fillText(text, x, y) { calls.push(text); operations.push('text'); texts.push({ text, x, y, font: this.font, width: this.measureText(text).width }); },
    drawImage(image, x, y, width, height) { if (drawFails) throw new Error('draw failed'); calls.push(`image:${image.src}`); operations.push('image'); draws.push({ src: image.src, x, y, width, height }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (done) => done(encodeFails ? null : { size: bytes, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) };
  class ImageMock {
    naturalWidth = 100; naturalHeight = 50; value = '';
    set src(value) {
      if (!this.value && value) { active++; loads.push(value); peak = Math.max(peak, active); [this.naturalWidth, this.naturalHeight] = dimensions[value] ?? [100, 50]; }
      if (this.value && !value) active--;
      this.value = value;
    }
    get src() { return this.value; }
    async decode() { assert.equal(this.crossOrigin, 'anonymous'); if (++decoded === decodeFailsAt) throw new Error('decode failed'); }
  }
  const oldDocument = globalThis.document; const oldImage = globalThis.Image;
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: () => canvas };
  globalThis.Image = ImageMock;
  return { calls, draws, texts, loads, rules, pages, operations, canvas, peak: () => peak, active: () => active, restore() { globalThis.document = oldDocument; globalThis.Image = oldImage; } };
}
function fixture() {
  const plan = inputOf(); plan.title = '拍摄'; const part = newPart(); part.title = '窗边';
  Object.assign(part, { description: '柔和的窗边肖像', scene: '靠窗座位', lighting: '柔侧光', focalLength: '50mm', shotList: '先静坐，再回头' });
  const shot = newShot();
  Object.assign(shot, { title: '回头', description: '动作提示\n第二段动作', pose: '放松肩膀', composition: '半身', lighting: '侧逆光', mood: '安静', priority: 'must', references: [{ id: 'old-shot', photoId: 'hidden-shot', intent: '历史镜头意图' }] });
  part.references = [{ id: 'first', photoId: 'a', intent: '参考姿态' }, { id: 'second', photoId: 'b', intent: '补充光线' }];
  part.shots = [shot]; plan.parts = [part]; plan.preparation = '带道具';
  plan.references = [{ id: 'global', photoId: 'hidden-global', intent: '历史总体意图' }];
  const photos = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, originalName: `${id}.jpg`, originalUrl: id, originalAvailable: true }));
  return { plan, photos };
}
function sceneOf(env, item) {
  const execution = env.texts.findLast((entry) => entry.text === '执行准备');
  return env.rules.findIndex((rule, index) => item.y >= rule.y + rule.height + 32
    && item.y < (env.rules[index + 1]?.y ?? execution?.y ?? env.pages[0].height));
}
function assertFullText(env, value) {
  const normalize = (text) => text.replace(/\s/g, '');
  assert.ok(normalize(env.calls.join('')).includes(normalize(value)), `全文保留：${value.slice(0, 36)}`);
}
function assertGeometry(env) {
  assert.equal(env.pages.length, 1, '全长只有一个连续白纸背景');
  const page = env.pages[0];
  assert.equal(page.color, '#ffffff'); assert.equal(page.width, 1080);
  const items = [...env.texts, ...env.draws].map((item) => ({ ...item, height: 'font' in item ? Number(item.font.match(/(\d+)px/)[1]) : item.height }));
  for (const item of items) {
    assert.ok(item.x >= 64 - 0.001, '统一左页边距');
    assert.ok(item.x + item.width <= 1016 + 0.001, `统一右页边距：${item.text ?? item.src}`);
    assert.ok(item.y >= 64, '统一上页边距');
    assert.ok(item.y + item.height <= page.height - 64 + 0.001, `下页边距：${item.text ?? item.src}`);
  }
  for (const [index, rule] of env.rules.entries()) {
    assert.deepEqual({ x: rule.x, width: rule.width, height: rule.height, color: rule.color }, { x: 64, width: 952, height: 2, color: '#e4e6e8' });
    const heading = env.texts.find((item) => item.y >= rule.y + rule.height && item.font.startsWith('500 48px'));
    assert.equal(heading.y - (rule.y + rule.height), 32, '场景从细线后32px开始');
    assert.equal(sceneOf(env, heading), index, '每个章节的标题位于其自身范围');
    for (const item of items) assert.ok(item.y + item.height <= rule.y || item.y >= rule.y + rule.height, '章节线不穿过文字或照片');
    const previousBottom = Math.max(...items.filter((item) => item.y < rule.y).map((item) => item.y + item.height));
    assert.ok(rule.y - previousBottom >= 56, '场景前留白大于内部段落间距');
  }
  for (const [index, item] of items.entries()) for (const other of items.slice(index + 1)) {
    assert.ok(item.x + item.width <= other.x + 0.001 || other.x + other.width <= item.x + 0.001
      || item.y + item.height <= other.y + 0.001 || other.y + other.height <= item.y + 0.001, `内容不重叠：${item.text ?? item.src} / ${other.text ?? other.src}`);
  }
  assert.equal(env.operations[0], 'page');
}
function assertReleased(env) {
  assert.equal(env.peak(), 1); assert.equal(env.active(), 0);
  assert.equal(env.canvas.width, 0); assert.equal(env.canvas.height, 0);
}

test('PNG draws continuous white paper and scene chapters, preserves active text, and loads only scene originals sequentially', async () => {
  const env = setup();
  try {
    const { plan, photos } = fixture(); const original = structuredClone(plan);
    assert.deepEqual(await renderPlanPng(plan, photos), new Uint8Array([1, 2, 3]));
    const position = (text) => env.calls.findIndex((value) => value.includes(text));
    const order = ['窗边', '柔和的窗边肖像', '参考图', 'image:a', '参考姿态', '拍摄参数', '光影', '柔侧光', '镜头焦段', '50mm', '场地', '靠窗座位', '镜头清单', '01 · 回头', '动作提示', '第二段动作', '放松肩膀', '半身', '侧逆光', '安静', '历史镜头意图', '带道具'].map(position);
    assert.ok(order.every((index, offset) => index >= 0 && (!offset || order[offset - 1] < index)));
    assert.ok(env.calls.some((text) => text.includes('必拍')));
    assert.ok(env.calls.includes('历史总体意图'));
    assert.ok(!env.calls.includes(plan.parts[0].shotList));
    assert.deepEqual(env.draws.map((draw) => draw.src), ['a', 'b']);
    assert.deepEqual(env.loads, ['a', 'b', 'a', 'b']);
    assert.equal(env.rules.length, 1, '仅场景绘制章节线，概览与执行准备不加线');
    assert.equal(sceneOf(env, env.texts.find((item) => item.text === '带道具')), -1, '执行准备在最后场景范围之外');
    assert.deepEqual(plan, original);
    assertGeometry(env); assertReleased(env);
  } finally { env.restore(); }
});

for (const [name, title, time, sameLine] of [
  ['short adjacent heading', '草地 · 侧逆光', '15:30–16:10', true],
  ['long title', '沿着草地边缘追随侧逆光的完整场景名称'.repeat(4), '15:30–16:10', false],
  ['long time', '窗边', '日落前侧逆光与草地环境安排'.repeat(7), false],
  ['both long', '保留完整无空格英文标题LongSceneName'.repeat(5), '沿着街边寻找散射光并等待背景行人离开'.repeat(5), false],
  ['explicit newline', '窗边', '15:30–16:10\n日落前等待侧逆光', false],
]) test(`scene heading ${name} keeps the complete title/time once, readable and without overlap`, async () => {
  const env = setup();
  try {
    const { plan, photos } = fixture();
    Object.assign(plan.parts[0], { title, timeWindow: time });
    plan.shootDate = '周日整组拍摄';
    const original = structuredClone(plan);
    await renderPlanPng(plan, photos);
    const notes = env.texts.find((entry) => entry.text === plan.parts[0].description);
    const heading = env.texts.filter((entry) => sceneOf(env, entry) === sceneOf(env, notes) && entry.y < notes.y);
    const titles = heading.filter((entry) => entry.font.startsWith('500 48px'));
    const times = heading.filter((entry) => entry.font.startsWith('400 36px'));
    const normalize = (value) => value.replace(/\s/g, '');
    assert.equal(normalize(titles.map((entry) => entry.text).join('')), normalize(`场景 01 · ${title}`));
    assert.equal(normalize(times.map((entry) => entry.text).join('')), normalize(time));
    assert.ok(!env.calls.includes('拍摄时段'));
    assert.equal(env.calls.filter((value) => value === '周日整组拍摄').length, 1);
    assert.equal(planExportBlocks(plan).filter((block) => block.kind === 'scene-heading').length, 1);
    if (sameLine) {
      assert.equal(titles.length, 1); assert.equal(times.length, 1);
      assert.equal(times[0].x - (titles[0].x + titles[0].width), 24, '时段紧邻标题，不推向纸张最右');
      assert.equal(times[0].y - titles[0].y, 12, '大小字号基线一致');
    } else {
      assert.equal(times[0].x, titles[0].x);
      assert.equal(times[0].y - titles.at(-1).y, 76, '时段整体移到完整标题之后');
    }
    for (const [index, current] of heading.entries()) for (const other of heading.slice(index + 1)) {
      const height = Number(current.font.match(/(\d+)px/)[1]);
      const otherHeight = Number(other.font.match(/(\d+)px/)[1]);
      assert.ok(current.x + current.width <= other.x || other.x + other.width <= current.x || current.y + height <= other.y || other.y + otherHeight <= current.y, '标题与时段各行不重叠');
    }
    assert.ok(notes.y >= times.at(-1).y + 54 + 18, '后续内容留在完整时段下方');
    assert.deepEqual(plan, original); assertGeometry(env); assertReleased(env);
  } finally { env.restore(); }
});

test('empty scene time draws no heading placeholder and time-only scenes keep their time out of parameters', async () => {
  for (const time of ['', '   ', '15:30–16:10']) {
    const env = setup();
    try {
      const plan = inputOf(); plan.title = '草稿'; const part = newPart();
      part.title = '窗边'; part.timeWindow = time; plan.parts = [part];
      await renderPlanPng(plan, []);
      assert.equal(env.calls.filter((value) => value === '15:30–16:10').length, time.trim() ? 1 : 0);
      assert.ok(!env.calls.includes('拍摄时段'));
      assert.ok(env.calls.includes('暂无拍摄参数'));
      const heading = env.texts.filter((entry) => sceneOf(env, entry) === 0 && entry.y < env.texts.find((item) => item.text === '参考图').y);
      assert.equal(heading.length, time.trim() ? 2 : 1);
      assertGeometry(env); assert.equal(env.active(), 0);
    } finally { env.restore(); }
  }
});

test('shared preparation appears once before scenes, with one vertical label/value row per filled item', async () => {
  const env = setup();
  try {
    const { plan, photos } = fixture();
    Object.assign(plan, { visualDirection: '统一柔和色调', styling: '自然妆与白衬衫', props: '旧书和透明伞', equipment: '双机身与反光板' });
    plan.parts[0].styling = '第二场换围巾';
    await renderPlanPng(plan, photos);
    const at = (value) => env.texts.find((entry) => entry.text === value);
    assert.ok(at('整体视觉').y < at('整组准备').y);
    assert.ok(at('器材').y < env.texts.find((entry) => entry.text.includes('窗边')).y);
    const fields = ['妆造', '道具', '器材'].map(at);
    assert.equal(new Set(fields.map((entry) => entry.x)).size, 1, '标签为单列');
    assert.ok(fields[0].y < fields[1].y && fields[1].y < fields[2].y);
    for (const [label, value] of [['妆造', plan.styling], ['道具', plan.props], ['器材', plan.equipment]]) {
      assert.equal(at(label).y, at(value).y); assert.ok(at(value).x > at(label).x);
      assert.equal(env.calls.filter((text) => text === value).length, 1);
    }
    assert.equal(env.calls.filter((text) => text === '整组准备').length, 1);
    assert.equal(env.rules.length, plan.parts.length);
    assert.equal(sceneOf(env, at('场景补充')), 0);
    assert.equal(sceneOf(env, at('第二场换围巾')), 0);
    assertGeometry(env); assertReleased(env);
  } finally { env.restore(); }
});

for (const count of [1, 2, 3, 4]) test(`${count} mixed-ratio scene references retain composition, two-column continuation and independent intent`, async () => {
  const dimensions = { a: [1800, 1200], b: [1000, 1600], c: [1200, 1200], d: [2100, 900] };
  const env = setup({ dimensions });
  try {
    const { plan, photos } = fixture();
    plan.parts[0].references = photos.slice(0, count).map((photo, index) => ({ id: `scene-${index}`, photoId: photo.id, intent: `意图${index}：完整保留本图独立的姿态及光影说明。` }));
    const original = structuredClone(plan);
    await renderPlanPng(plan, photos);
    assert.equal(env.draws.length, count);
    assert.deepEqual(env.draws.map((draw) => draw.src), photos.slice(0, count).map((photo) => photo.id));
    for (const [index, draw] of env.draws.entries()) {
      assert.ok(Math.abs(draw.width / draw.height - dimensions[draw.src][0] / dimensions[draw.src][1]) < 1e-10);
      const caption = env.texts.find((entry) => entry.text.startsWith(`意图${index}`));
      const columnX = 64 + (count > 1 ? index % 2 * 488 : 0);
      assert.equal(caption.x, columnX); assert.ok(caption.y >= draw.y + draw.height);
      assert.ok(caption.font.includes('36px'));
      assert.ok(draw.width <= (count === 1 ? 952 : 464));
      assertFullText(env, plan.parts[0].references[index].intent);
      if (index === 2) { assert.equal(caption.x, 64); assert.ok(draw.y > env.draws[0].y + env.draws[0].height); }
    }
    if (count >= 2) assert.equal(env.texts.find((entry) => entry.text.startsWith('意图0')).y, env.texts.find((entry) => entry.text.startsWith('意图1')).y, '同排图注基线一致');
    assert.deepEqual(plan, original); assertGeometry(env); assertReleased(env);
  } finally { env.restore(); }
});

test('single landscape, portrait and square references fit the full-width stage without cropping', async () => {
  for (const dimensions of [[1800, 1200], [1000, 1600], [1200, 1200]]) {
    const env = setup({ dimensions: { a: dimensions } });
    try {
      const { plan, photos } = fixture(); plan.parts[0].references = [plan.parts[0].references[0]];
      await renderPlanPng(plan, photos);
      const [image] = env.draws;
      assert.ok(Math.abs(image.width / image.height - dimensions[0] / dimensions[1]) < 1e-10);
      assert.ok(image.width <= 952 && image.height <= 680);
      assert.equal(image.x + image.width / 2, 540, '单图在完整可用宽度内居中');
      assertGeometry(env); assertReleased(env);
    } finally { env.restore(); }
  }
});

test('zero-image drafts keep all three sections and a single scene chapter without loading hidden references', async () => {
  const env = setup();
  try {
    const { plan } = fixture(); plan.parts[0] = newPart();
    await renderPlanPng(plan, []);
    for (const value of ['参考图', '拍摄参数', '镜头清单', '暂无参考图', '暂无拍摄参数', '暂无镜头']) assert.ok(env.calls.includes(value));
    assert.equal(env.draws.length, 0); assert.equal(env.loads.length, 0);
    assert.equal(env.rules.length, 1); assertGeometry(env);
  } finally { env.restore(); }
});

test('long multiline content and multiple shots stay inside their own scene without loss or grouping by written labels', async () => {
  const env = setup();
  try {
    const { plan, photos } = fixture();
    const first = plan.parts[0];
    first.description = '镜头清单\n整组准备\n拍摄参数\n这些是用户正文，不是新的章节。';
    first.lighting = '光影的完整长行'.repeat(15) + '\n第二段光影完整保留';
    first.shotList = '自由清单完整首段\n\n' + '保留长文'.repeat(50) + '\n自由清单完整末段';
    first.shots[0].description = '镜头拍法完整首段\n\n' + '保留长文'.repeat(50) + '\n镜头拍法完整末段';
    for (let index = 0; index < 4; index++) {
      const shot = newShot(); Object.assign(shot, { title: `后续镜头${index}`, description: `完整拍法${index}`, references: [{ id: `old-${index}`, photoId: 'not-loaded', intent: `旧参考全文${index}\n旧意图末行${index}` }] }); first.shots.push(shot);
    }
    const second = newPart(); second.title = '独立的第二场'; second.description = '第二场专属正文'; second.shotList = '第二场专属清单'; plan.parts.push(second);
    const original = structuredClone(plan);
    await renderPlanPng(plan, photos);
    assert.equal(env.rules.length, plan.parts.length);
    const firstOwner = sceneOf(env, env.texts.find((item) => item.text.includes('窗边')));
    const secondOwner = sceneOf(env, env.texts.find((item) => item.text.includes('独立的第二场')));
    for (const item of env.texts.filter((item) => /后续镜头|完整拍法|旧参考全文|旧意图末行|镜头拍法完整/.test(item.text))) assert.equal(sceneOf(env, item), firstOwner);
    assert.equal(sceneOf(env, env.texts.find((item) => item.text === '第二场专属正文')), secondOwner);
    for (let index = 0; index < 4; index++) for (const prefix of ['完整拍法', '旧参考全文', '旧意图末行']) assert.ok(env.calls.includes(`${prefix}${index}`));
    const body = env.texts.find((item) => item.text === '第二段光影完整保留'); assert.ok(body.font.includes('40px'));
    assert.ok(!env.calls.some((value) => /自由清单完整|第二场专属清单/.test(value)));
    assert.equal(sceneOf(env, env.texts.find((item) => item.text === '暂无镜头')), secondOwner);
    for (const value of [first.description, first.lighting, first.shots[0].description]) assertFullText(env, value);
    assert.deepEqual(plan, original); assertGeometry(env); assertReleased(env);
  } finally { env.restore(); }
});

test('content model has balanced explicit sections, fixed scene sections and half-width historical continuation', () => {
  const { plan } = fixture();
  plan.parts[0].references = Array.from({ length: 3 }, (_, index) => ({ id: String(index), photoId: 'a', intent: '整组准备' }));
  const blocks = planExportBlocks(plan);
  assert.deepEqual(blocks.filter((block) => block.kind === 'section-start').map((block) => block.scope), ['overview', 'scene', 'execution']);
  assert.equal(blocks.filter((block) => block.kind === 'section-end').length, 3);
  const start = blocks.findIndex((block) => block.kind === 'section-start' && block.scope === 'scene');
  const end = blocks.findIndex((block, index) => index > start && block.kind === 'section-end');
  assert.deepEqual(blocks.slice(start, end).filter((block) => block.kind === 'section').map((block) => block.value), ['参考图', '拍摄参数', '镜头清单']);
  assert.deepEqual(blocks.filter((block) => block.kind === 'reference-row').map((block) => [block.columns, block.references.length]), [[2, 2], [2, 1]]);
  let scope;
  for (const block of blocks) {
    if (block.kind === 'section-start') { assert.equal(scope, undefined, '章节不嵌套'); scope = block.scope; }
    else if (block.kind === 'section-end') { assert.ok(scope, '章节有对应开头'); scope = undefined; }
    else {
      assert.ok(scope, '全部内容有明确章节归属');
      if (block.kind === 'reference-row' || block.kind === 'scene-heading') assert.equal(scope, 'scene');
    }
  }
  assert.equal(scope, undefined, '最后章节正常闭合');
});

test('overview-only drafts and preparation without scenes keep a compact paper opening without decorative rules', async () => {
  for (const styling of ['', '素净妆造']) {
    const env = setup();
    try {
      const plan = inputOf(); plan.title = '待完善的拍摄'; plan.styling = styling;
      await renderPlanPng(plan, []);
      assert.equal(env.rules.length, 0);
      assert.equal(env.texts[0].x, 64); assert.equal(env.texts[0].y, 64);
      assert.equal(env.calls.filter((text) => text === '整组准备').length, styling ? 1 : 0);
      if (styling) {
        const preparation = env.texts.find((item) => item.text === '整组准备');
        assert.equal(preparation.y - (env.texts[0].y + 84), 36, '开篇与整组准备仅以紧凑留白衔接');
        assertFullText(env, styling);
      }
      assertGeometry(env); assert.equal(env.loads.length, 0); assert.equal(env.canvas.width, 0); assert.equal(env.canvas.height, 0);
    } finally { env.restore(); }
  }
});

test('missing records, unavailable originals and both measurement/drawing decode failures reject and release resources', async () => {
  const { plan, photos } = fixture();
  for (const scenario of [
    { options: {}, input: photos.slice(1), error: /参考图记录缺失/ },
    { options: {}, input: photos.map((photo) => ({ ...photo, originalAvailable: false })), error: /原图缺失/ },
    { options: { decodeFailsAt: 2 }, input: photos, error: /无法解码/ },
    { options: { decodeFailsAt: 4 }, input: photos, error: /无法解码/ },
    { options: { drawFails: true }, input: photos, error: /draw failed/ },
    { options: { encodeFails: true }, input: photos, error: /编码失败/ },
  ]) {
    const env = setup(scenario.options);
    try {
      await assert.rejects(renderPlanPng(plan, scenario.input), scenario.error);
      assert.equal(env.active(), 0); assert.equal(env.canvas.width, 0); assert.equal(env.canvas.height, 0);
      if (scenario.options.decodeFailsAt === 2 || scenario.input.length < photos.length) assert.equal(env.calls.length, 0, '测量未完成不绘制任何部分');
    } finally { env.restore(); }
  }
});

test('height and encoded bytes limits reject rather than dropping content', async () => {
  const { plan, photos } = fixture(); plan.parts[0].shots[0].description = '完整长段落\n'.repeat(700);
  let env = setup();
  try { await assert.rejects(renderPlanPng(plan, photos), /32768/); assert.equal(env.active(), 0); assert.equal(env.calls.length, 0); assert.equal(env.canvas.width, 0); }
  finally { env.restore(); }
  plan.parts[0].shots[0].description = ''; env = setup({ bytes: 64 * 1024 * 1024 + 1 });
  try { await assert.rejects(renderPlanPng(plan, photos), /64MiB/); assertReleased(env); }
  finally { env.restore(); }
});

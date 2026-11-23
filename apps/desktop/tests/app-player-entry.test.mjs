import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const source = readFileSync(resolve('apps/desktop/src/App.tsx'), 'utf8');
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'openPlayer') declaration = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(declaration, 'App 应提供欣赏入口');
const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function entry(photos) {
  const opened = [];
  const errors = [];
  const play = new Function('snapshot', 'feedback', 'flushSync', 'setPlayingIds', 't', `${compiled}; return openPlayer;`)(
    { photos }, (...args) => errors.push(args), (run) => run(), (ids) => opened.push(ids), (chinese) => chinese,
  );
  return { play, opened, errors };
}

test('App 播放入口保留有效照片的输入顺序及重复项，只拒绝不存在的 ID', () => {
  const { play, opened, errors } = entry([{ id: 'a' }, { id: 'b' }]);
  play(['b', 'missing', 'a', 'b']);
  assert.deepEqual(opened, [['b', 'a', 'b']]);
  assert.deepEqual(errors, []);
  play(['missing']);
  assert.deepEqual(opened, [['b', 'a', 'b']]);
  assert.deepEqual(errors, [['没有可欣赏的照片', true]]);
});

test('万张照片的播放入口只扫描一次图库建立有效 ID 索引', () => {
  let reads = 0;
  const count = 10000;
  const photos = Array.from({ length: count }, (_, index) => ({ get id() { reads += 1; return `photo-${index}`; } }));
  const ids = Array.from({ length: count }, (_, index) => `photo-${count - 1 - index}`);
  const { play, opened } = entry(photos);
  play(ids);
  assert.deepEqual(opened, [ids]);
  assert.equal(reads, count, '校验成本随图库线性增长，不对每个播放 ID 重新扫描图库');
});

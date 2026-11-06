import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/review-presentation.ts', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
});
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { ReviewPresentation } = module.exports;

test('重开本地原片时重新读源文件，移出显示缺失，放回后可读', async (t) => {
  const decoded = new Set();
  let sourcePresent = true;
  globalThis.Image = class {
    naturalWidth = 1600;
    async decode() {
      if (decoded.has(this.src)) return;
      if (!sourcePresent) throw new Error('Source file missing');
      decoded.add(this.src);
    }
  };
  t.after(() => { delete globalThis.Image; });
  const photo = {
    id: 'photo',
    originalPath: 'local-photo:/photos/source.jpg',
    originalUrl: 'work-photo://localhost/photo',
    thumbnailUrl: 'asset://localhost/thumb.jpg',
    originalAvailable: true,
    thumbnailAvailable: true,
  };
  async function reopen() {
    const review = new ReviewPresentation(photo, () => {});
    review.update([photo], photo.id, 0, true);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return review.state.incoming ?? review.state.current;
    } finally {
      review.dispose();
    }
  }

  assert.equal((await reopen()).kind, 'image');
  sourcePresent = false;
  assert.equal((await reopen()).kind, 'error');
  sourcePresent = true;
  assert.equal((await reopen()).kind, 'image');
});

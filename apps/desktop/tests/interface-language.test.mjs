import assert from 'node:assert/strict';
import test from 'node:test';

const testStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('language follows the system until overridden, and switching returns to Settings once', async (context) => {
  let language = 'ja-JP';
  context.mock.getter(Object.getPrototypeOf(globalThis.navigator), 'language', () => language);
  const localStorage = testStorage();
  const sessionStorage = testStorage();
  const reload = context.mock.fn();
  globalThis.window = { localStorage, sessionStorage, location: { reload } };
  context.after(() => { delete globalThis.window; });

  const initial = await import('../src/lib/i18n.ts?initial');
  assert.equal(initial.readLanguagePreference(), 'system');
  assert.equal(initial.getLocale(), 'en');
  for (const code of ['zh-CN', 'zh-Hans-CN', 'zh-Hans-SG', 'zh']) {
    assert.equal(initial.resolveSystemLocale(code), 'zh-CN', code);
  }
  for (const code of ['en-GB', 'ja-JP', 'zh-Hant', 'zh-TW', 'zh-HK', 'fr-FR', '']) {
    assert.equal(initial.resolveSystemLocale(code), 'en', code);
  }

  initial.saveLanguagePreference('zh-CN');
  assert.equal(reload.mock.callCount(), 1);
  const chinese = await import('../src/lib/i18n.ts?chinese');
  assert.equal(chinese.getLocale(), 'zh-CN');
  assert.equal(chinese.t('设置', 'Settings'), '设置');
  assert.equal(chinese.resumeLanguageSettings(), true);
  assert.equal(chinese.resumeLanguageSettings(), false);

  language = 'zh-CN';
  chinese.saveLanguagePreference('system');
  assert.equal(reload.mock.callCount(), 1);
  assert.equal(chinese.readLanguagePreference(), 'system');
  language = 'fr-FR';
  const english = await import('../src/lib/i18n.ts?system');
  assert.equal(english.t('设置', 'Settings'), 'Settings');
  assert.equal(english.photoCount(1), '1 photo');
  assert.equal(english.photoCount(2), '2 photos');
});

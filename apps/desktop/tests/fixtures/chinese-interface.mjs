// These UI tests assert the exact Simplified Chinese labels regardless of the host locale.
Object.defineProperty(globalThis.navigator, 'language', { configurable: true, value: 'zh-CN' });

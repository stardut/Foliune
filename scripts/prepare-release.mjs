import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseVersion(tag) {
  if (typeof tag !== 'string' || tag.trim() !== tag || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error(`发布 tag 必须为 MAJOR.MINOR.PATCH，可带 v 前缀：${tag ?? '<missing>'}`);
  }
  return tag.replace(/^v/, '');
}

function replaceTomlVersion(source, header, version, label) {
  const blocks = source.match(/^(?:\[\[?[^\n]+\]\]?)[\s\S]*?(?=^\[|$(?![\s\S]))/gm) ?? [];
  const matches = blocks.filter(header);
  if (matches.length !== 1) throw new Error(`${label} 必须包含唯一的应用 package 节`);
  const block = matches[0];
  const versions = [...block.matchAll(/^version[ \t]*=[ \t]*"[^"]+"[ \t]*$/gm)];
  if (versions.length !== 1) throw new Error(`${label} 缺少唯一的 package version`);
  return source.replace(block, block.replace(/^version[ \t]*=[ \t]*"[^"]+"[ \t]*$/m, `version = "${version}"`));
}

// 只在 CI checkout 或测试副本内执行；先检查全部输入，再写入版本。
export function prepareRelease(root, tag) {
  const version = releaseVersion(tag);
  const jsonPaths = ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json'];
  const updates = jsonPaths.map((path) => {
    const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (typeof value.version !== 'string') throw new Error(`${path} 缺少 version`);
    value.version = version;
    return [path, `${JSON.stringify(value, null, 2)}\n`];
  });
  const cargoToml = 'apps/desktop/src-tauri/Cargo.toml';
  const cargoLock = 'apps/desktop/src-tauri/Cargo.lock';
  updates.push([cargoToml, replaceTomlVersion(
    readFileSync(resolve(root, cargoToml), 'utf8'),
    (block) => block.startsWith('[package]\n') && /^name\s*=\s*"foliune"\s*$/m.test(block),
    version, cargoToml,
  )]);
  updates.push([cargoLock, replaceTomlVersion(
    readFileSync(resolve(root, cargoLock), 'utf8'),
    (block) => block.startsWith('[[package]]\n') && /^name\s*=\s*"foliune"\s*$/m.test(block),
    version, cargoLock,
  )]);
  for (const [path, content] of updates) writeFileSync(resolve(root, path), content);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const version = prepareRelease(process.cwd(), process.env.TAG_NAME);
  console.log(`已同步 Foliune 发布版本 ${version}（pnpm-lock.yaml 保持不变）。`);
}

# 构建验证记录

日期：2026-10-29。平台：macOS 15.0.1、Apple silicon（aarch64）。本记录区分真实执行结果与尚未验证内容，不代表 Windows 或发布发行已经完成。

## 工具链与锁定版本

本机使用 Node.js 24.3.0、pnpm 10.19.0、Rust/Cargo 1.95.0 及 macOS Command Line Tools。当前桌面路线没有使用归档的 SwiftUI 工程，也不依赖其完整 Xcode 构建。

依赖由根目录 `pnpm-lock.yaml` 和 `apps/desktop/src-tauri/Cargo.lock` 锁定。实际参与本轮验证的主要版本如下：

| 范围 | 版本 |
| --- | --- |
| Rust Tauri / JavaScript API | 2.11.5 / 2.11.1 |
| Rust / JavaScript dialog 插件 | 2.7.3 / 2.7.3 |
| Tauri CLI | 2.12.4 |
| React / React DOM | 19.3.1 |
| TypeScript / Vite | 5.9.3 / 7.3.7 |
| Tailwind CSS / Motion | 4.3.3 / 12.43.0 |
| SQLite 封装 rusqlite / image | 0.37.0 / 0.25.2 |
| AI 直接依赖 reqwest / keyring | 0.12.28 / 3.6.3 |
| 备份 zip | 2.6.1 |

Tauri CLI 曾拒绝 JavaScript API 2.12 与 Rust 2.11、JavaScript dialog 2.8 与 Rust dialog 2.7 的组合。现已将两侧分别约束在 2.11、2.7 的同一 minor，更新锁文件并重新构建；没有跳过版本检查。CLI 自身 2.12.4 已在上述组合上实际构建成功。

## 本机实际执行结果

以下命令均在仓库根目录执行。该机器在线 Cargo 传输存在超时，本轮 Rust 命令使用仅供诊断的 `.task/cargo-home` 隔离官方缓存。这里用 `$PWD` 表示本机实际的同一个目录，不要求其他开发机采用该缓存路径。

```sh
pnpm typecheck
pnpm build
CARGO_HOME="$PWD/.task/cargo-home" cargo check --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
CARGO_HOME="$PWD/.task/cargo-home" cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
CARGO_HOME="$PWD/.task/cargo-home" CARGO_NET_OFFLINE=true pnpm --filter @foliune/desktop tauri build --debug --no-bundle
CARGO_HOME="$PWD/.task/cargo-home" CARGO_NET_OFFLINE=true pnpm --filter @foliune/desktop tauri build --debug --bundles app
```

| 验证 | 实际结果与证据 |
| --- | --- |
| TypeScript | `pnpm typecheck` 退出码 0；后续完整构建中的 `tsc --noEmit` 也通过。 |
| 前端生产资源 | `pnpm build` 通过；最终 `.app` 构建再次执行并完成 Vite 生产资源构建。存在静态/动态混合导入的分块提示，不影响构建成功。 |
| Rust check | 通过，最终该轮 2.69 秒；日志 `.task/cargo-check.log`。 |
| Rust 全量测试 | **28 通过、0 失败、0 忽略**；最终 3.94 秒，包含最新 EXIF 八方向宽高和原件字节断言；日志 `.task/cargo-test.log`。 |
| 原生 debug no-bundle | 通过，Rust 构建 44.88 秒；日志 `.task/tauri-build.log`。 |
| macOS debug `.app` | 通过，生成一个 44.63 MiB 的 `.app`；日志 `.task/tauri-app-build.log`。 |

真实图形验收随后发现图库和选择栏依赖 Motion 从初始透明状态启动，在本机 WebView 中未进入可见态。UI 已将这两处关键内容改为默认可见（`initial={false}`）。确认 Avenil 验收应用为 stopped 后，使用同一 `.app` 构建命令定点重打包成功，产物路径和大小不变；该轮日志为 `.task/tauri-app-visibility-fix-build.log`，前端资源 `index-U-KLBo38.js`，Rust 构建 10.04 秒。后端没有变化，本次未重复全量 Rust 测试；修复后的图形复验另行记录。

后续图形验收确认选择清空后 Motion 退出调度仍可能留下工具栏，UI 已将零选择状态直接卸载，同时给 AI 面板增加照片内容修订 key，拒绝重定位前的迟到结果回填。确认 Avenil stopped 后再次定点重打包通过，日志 `.task/tauri-app-final-ui-build.log`，前端资源 `index-BOmKMoEA.js`；Rust 构建 25.07 秒，产物仍为同路径的 44.63 MiB `.app`。这轮没有后端生产代码变化，未重复全量 Rust 测试。

在上述全量 28 项通过后，另外新增并独立执行 G07 SQL 故障注入测试。对应复现命令：

```sh
CARGO_HOME="$PWD/.task/cargo-home" cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml curation_tests::curation_sql_failure_rolls_back_records_members_capacity_and_files -- --exact
```

该目标 **1 通过、0 失败、28 项被过滤**，日志 `.task/curation-g07-test.log`。它通过 SQLite `BEFORE INSERT memberships` 的 `RAISE(ABORT)` 验证新照片/管理副本、旧成员废弃、分组名称与上限在写入失败时整体回滚；这是新增单项验证，不是一次已执行的全量 29 项结果。

28 项测试实际覆盖：真实图片导入及重开后的元数据、损坏照片拒绝、原件保留、透明 PNG 缩略图、EXIF 八方向、跨组废弃、批量恢复原子性、缺失文件重新定位；30+3 候选取舍、取消无提交、容量修改/恢复、陈旧草稿和伪造选择、区域标注；跨图库画册、手工版本保留和历史切换、追加另存版本、服务端布局校验、自包含 HTML 原图/转义/缺失阻断；备份恢复、篡改/路径穿越拒绝、库切换及 Windows 风格路径数据在 macOS 恢复；AI 请求结构及结果解析。Windows 风格路径的单元测试不等于 Windows 系统运行测试。

## 构建产物

仓库内相对路径：

- 独立 debug 可执行文件：`apps/desktop/src-tauri/target/debug/foliune`。
- 本机可打开的应用：`apps/desktop/src-tauri/target/debug/bundle/macos/Foliune.app`。
- 应用内可执行文件：`apps/desktop/src-tauri/target/debug/bundle/macos/Foliune.app/Contents/MacOS/foliune`。

本轮实际绝对路径为 `/Users/junran/workspace/mycode/Foliune/apps/desktop/src-tauri/target/debug/bundle/macos/Foliune.app`。已核对其 `CFBundleExecutable` 为 `foliune`，文件为可执行的 Mach-O arm64。此路径是构建结果记录，未写入正式 package、Tauri 或 Cargo 配置。

应用和本地服务的运行由 Avenil 管理。本记录的命令仅构建和测试，未直接启动应用；图形操作与业务人工验收应单独记录。

## Cargo 网络问题与解决过程

1. 原在线解析出现 SSL connection timeout、低速超时及稀疏索引请求长时间等待。22 秒有界探针和 HTTP trace 保留在 `.task/`。
2. HTTP trace 实际显示 TLS 证书验证成功、`config.json` 返回 HTTP 200；后续索引请求仍存在停滞。没有把所有问题归为无法取得配置文件，也没有关闭 TLS。
3. 仅复制已有 registry 的 index/cache/src 到隔离目录，没有复制 credentials 或全局配置。通过 `cargo --offline` 枚举精确缺失，按需使用 curl 从官方 `index.crates.io` 和 `static.crates.io` 取回未修改的索引 JSON 与 crate；Cargo 继续验证官方校验和。大文件采用有界续传，避免短超时后反复从头下载。
4. 补齐 6 个缺失索引和 25 个当前目标所需 crate 后，离线 fetch 成功，Cargo 生成正常的标准 crates.io `Cargo.lock`。项目没有永久镜像配置，也没有依赖源码补丁。
5. 进入真实编译后修复了默认图标缺失、rusqlite API 不匹配及 image 版本下的方向处理 API；真实测试进一步揭示 macOS `/var` 与 SQLite `/private/var` 的根路径表示不同。现由 Store 初始化统一规范绝对路径，保留严格目录边界校验，随后完整测试通过。

复现脚本为 `.task/fill-offline-cargo.py`，诊断说明及日志也在 `.task/`；该目录是忽略的本机材料。脚本每轮限制时间和缺项数量，仅填充隔离缓存。标准 Cargo HTTP 配置依据见 [Cargo 官方配置文档](https://doc.rust-lang.org/cargo/reference/config.html#http)。

## 正常联网环境的构建方式

在已具备该平台构建工具的正常联网开发机上，直接使用正式锁文件，不需要 `.task` 缓存、上述本机绝对路径或镜像：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @foliune/desktop tauri build --debug --no-bundle
```

macOS 需要本机调试应用时，另执行：

```sh
pnpm --filter @foliune/desktop tauri build --debug --bundles app
```

运行前按工作区约定先查看 `avenil status`，通过 Avenil 管理已构建应用或开发服务。不要把本机缓存路径写为项目常规启动条件。

## 未验证边界

- 未进行 Windows 实机运行、Windows 原生构建或打包。
- 未使用用户真实 Key 调用 DeepSeek、OpenAI、Claude；请求结构和解析单元测试不能替代真实服务验证，也不证明所有模型具备图片能力。
- 未配置开发者签名身份、未进行正式发行签名、公证、DMG 或商店分发。`.app` 为本机 debug 验证产物。
- 构建与测试通过不代表全部图形交互已经人工验收；实际桌面导入、画册阅读、导出打开和音乐等操作另行验证。

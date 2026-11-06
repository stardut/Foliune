# 构建验证记录

本记录区分真实执行结果与尚未验证内容，不代表 Windows 或发布发行已经完成。

## 2026-11-05：本地真实 release DMG 构建与独立校验

本轮在 macOS 15.0.1、arm64、Node.js 24.3.0、pnpm 10.19.0、Rust/Cargo 1.95.0 上实际执行。使用 `git ls-files --cached --others --exclude-standard` 复制当时工作区的 364 个路径到 `.build/verification/local-release-dmg-20261105/source`，包含未提交改动，未使用 worktree。原 HEAD 为 `3e133480d2b51bda98d768a98a1c39044e7ed0c5`，源码路径/SHA256 清单记录在证据目录 `source-manifest.json`。产物基于开始时的固定快照，不等同于 Git tag 提交，也不包含构建期间并行任务后续修改的 AI 等业务代码。

版本准备、依赖安装、测试和编译全部在副本执行。测试 tag 从副本根 `package.json` 得到 `v0.1.0`，仅用环境变量传入，未创建真实 Git tag。正常执行 pnpm 生命周期；复用本机 pnpm store 和 Cargo 环境，未设置 offline、镜像或专用 Cargo home。Cargo target 使用原 target 的 APFS 写时复制副本，副本内已有 bundle 在开始前删除，原 target 不被此次构建写入。它验证本机实际构建链路，不代表全新 GitHub runner 的下载、缓存和工具链环境已通过。

| 阶段 | 实际结果 |
| --- | --- |
| `node scripts/prepare-release.mjs` | 退出码 0，五处版本为 `0.1.0`，pnpm lock 不变。 |
| `node --test scripts/prepare-release.test.mjs` | 4 通过、0 失败。 |
| `pnpm install --frozen-lockfile` | 退出码 0，1.591 秒；103 个本机依赖全部由缓存复用，esbuild postinstall 实际执行成功，没有 `--ignore-scripts`。 |
| `node --test apps/desktop/tests/*.test.mjs` | 此次固定快照为 133 通过、0 失败，2.283 秒；与前次 129 项记录属于不同工作区时点。 |
| `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` | 退出码 0，72 通过、1 忽略、0 失败，命令总耗时 21.302 秒；忽略项仍为 160MP 资源验收。 |
| 首轮 `--bundles dmg` 真实构建 | 退出码 0，124.417 秒，DMG 生成成功；Tauri 随后清理 `.app`，暴露下一步校验所引用的应用已不存在。 |
| 修正为 `--bundles app,dmg` 回归 | 退出码 0，62.023 秒，同时保留 `.app` 与 DMG；前端类型检查及生产构建成功。已有混合导入和大 chunk 提示仍存在。耗时包含本机缓存复用，不作为冷构建性能结论。 |
| 修正后工作流 verify 原样执行（独立验收） | 沿用工作流 `LANG`、`LC_ALL`，完整 shell 通过；arm64、`codesign --verify --deep --strict`、`Signature=adhoc`、单个非空 DMG、`hdiutil verify` 和 SHA256 均通过。 |
| DMG 挂载与复制检查（主代理独立验收） | 使用 readonly/nobrowse 挂载，确认 `Foliune.app` 与 `Applications -> /Applications`；用 `ditto` 复制至证据目录的 `installation-check` 后，架构与签名仍通过，可执行文件 SHA256 与原 `.app` 一致；已卸载 DMG。未启动应用，也未复制到系统 Applications。 |

实际执行修复了两处初轮静态检查未覆盖的问题：仅指定 `--bundles dmg` 会在打包完成后清理 `.app`，因此工作流改为 `--bundles app,dmg`；`lipo -verify_arch arm64 FILE` 在本机返回 1，改为 `lipo FILE -verify_arch arm64` 后通过。两项均只改发布工作流，没有修改业务、签名策略或系统要求。修复前失败证据、回归构建和最终 verify 均保留。快照内仅同步这两项 workflow 修正，`source-manifest-after-release-fix.json` 和 `snapshot-source-changes.json` 记录其 SHA256 变化。

最终 `.app` 为版本 `0.1.0`、标识 `app.foliune.desktop`、arm64、ad-hoc 签名；Info.plist 的最低系统要求仍为 `11.0`，未据此声称已在 macOS 11 实测。DMG 为 **16,364,958 字节（约 15.61 MiB）**，SHA256：

```text
bebf367c12dd240381194752749a483d4113df19a2637dd5d4515ca7b35831b9
```

本机证据根目录为 `/Users/junran/workspace/mycode/Foliune/.build/verification/local-release-dmg-20261105/`（已被 Git 忽略）：

- 便于交付的 DMG：`Foliune_0.1.0_aarch64.dmg`。
- 原构建 `.app`：`source/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Foliune.app`。
- 固定源码及环境：`source-manifest.json`、`source-manifest-after-release-fix.json`、`snapshot-source-changes.json`、`metadata.json`。
- 命令、退出码与耗时：`stage-results.json`；各阶段日志 `01-prepare-version.log` 至 `06-build-dmg.log`。
- 失败与修复回归：`07-dmg-only-app-presence.json`、`08-build-app-dmg-regression.log`、`09-lipo-original-order-failure.log`。
- 独立最终检查：`11-independent-workflow-verify-final.log`、`11-independent-workflow-verify-final.outputs`、`independent-dmg-verification.json`。

本轮没有启动或停止应用、读取用户图库、创建 tag、push、上传 artifact 或发布 Release。未验证 Gatekeeper 首次打开、Developer ID 签名、公证、GitHub 托管完整流水线和最低系统兼容性。界面没有改动，本轮对“高级”与“设计感和质感”无直接视觉影响，未将构建或挂载成功当作图形交互验收。

## 2026-11-05：发布流水线配置与本地验证

参考 Avenil 的 tag → 构建 → artifact → 独立发布流程，新增 `.github/workflows/release.yml`。适配 Foliune 的 pnpm workspace 和 `apps/desktop/src-tauri`，未复制 npm 的 package-lock 处理；未修改现有应用配置、界面、最低系统版本或业务文件。

`pnpm-lock.yaml` 的 184 个 tarball URL 已统一为公共 npm 源 `https://registry.npmjs.org/`。比对修改前的工作区锁文件快照，确认仅更新下载地址，保留此前已有的依赖改动、版本与 integrity，未重新生成锁文件。

流水线约束：

- 推送稳定 `MAJOR.MINOR.PATCH` tag（可带 `v` 前缀），或手动指定已有 tag；手动 checkout 明确使用 `refs/tags/…`，不存在即失败。
- `scripts/prepare-release.mjs` 在依赖安装前校验 tag，临时同步根/桌面 package、Tauri、Cargo manifest/lock 的应用版本。先校验全部文件，再写入；pnpm lock 原样保留。
- 固定 Node.js 24.3.0、沿用仓库 `pnpm@10.19.0`，冻结安装；执行发布脚本测试、`node --test apps/desktop/tests/*.test.mjs` 和 Rust `cargo test --locked`。
- macOS 15 runner 显式使用 `aarch64-apple-darwin`，通过 CLI 配置覆盖 `bundle.macOS.signingIdentity = "-"` 构建 DMG，Cargo build 同样使用 `--locked`。Tauri 原有 `beforeBuildCommand` 仍负责类型检查和前端生产构建。
- 上传前验证 arm64、应用签名和 DMG 完整性。构建仅有 `contents: read`，发布 job 单独取得 `contents: write`，不运行 tag 源码。
- 新 Release 先建草稿，确认附件完整才公开。重跑保留同名 `uploaded` 且非空附件，拒绝未完成同名附件；最终再次查询 Release，确认 tag、公开状态及附件状态。artifact 使用 run ID 命名并允许完整构建重跑覆盖，发布失败可在 7 天保留期内单独重跑发布 job。

本地验证使用当前工作区（包含本轮之前已有的业务改动），结果不等同于尚未创建的 tag 提交：

| 验证 | 实际结果 |
| --- | --- |
| `pnpm test:release` | 4 通过、0 失败；独立临时目录验证五处版本同步、pnpm lock/依赖/系统要求保持、幂等、非法 tag、Cargo 应用条目缺失或重复时失败且不部分写入。没有在工作区运行版本同步。 |
| 工作流结构与 shell | Ruby YAML 解析通过；所有 `run` 步骤经 `bash -n` 语法检查通过。属于静态检查，没有运行 GitHub job。 |
| 公开源冻结安装 | 在独立临时 workspace 与全新 store 执行 `pnpm install --frozen-lockfile --ignore-scripts --store-dir <临时store> --registry=https://registry.npmjs.org/`，11.5 秒完成，103 个本机适用依赖全部下载、0 复用。安装前后锁文件字节相同，未触碰工作区已有 `node_modules`；跳过生命周期脚本，不等同于 GitHub runner 完整安装与构建。 |
| 发布 shell 模拟（独立验收执行） | mock `gh` 的五条分支全通过：新建并上传后公开、保留完整附件、已有草稿完整附件公开、零字节附件失败、`starter` 状态附件失败。后两种失败均未上传或公开。该项验证流程分支，不是 GitHub API 实测。 |
| 现有前端测试（独立验收执行） | `node --test apps/desktop/tests/*.test.mjs`：129 通过、0 失败。 |
| 前端生产构建（独立验收执行） | `pnpm build` 通过；存在已有静态/动态混合导入及大 chunk 提示。 |
| Rust locked 测试（独立验收执行） | `cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：72 通过、1 忽略、0 失败；忽略项为 160MP 资源验收。离线是本机验证条件，CI 正常联网使用 locked 安装。 |

独立审查结论为通过，脚本测试、结构检查、发布 shell SHA256 与五分支 mock 证据保存在忽略的本机文件 `.task/release-independent-review.log`。

本轮未启动应用、未构建真实 release DMG、未调用 GitHub 发布接口，也未创建 tag、push 或发布。未验证 GitHub runner 完整链路、DMG 安装、Gatekeeper 首次打开、Developer ID 签名、公证和最低系统兼容性。ad-hoc 签名仅为当前流水线配置，不视为正式发行签名。本轮是构建工程变更，对“高级”与“设计感和质感”无直接视觉影响，未以构建成功代替图形验收。

以下为 2026-10-29 历史验证，平台：macOS 15.0.1、Apple silicon（aarch64）。

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

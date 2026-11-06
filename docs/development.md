# 开发与构建

[返回产品介绍](../README.md) · [English overview](../README.en.md)

当前开发入口为 `apps/desktop`，使用 Tauri 2、React 19、TypeScript、Vite、Tailwind CSS 4 与 Motion。
原 `apps/macos` SwiftUI 工程保留归档，不作为当前入口；移动端不在当前实现范围内。

本文保留原 README 的构建、发布和数据管理说明。验证结果及其适用范围以[构建验证记录](build-verification.md)、[原生桌面验收](desktop-verification.md)和[开发状态](setup-status.md)为准；历史通过记录不代表当前全部变更已完成验证。

## 本地构建

需要 Node.js（当前验证 v24.3.0）、pnpm 10.19.0、Rust stable，以及平台所需构建工具。
macOS 使用 Command Line Tools；当前桌面路线不依赖原 SwiftUI 工程的完整 Xcode 构建。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm desktop:build
```

`pnpm desktop:build` 编译桌面程序但不制作安装包。需要本机调试 `.app` 时使用：

```sh
pnpm --filter @foliune/desktop tauri build --debug --bundles app
```

产物为 `apps/desktop/src-tauri/target/debug/bundle/macos/Foliune.app`，当前已在 macOS 实际构建成功。这是本机调试产物，未做正式分发签名、公证或 DMG。Tauri CLI 是项目的本地开发依赖，统一通过 pnpm 执行。
本地应用或开发服务必须由 Avenil 管理。先执行 `avenil status`，再注册并启动服务：

```sh
avenil group add --name Foliune
avenil service add --name Foliune桌面 --group Foliune \
  --workdir /Users/junran/workspace/mycode/Foliune \
  --command 'pnpm desktop' --port 1420 --url http://127.0.0.1:1420
avenil start Foliune桌面
avenil logs Foliune桌面 --limit 80
avenil stop Foliune桌面
```

上例工作目录需替换为实际仓库路径。若分组或服务已存在，复用已有配置。
Tauri 的 `beforeDevCommand` 自动运行 Vite，不要再同时启动第二个 Vite。仅检查浏览器页面时，可另注册 `pnpm dev` 服务；切换到桌面服务前先停止它。
浏览器预览不具备本地图库能力，会明确提示使用桌面应用。

## GitHub 发布构建

[发布工作流](../.github/workflows/release.yml) 面向 macOS Apple Silicon，构建 `aarch64-apple-darwin` 的 release DMG。推送稳定版本 tag（`0.1.0` 或 `v0.1.0`）触发；也可在 GitHub Actions 的 **Release macOS app → Run workflow** 中输入已有 tag 重新构建。tag 必须指向已包含本工作流及发布脚本的提交；手动重跑不创建 tag，不使用当前分支替代 tag 源码。

版本以 tag 为准，在 CI checkout 内临时同步根与桌面 `package.json`、Tauri 配置、Cargo manifest 和 Cargo lock 中的应用版本，不提交版本变更。pnpm workspace 锁文件不含应用版本字段，版本同步时保持不变，并使用 `pnpm install --frozen-lockfile` 安装。依赖 tarball 统一从 `https://registry.npmjs.org/` 下载，版本、依赖关系和 integrity 由锁文件固定。非法版本在依赖安装前失败；预发布后缀、构建元数据和前导零不在当前发布范围内。版本准备脚本使用独立临时目录测试：

```sh
pnpm test:release
```

工作流先执行版本脚本测试、现有前端测试与 Rust locked 测试，再通过 Tauri 构建（包含前端类型检查和生产资源构建）。构建阶段只有仓库读取权限，校验 arm64 可执行文件、ad-hoc 签名和 DMG 后上传临时 artifact；独立发布阶段才取得写权限，将附件放入草稿 Release，确认完整后公开。

重新运行时保留已有同名且状态为 `uploaded`、大小大于零的 Release 附件；它不会被新构建覆盖，也不表示与新构建字节一致。遇到未完成或零字节的同名附件会失败，需先人工处理该附件。发布失败可使用 **Re-run failed jobs** 复用同次运行保留的 artifact（保存 7 天）；artifact 过期后重新运行完整工作流。手动重新构建已有 tag 同样受该附件保留规则约束。

当前发布包采用 **ad-hoc 签名，未经 Apple Developer ID 签名或公证**，macOS 可能阻止首次打开。2026-11-05 已在本机独立源码副本完成正常生命周期冻结安装、测试、真实 release `.app` / DMG 构建，并通过架构、签名、DMG 完整性、只读挂载及复制后校验；实际执行修正了仅打 DMG 时 `.app` 被清理和 `lipo` 参数顺序两处问题，详见[构建验证记录](build-verification.md)。工作流保留应用的最低系统版本设置，但未验证该最低系统实际兼容性。GitHub 托管完整运行、Gatekeeper 首次打开、Developer ID 签名、公证及公开 Release 发布仍未实测；没有创建 tag、推送或发布。

## 数据与边界

图库位于 Tauri 的应用数据目录，macOS 默认是 `~/Library/Application Support/app.foliune.desktop/`：

```text
library.sqlite       照片、分组与成员关系
originals/           导入原件的管理副本，UUID 文件名
thumbnails/          960px 以内的 JPEG 缩略图
```

导入只读取来源文件，先复制管理副本并生成缩略图，再写数据库；失败项返回明确错误并清理该次副本。成功导入的 ID 持久保存，重启后不变。
EXIF 可用时提取拍摄时间、GPS 坐标，并依方向生成缩略图；原件字节保持不变。缺失 EXIF 时允许手工补充。

废弃属于照片与当前分组的关系，不删除照片，不影响其他分组。恢复同样检查容量。删除分组仅删除该组关系，保留所有照片原件。
导入、加入分组、恢复和降低上限先生成候选会话。保留集合确认后，服务端重新检查容量、集合与分组并发变化，再在一个事务中保存。取消不会创建正式照片或修改分组。

区域标注保存相对照片坐标及说明；画册引用稳定照片 ID，创建时生成初始排版，创建后逐页编辑和保存。照片重新定位需要显式确认替换，原件与分组引用保留，旧图 AI 分析失效。

API Key、个人照片、图库数据库和签名材料不得提交到仓库。产品规则见 `docs/product.md`，模块边界见 `docs/architecture.md`。

## 可选 AI

在设置中从提供方、模型、API Key及图像输入开关组成的单一表单保存接入，同时只保留一个有效模型。照片分析直接使用该接入。切换提供方会清空尚未保存的Key，需输入该提供方Key后保存；同一提供方留空可保留Key。移除当前接入同时删除其系统Key，替换提供方不删除其他系统凭据。Key 由操作系统凭据库管理，不进入 SQLite、图库备份或日志。没有配置 Key 时，本地图库和画册仍正常使用。

只有点击“分析这张照片”才会发送当前照片的 960px JPEG 缩略图及提示词，按提供方 API 计费。结果独立于人工标注保存，可搜索。文本任务只发送显式输入的文本。
OpenAI 使用 Responses，Claude 使用 Messages，DeepSeek 使用 Chat Completions。DeepSeek Flash 的视觉支持已依据 2026-10-29 官方文档核验；其他自定义模型由用户明确设置能力，不做静默降级。
没有使用真实个人 Key 代替用户调用外部服务进行验收。

## 备份与欣赏

备份 ZIP 包含当前 SQLite 一致性快照、数据库引用的照片原件及缩略图、画册版本和校验清单，不包含 Key、本地音乐缓存或未确认候选。
恢复会检查 ZIP 路径、文件校验和、图片解码、SQLite 完整性和引用关系，建立全新图库；用户再显式切换，旧库保留。切库选择在重启后保持。
照片原件或缩略图缺失时，先完成重新定位，再导出完整备份。

欣赏支持顺序/随机、循环、停留时间、键盘及全屏。本地音乐只用于当前欣赏会话，不上传、不写入图库设置或备份；退出或更换音乐会释放管理缓存。实际支持的音频编码由系统 WebView 决定。

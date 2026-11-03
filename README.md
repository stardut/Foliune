# Foliune

**For photographs worth returning to.**

献给值得反复回看的照片。面向有作品意识的摄影爱好者，用于收藏照片、编排画册与安静欣赏。

## 当前状态

当前开发入口为 `apps/desktop`：Tauri 2 + React 19 + TypeScript + Vite + Tailwind CSS 4 + Motion。
已建立本地图库基础：JPEG / PNG / WebP 真实导入、管理副本和缩略图、SQLite 持久化、照片信息编辑、收藏与作品分组及成员状态。
已实现统一候选取舍、画册选片与章节、自动排版和独立手工版本、单页/双页阅读、独立 HTML 导出、照片欣赏与本地音乐、可选 AI 分析、备份恢复与多图库切换。
相簿多选后可制作自适应、网格或长图拼图，支持排序、非破坏裁切与撤销重做；完成后选择相簿保存为新的PNG照片，满额沿用统一取舍，原件保持不变。macOS真实摄影验收与色彩支持边界见[拼图验收](docs/collage-verification.md)。
已新增模特档案与有序样片管理，以及朋友圈、小红书、Instagram 帖子的临时排版预览（三个平台单行选择、缩略图网格拖拽、预览按窗口适配）；在相簿中选片后点击「模拟排版」，使用固定头像昵称和平台对应文案结构，不保存、不提供草稿。最新范围见 [仅模拟预览](docs/social-preview-only.md)，先前实现与验收记录保留作历史证据。
「策划」工作区按场景组织 1–3 张参考图与镜头清单，前部列出整组妆造、道具与器材，后部每场景为独立卡片；图片只在场景参考区展示，参考图、拍摄参数、文字镜头清单层级清楚且直接可见，不设展开收起，支持手机查看用 PNG 长图导出，长图前置整组准备，采用连续白纸与逐场景章节，图像最多两列并保留完整构图。策划归属当前图库并随备份恢复，旧内容保留，方案与验证范围见[场景卡片与整组准备](docs/planning-scene-cards.md)和[连续纸张长图](docs/planning-paper-export.md)。

RAW、HEIC 尚不支持。没有云端账户、同步或自建服务端。本机已通过类型检查、生产构建、Rust 检查、原全量 28 项测试和新增 G07 故障注入定点测试，以及 macOS debug `.app` 构建；真实桌面主要流程已有验收记录。详细证据见 [构建验证记录](docs/build-verification.md)、[原生桌面验收](docs/desktop-verification.md) 与 [开发状态](docs/setup-status.md)。

当前图标为原创 F 单色占位图标，供开发构建使用，不代表最终品牌设计。

原 `apps/macos` SwiftUI 工程保留归档，不作为当前开发或构建入口。`apps/ios`、`apps/android`、`apps/windows` 仅保留既有说明。当前只在 macOS 验证，未声称 Windows 已可运行或已完成跨平台打包。

产品计划完全免费开源，具体开源许可证待项目所有者确定；仓库暂未授予开源许可。

## 开发与构建

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

区域标注保存相对照片坐标及说明；画册引用稳定照片 ID，重新排版建立新版本，保留手工编辑版本。照片重新定位需要显式确认替换，原件与分组引用保留，旧图 AI 分析失效。

API Key、个人照片、图库数据库和签名材料不得提交到仓库。产品规则见 `docs/product.md`，模块边界见 `docs/architecture.md`。

## 可选 AI

在设置中选择提供方、输入模型标识、确认该模型是否支持图像，并保存自己的 API Key。Key 由操作系统凭据库管理，不进入 SQLite、图库备份或日志。没有配置 Key 时，本地图库和画册仍正常使用。

只有点击“分析这张照片”才会发送当前照片的 960px JPEG 缩略图及提示词，按提供方 API 计费。结果独立于人工标注保存，可搜索。文本任务只发送显式输入的文本。
OpenAI 使用 Responses，Claude 使用 Messages，DeepSeek 使用 Chat Completions。DeepSeek Flash 的视觉支持已依据 2026-10-29 官方文档核验；其他自定义模型由用户明确设置能力，不做静默降级。
没有使用真实个人 Key 代替用户调用外部服务进行验收。

## 备份与欣赏

备份 ZIP 包含当前 SQLite 一致性快照、数据库引用的照片原件及缩略图、画册版本和校验清单，不包含 Key、本地音乐缓存或未确认候选。
恢复会检查 ZIP 路径、文件校验和、图片解码、SQLite 完整性和引用关系，建立全新图库；用户再显式切换，旧库保留。切库选择在重启后保持。
照片原件或缩略图缺失时，先完成重新定位，再导出完整备份。

欣赏支持顺序/随机、循环、停留时间、键盘及全屏。本地音乐只用于当前欣赏会话，不上传、不写入图库设置或备份；退出或更换音乐会释放管理缓存。实际支持的音频编码由系统 WebView 决定。

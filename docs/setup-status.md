# 开发与验证记录

日期：2026-10-29。

## 技术路线

当前入口已从 SwiftUI 初始化工程切换为 `apps/desktop` Tauri 2 + React 19。
旧 `apps/macos` 原样保留归档，不再继续完整 Xcode 下载或 Apple 登录。
原 Swift 模块重复定义问题只属于历史 Swift 验证结果，不能当作当前 Rust/Tauri 构建结论。

## 本机环境

- macOS 15.0.1，Apple silicon。
- Node v24.3.0、npm 11.4.2、pnpm 10.19.0。
- Rust / Cargo 1.95.0，stable-aarch64-apple-darwin。
- Command Line Tools：Apple clang 15.0.0，当前默认 macOS SDK 15.0。
- Cocoa 与 WebKit 头文件的 clang 只读语法检查通过。
- Avenil CLI 可连接；开发服务必须通过 Avenil 托管。

## 当前实现

- 本地 pnpm workspace 和锁文件；Tauri CLI 作为项目依赖。
- SQLite 本地快照、照片信息编辑、分组与独立成员状态。
- JPEG / PNG / WebP 导入、原件管理副本、缩略图与可用 EXIF。
- 原子候选取舍、恢复与降容量；相对坐标区域标注。
- 画册选片、章节、自动/手工版本、重排、阅读和独立 HTML 导出。
- OpenAI / Claude / DeepSeek 可选请求、系统 Key、独立分析结果和搜索。
- ZIP 校验备份、新库恢复、显式切换与重启持久选择。
- 欣赏播放器与当前会话本地音乐缓存释放。
- 导入失败返回逐项原因；废弃与分组删除保留照片。
- 浏览器环境明确提示桌面能力不可用。

## 验证结果

- `pnpm install`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，生成 Vite 生产资源。
- Rust `cargo check --offline --locked`（本机隔离缓存）：实际通过。
- Rust 原全量测试：**28 通过，0 失败，0 忽略**，包含最终 EXIF 八方向位置、宽高与原件字节断言；随后新增 G07 SQL 写入故障注入目标测试单独 **1 通过、28 过滤**，新记录、成员、容量及文件回滚验证通过。
- Tauri debug `--no-bundle`：实际通过。
- macOS debug `.app`：实际通过，产物 `apps/desktop/src-tauri/target/debug/bundle/macos/Foliune.app`。
- 本机 Cargo 在线传输超时通过独立官方缓存完成诊断与构建；没有关闭 TLS 或永久设置镜像。正常联网机器使用正式锁文件即可。实际命令、版本、日志与限制见本地构建验证记录。
- 原生窗口、真实系统文件选择器、asset 原图/缩略图、导入取消/确认、画册与版本、HTML 导出、欣赏与音乐缓存、备份恢复切换、限额与跨组隔离已完成实际操作及独立数据核对；详细覆盖和限制见本地桌面验收记录。
- Windows 构建、安装包签名、公证：未验证。音量交互与听感、独立浏览器离线阅读及完整窗口/减少动画专项也不标为已通过，详见桌面报告。
- 外部 API 真实账户端到端调用与系统 Key 保存/删除：未用用户真实凭据验收。请求格式与解析离线测试已通过，不能替代真实提供方端到端验收。

## 数据规则测试范围

原件字节保留、缩略图尺寸、EXIF 时间/方向、重开数据库持久化、坏图无污染、分组废弃隔离、批量恢复原子性、缺失文件重新定位、无效字段修改回滚、30+3 候选选30、取消不变、并发变更拒绝、候选ID伪造拒绝、regions边界、画册独立版本与导出、AI请求解析、ZIP篡改/越界拒绝、Windows路径恢复、新库切换与旧库保留。
测试使用临时目录生成的照片，不使用个人图库。

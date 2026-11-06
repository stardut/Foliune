# Foliune for Windows

Windows 是当前桌面应用的目标平台，与 macOS 共用 [`apps/desktop`](../desktop) 的 Tauri 2 + React + TypeScript 实现。本目录只保留平台说明，不是独立客户端工程。

开发入口、依赖与通用构建命令见[仓库 README](../../README.md)，宿主和界面职责见[工程边界](../../docs/architecture.md)。当前 Tauri 打包配置以 macOS `.app` 为目标，不能直接视为 Windows 安装包配置。

现有构建和原生操作证据来自本机 macOS。Windows 的构建、安装、WebView、文件选择、凭据库及本地图库流程仍需在 Windows 环境实测；共用代码或 macOS 验证通过不代表这些项目已通过。

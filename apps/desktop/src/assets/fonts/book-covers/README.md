# 书架封面字体

中文使用用户于 2026-11-04 在真实摄影字体对照中选择的 C「霞鹜文楷 Regular」，英文保留 Bodoni Moda。字体随应用离线打包，画册书名保持真实文本；没有按样本删字或转成文字图片。字体只用于书架封面，应用控件、画册纸张和独立 HTML 导出继续使用各自既有字体。

## 中文：霞鹜文楷 Regular（LXGW WenKai）

- 官方来源：[lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai)，固定提交 `da0fdf92a0adc5d83c82ecde06d6665c97a2a45e`。
- 原文件：[fonts/TTF/LXGWWenKai-Regular.ttf](https://github.com/lxgw/LxgwWenKai/blob/da0fdf92a0adc5d83c82ecde06d6665c97a2a45e/fonts/TTF/LXGWWenKai-Regular.ttf)。复用字体对照中已下载的完整官方 TTF，本轮没有重新下载或修改字形。
- 版本 `1.530; October 18, 2026`，实际 `normal / 400` 字重。以真实书写笔形呈现更清楚、有人文感的中文，不合成粗体或斜体。
- 源 TTF SHA-256：`2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b`。
- 完整字库保留 47,336 个 glyph、46,926 个 Unicode 映射，其中 30,580 个为 CJK 映射。完整 WOFF2 为 `lxgw-wenkai-regular.woff2`，8,099,268 字节（约 7.72 MiB），SHA-256 为 `59e177a84866d4601c9f3930a59c6f18a28b356d9a7b8efd96d1e9e53f54eb58`；完整元数据见 `manifest.json`。
- 采用 SIL Open Font License 1.1，含 LXGW 与上游 Klee Project 的版权原文，以及 Reserved Font Names 与作者附加许可；完整原厂文件保存在 `LXGWWenKai-OFL.txt`。WOFF2 仅供应用内 WebView 的字体加载，不另行作为可安装的桌面字体分发。
- 字库覆盖由上游完整字符集决定；未收录的极少数字符仍需系统字体提供，不承诺全部 Unicode 字符都有本字体字形。

## 英文：Bodoni Moda

- 作者：Owen Earl / indestructible type*，版本 2.005。
- 官方来源：[indestructible-type/Bodoni](https://github.com/indestructible-type/Bodoni)，固定提交 `30ce6cdc354ef179a3b72ba0f0e71826e599348c`。
- 原厂变量字体：`fonts/variable/BodoniModa[opsz,wght].ttf` 与 `BodoniModa-Italic[opsz,wght].ttf`。
- `bodoni-moda.woff2`、`bodoni-moda-italic.woff2` 两份已有资产逐字节保留，不重新压缩或改写；normal 和 italic 均为真实独立字体文件，各有 563 个 glyph、428 个 Unicode 映射，保留 `wght` 400–900 与 `opsz` 6–96。
- SIL Open Font License 1.1；完整版权与许可见 `Bodoni-Moda-OFL.txt`。

## 封面接入边界

`src/features/books/book-cover-fonts.css` 注册 `'Foliune Cover CJK'` 与 `'Foliune Cover Latin'`，封面组件显式选择；本目录不设置全局字体。英文局部斜体使用真实 italic 文件，中文保持直立与400字重；`font-synthesis: none` 避免合成字形。

## 转换与完整性

霞鹜文楷原始 TTF 通过 FontTools 4.68.0 / Brotli 1.2.1 转成完整 WOFF2：`TTFont(input, recalcTimestamp=False)`，设置 `flavor='woff2'` 后保存。没有 subset、删字符、裁样本、改轮廓、重命名字体内部记录或生成 glyph。

转换后重新读取 WOFF2，断言全部 `getBestCmap()` 映射与原 TTF 完全相同、`maxp.numGlyphs` 完全相同；Bodoni 两份文件的 SHA-256 与变更前相等。三份正式资产的 SHA-256、源 SHA-256、字节数、覆盖数量与变量轴集中在 `manifest.json`。旧刻宋字体及其专用许可、仅为刻宋保留的思源宋体许可已退出正式目录。

## 随应用分发的许可

`apps/desktop/public/licenses/book-cover-fonts.txt` 包含当前两种字体的作者、来源、固定提交及两份未改动的版权与 OFL 全文。Vite 将 public 原样复制到 `dist/licenses/book-cover-fonts.txt`，与 WebView 资源一起分发，不能仅凭 src 中未引用的说明文件声称许可已随包交付。

本次资产替换没有运行 build 或启动应用；最终 dist 字体和 public 许可的逐字节核对、原生字形加载及封面视觉复验由主代理在统一构建后完成。旧字体构建的 dist 核对结果不能作为本次文件已打包的证据。

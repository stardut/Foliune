# Foliune 官网

`site/` 是独立的静态站点，入口是 `site/index.html`，英文页面是 `site/en.html`，可以在浏览器中直接打开预览。样式、脚本和图片使用相对路径，部署后可在 GitHub Pages 的 `/Foliune/` 子路径下加载。

## 语言与内容维护

固定 URL 对应固定语言：`https://stardut.github.io/Foliune/` 为中文，`https://stardut.github.io/Foliune/en.html` 为英文。不根据浏览器语言或本地存储自动跳转，也不保存语言偏好。导航中的 **English** 或 **中文** 使用直接页面链接，禁用 JavaScript 时仍可切换。

旧链接的显式 `?lang=zh` / `?lang=en` 仍由 `language.js` 处理：进入对应页面并移除 `lang` 参数，保留其他查询参数和 `#download` 等锚点；没有受支持的显式参数时不跳转。新分享链接使用上述两个固定地址。

调整官网文案时同步维护两份 HTML 的正文、页面标题、描述、图片替代文本和下载文案。页面标题说明 Mac 照片整理、画册和拍摄策划用途，首屏标语保持原有表达。两页各自声明 canonical，使用绝对地址的双向 `hreflang`（含自身与指向中文的 `x-default`），并同步维护 Open Graph 与 Twitter 分享标题、描述和截图地址。两页共用截图、样式和发布查询逻辑，安装包直链可用时的按钮文案取自各页面的 `data-download-label`。

## 搜索发现与提交

`site/sitemap.xml` 只列出中文根地址和英文 `en.html` 两个规范 URL，不加入 `index.html` 或带 `lang` 参数的重复地址。部署后先确认两页及 [sitemap.xml](https://stardut.github.io/Foliune/sitemap.xml) 可公开访问，再进行平台提交：

1. 在 [Google Search Console](https://search.google.com/search-console) 中添加 URL 前缀资源 `https://stardut.github.io/Foliune/`，按平台提示完成所有权验证。在 **Sitemaps** 中提交 `https://stardut.github.io/Foliune/sitemap.xml`，再用网址检查工具检查两个规范 URL；需要时请求编入索引。验证文件或 meta 标签须使用平台发放的真实 token，另行接入，不填写占位值。参见 [添加资源](https://support.google.com/webmasters/answer/34592)、[Sitemaps 报告](https://support.google.com/webmasters/answer/7451001) 和[网址检查工具](https://support.google.com/webmasters/answer/9012289)。
2. 在 [Bing Webmaster Tools](https://www.bing.com/webmasters/) 中添加站点并完成所有权验证，在 **Sitemaps** 中提交同一 sitemap，通过 **URL Inspection** 检查两个规范 URL 的抓取和索引状态。参见 [Bing Sitemaps](https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed) 和 [URL Inspection](https://www.bing.com/webmasters/help/url-inspection-55a30305)。

提交提供发现与诊断入口，不保证收录时间或排名。以上为部署后的操作步骤；仓库中的元数据与 sitemap 变更不代表已完成平台验证或提交。

`robots.txt` 必须位于来源站点根路径，即 `https://stardut.github.io/robots.txt`。本项目只部署 `/Foliune/`，在 `site/` 放置 `robots.txt` 会发布到 `/Foliune/robots.txt`，不能作为域名根规则，因此本项目不添加该文件。若以后需要 robots 规则或 sitemap 声明，应在控制 `stardut.github.io` 根站点的仓库中维护，并检查是否影响同域其他项目；当前通过搜索平台直接提交 sitemap。参见 [Google robots.txt 位置要求](https://developers.google.com/search/docs/crawling-indexing/robots/intro)。

## 首次上线

1. 将官网变更合入 `main`，并将 `stardut/Foliune` 仓库设为公开。
2. 在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中，将 **Source** 设为 **GitHub Actions**。
3. 在 **Actions → Deploy Foliune website → Run workflow** 中选择 `main` 并运行。工作流只接受公开仓库的 `main`，只上传 `site/`。
4. 部署成功后，在未登录 GitHub 的浏览器里打开 <https://stardut.github.io/Foliune/>，检查固定中文首页、直接切换英文、两页的图片和导航，以及 macOS 安装包下载；同时检查 canonical、分享元数据和 sitemap 的线上地址。

后续官网更新合入 `main` 后，用同一个工作流手动部署；本轮不修改 workflow，也不自动发布官网。软件安装包继续由现有的 macOS Release 工作流发布，每次发版无需修改或重新部署官网。

下载区在访问时读取 GitHub 最新正式版接口。找到与发布标签对应、已上传且非空的 `Foliune_<版本号>_aarch64.dmg` 后，页面显示该版本号、安装包直链和版本说明。接口请求失败、受限或缺少符合条件的安装包时，主按钮仍会打开 GitHub 最新正式版，可在发布页查看安装包和说明。[接口说明](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) · [GitHub 最新正式版](https://github.com/stardut/Foliune/releases/latest)

网页用的截图由 `docs/screenshots/` 中的原图转换为 WebP，图标来自 `apps/desktop/src-tauri/icons/128x128.png`。摄影来源见[截图说明](screenshots/README.md)。

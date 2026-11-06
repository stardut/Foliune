# Foliune 官网

`site/` 是独立的静态站点，入口是 `site/index.html`，英文页面是 `site/en.html`，可以在浏览器中直接打开预览。样式、脚本和图片使用相对路径，部署后可在 GitHub Pages 的 `/Foliune/` 子路径下加载。

## 语言与内容维护

首次打开首页时，按浏览器的语言偏好顺序选用第一种受支持的语言（中文或英文）。都不匹配时显示英文。导航中的 **English** 或 **中文** 链接会记住手动选择，之后打开首页时优先采用该选择。可直接分享 `en.html` 或 `index.html?lang=zh`，让访客进入指定语言的页面。浏览器禁用 JavaScript 时，两页仍可通过导航链接互相访问。

调整官网文案时同步维护两份 HTML 的正文、页面标题、描述、图片替代文本和下载文案。两页共用截图、样式和发布查询逻辑，安装包直链可用时的按钮文案取自各页面的 `data-download-label`。

## 首次上线

1. 将官网变更合入 `main`，并将 `stardut/Foliune` 仓库设为公开。
2. 在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中，将 **Source** 设为 **GitHub Actions**。
3. 在 **Actions → Deploy Foliune website → Run workflow** 中选择 `main` 并运行。工作流只接受公开仓库的 `main`，只上传 `site/`。
4. 部署成功后，在未登录 GitHub 的浏览器里打开 <https://stardut.github.io/Foliune/>，检查默认语言、手动切换、两页的图片和导航，以及 macOS 安装包下载。

后续官网更新合入 `main` 后，用同一个工作流部署。软件安装包继续由现有的 macOS Release 工作流发布，每次发版无需修改或重新部署官网。

下载区在访问时读取 GitHub 最新正式版接口。找到与发布标签对应、已上传且非空的 `Foliune_<版本号>_aarch64.dmg` 后，页面显示该版本号、安装包直链和版本说明。接口请求失败、受限或缺少符合条件的安装包时，主按钮仍会打开 GitHub 最新正式版，可在发布页查看安装包和说明。[接口说明](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) · [GitHub 最新正式版](https://github.com/stardut/Foliune/releases/latest)

网页用的截图由 `docs/screenshots/` 中的原图转换为 WebP，图标来自 `apps/desktop/src-tauri/icons/128x128.png`。摄影来源见[截图说明](screenshots/README.md)。

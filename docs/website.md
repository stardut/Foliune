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

## 发布与首次启用

[官网工作流](../.github/workflows/pages.yml) 有两个入口：

- **Release 完成后自动发布**：稳定版本 tag 推送触发 [Release macOS app](../.github/workflows/release.yml) 工作流。DMG 构建、校验并上传到公开 Release 成功后，该工作流才调用官网部署；部署使用同一 tag 提交中的 `site/`，不改用 `main` 的网页内容。版本校验复用软件发布脚本；预发布后缀、构建元数据、前导零及其他非法版本不发布。DMG 发布失败时官网不会更新。
- **手动 main**：在 **Actions → Deploy Foliune website → Run workflow** 选择 `main`。只接受公开仓库的 `main` 手动运行，不接受其他分支或手动选择 tag。

启用前需完成以下仓库设置：

1. 将工作流、校验脚本、测试及官网内容合入 `main`；新版本 tag 必须指向包含这些文件的提交。已有旧 tag 不会自动获得新工作流，重复运行其历史工作流也不会获得本轮的保护。
2. 将 `stardut/Foliune` 仓库设为公开，并在 **Settings → Pages → Build and deployment** 将 **Source** 设为 **GitHub Actions**。
3. 在 **Settings → Environments → github-pages → Deployment branches and tags** 中，保留 **Branch `main`**，并允许稳定版本 **Tag `*.*.*`**（两者类型不同）。官网作为可复用工作流在 Release 的 tag 上下文中运行，因此环境必须允许 tag；匹配规则兼容有无 `v` 前缀，真正的稳定版本格式由工作流严格校验。保留已有审批人与其他保护规则，不改成允许所有分支。
4. 设置就绪后，手动运行 `main`，或推送稳定版本 tag 并等待 macOS Release 工作流成功。工作流只上传 `site/`，不会打 tag、改版本文件、修改 GitHub 设置或发布安装包。
5. 部署成功后，在未登录 GitHub 的浏览器里打开 <https://stardut.github.io/Foliune/>，检查固定中文首页、直接切换英文、两页的图片和导航，以及 macOS 安装包下载；同时检查 canonical、分享元数据和 sitemap 的线上地址。

2026-11-07 经授权已配置并回读确认 `github-pages` 环境保留 **Branch `main`**、新增 **Tag `*.*.*`**；Pages 的 Source 为 GitHub Actions，其他环境保护保持不变。既有 tag 需要合入此工作流后再推送新 tag，后续发布才会在 DMG 上传完成后部署官网。

### 防止旧内容覆盖

所有 tag 和手动发布共用 `github-pages` 并发组，`cancel-in-progress: false` 保留正在进行的发布。GitHub 不保证等待队列的顺序，也可能替换等待中的运行，因此不靠队列顺序判断新旧。在环境审批完成、实际部署之前，校验脚本重新读取远端状态：

- tag 必须仍存在、仍指向本次事件的提交，并且没有更高的稳定版本 tag。按数字版本排序（例如 `0.10.0` 高于 `0.9.9`），不按字符串、tag 创建时间或 Release 发布时间排序；非稳定 tag 不参与比较。
- 同一最新版本同时存在有/无 `v` 前缀且指向不同提交时，阻止发布并要求先解决歧义。
- 手动运行必须仍是当前 `main` 提交，并包含最新稳定 tag 的提交。手动运行等待期间 `main` 已更新时，应发起新的 `main` 运行。
- 新提交必须包含 `github-pages` 环境最后一次成功部署的提交，防止旧 tag 重跑覆盖后续手动发布，以及内容回退或分叉。另从全部成功部署历史保留最高稳定版本水位；即使后续手动发布过 `main`、又删除了较新 tag，也不能用较低版本覆盖已成功部署的较高版本。
- 因过时而阻挡时，运行摘要说明原因，不调用部署动作，并将该部署 job 标为失败。GitHub 会把成功的 environment job 记录为成功部署，因此不能用“跳过部署步骤但 job 成功”伪造线上基线。API 权限不足、限流、网络故障、提交历史缺失等无法确认安全的情形会失败，不忽略保护继续发布。

这是有意的单向发布策略，不提供自动回滚。若确需退回旧页面，应在当前 `main` 上提交有意的内容恢复，再正常发布；不要强移历史 tag 或绕开保护。保护覆盖采用本工作流的后续运行，不能阻止旧工作流、另一个并发组或手工外部部署覆盖网站。

工作流将权限分开：打包阶段只有 `contents: read`、`pages: read`；部署阶段增加读取源码与部署历史所需的 `contents: read`、`deployments: read`，以及 GitHub Pages 必需的 `pages: write`、`id-token: write`。校验脚本只读 GitHub API，不申请 `contents: write`，不修改环境规则。

官网部署作为 macOS 安装包 Release 工作流的后续 job，在 Release 成功上传 DMG 后运行。官网部署失败不会撤销已发布的安装包，但会使该 Actions 工作流标记失败；DMG 发布失败时不会部署官网。下载区仍通过 GitHub API 读取最新已公开的正式版及有效安装包。

### 本地验证

```sh
pnpm test:pages
pnpm test:release
```

官网防回退测试已接入 PR/main CI，也在官网打包前执行。测试使用内存 API 响应及独立临时 Git 仓库，覆盖稳定版本、乱序/重跑、tag 移动或删除、main 更新、版本别名冲突、部署历史分页、失败关闭以及真实提交祖先关系；不连接 GitHub，不修改项目 Git 历史，也不部署。它们不能替代 GitHub Actions、环境保护和 Pages 服务的真实运行验证。

下载区在访问时读取 GitHub 最新正式版接口。找到与发布标签对应、已上传且非空的 `Foliune_<版本号>_aarch64.dmg` 后，页面显示该版本号、安装包直链和版本说明。接口请求失败、受限或缺少符合条件的安装包时，主按钮仍会打开 GitHub 最新正式版，可在发布页查看安装包和说明。[接口说明](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) · [GitHub 最新正式版](https://github.com/stardut/Foliune/releases/latest)

网页用的截图由 `docs/screenshots/` 中的原图转换为 WebP，图标来自 `apps/desktop/src-tauri/icons/128x128.png`。摄影来源见[截图说明](screenshots/README.md)。

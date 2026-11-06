# 单篇链接图片导入：平台可行性研究

## Instagram 原生单图与双图验证：2026-11-04

用户授权自行选择 Instagram 测试 case。主代理在 NASA 官方公开主页实际查看帖子标记，选择一个双图轮播与一个单图对照；直接打开帖子 URL 后用页面嵌入 JSON 核对基线，不把主页缩略图或封面当作完整图集。

| 用例 | 直接帖子链接 | 页面数据基线 |
| --- | --- | --- |
| 双图轮播 | [NASA / DfSi56IFwZK](https://www.instagram.com/nasa/p/DfSi56IFwZK/) | media_type=8；carousel_media_count=2；两个 type=1 子媒体，各 original_width/height=1000×1249 |
| 单图对照 | [NASA / DfPwMUfl2zd](https://www.instagram.com/nasa/p/DfPwMUfl2zd/) | media_type=1；original_width/height=1440×1440 |

使用同一 Foliune Cargo.lock 的 Tauri 2.11.5 / wry 0.55.1，在 macOS 15.0.1 构建独立 `app.foliune.instagram-native-probe`。每次新进程、WKWebView incognito 非持久网站存储，保留默认 User-Agent；全程未登录、未导入 Cookie，未覆盖 UA。没有产品图库初始化或产品 IPC，Avenil 管理启动与停止。

提取精确绑定目标 code/shortcode，只接受该对象的 carousel_media 或单图媒体数据；轮播与同 code 对象独立声明的总数核对。正文 DOM 图片仅作观察，不用于补齐图集；头像、评论及推荐帖都不进入下载结果。CDN 候选在本次页面只有 URL、没有候选尺寸，使用平台首项原样 URL，不改查询签名；签名只用于当前内存下载，报告去除 query。实际格式、尺寸与完整性由宿主解码验证，不宣称该候选为全平台最大版本。Rust reqwest 仅下载 HTTPS cdninstagram.com/fbcdn.net 白名单，不带账号 Cookie、禁重定向，逐图大小/时间/解码内存受限。

### 实际执行与结果

| 运行 | 环境与诊断方式 | 结果 |
| --- | --- | --- |
| 双图首轮 | 默认 UA、匿名；诊断定期以被拦截的专用 scheme 导航上报状态 | 60 秒白屏，只有 6 个 JSON script，遍历未触上限但目标匹配 0，正文/图片 0。无登录路径、验证码或明确错误提示，终态 incomplete，未下载 |
| 单图对照 | 同默认环境与首版诊断方式 | 成功提取并新下载 1/1 张，JPEG 1440×1440，342345 字节 |
| 双图复测 | 同 URL、默认 UA、匿名；诊断改为只在终态回传，并增加被动加载/错误记录 | 成功核对目标轮播 2 项及独立声明总数 2，新下载 2/2 张 JPEG，均 1000×1249，分别 541426 / 524289 字节 |

复测双图父媒体 ID 为 `POLARIS_4022430930199578186`，子媒体按 position=0/1 对应 `POLARIS_4022430885026934557`、`POLARIS_4022430884599156544`；与浏览器基线一致。单图为 `POLARIS_4021644945136250077`。三个文件均通过 Rust image 完整解码，主代理及独立验收者另用 Pillow 完整解码、核对尺寸、字节数和 SHA。两张轮播资源及 SHA 不同，保留有序映射；不是同一封面的重复下载。原生截图记录首图和 Next 后 `img_index=2` 的第二图，均与下载内容对照。

不能把首次白屏确定归因为必须登录、UA 或诊断回传。源码证实 on_navigation=false 取消专用 scheme 导航，但未证明它一定中断原页面加载；单图在首版方式也成功。终态回传复测同时增加了被动监听，且网络时序可能不同，因此仅保留诊断导航扰动为待证假设。成功复测无 JS 错误或资源错误事件；ResourceTiming 的跨域字节为 0 不能独立作为资源失败证据。此次不再添加 Safari UA 覆盖或更多帖子重试。

### 证据与结论边界

本地材料位于 `.build/verification/instagram-native-probe/`：

- 首轮双图：`run-8550985d-2ea3-4eb3-b80f-e9d4df9d0c2b/`、`native-carousel-default.png`。
- 单图成功：`run-7f32e60a-5263-43b1-8bdf-61d2e9246380/`、`native-single-default.png`、`single-independent-decode.json`。
- 双图成功：`run-4d1c64b1-9197-4c34-8a9e-ea0e33c5a289/`、`native-carousel-success.png`、`native-carousel-second.png`、`carousel-independent-decode.json`。
- 各运行包含 session、导航、页面数据、逐图下载/错误与 SHA 记录。原始诊断及 revision-1 版本归档在 `.build/instagram-native-probe/`；临时 Cargo example 已删除，正式源码及配置未由本任务修改。测试实例已通过 Avenil 停止。

**本次结果证明：选定的公开单图与双图帖子，均可由匿名原生 WKWebView 读取目标媒体数据，再交给 Rust 宿主新下载并解码。** 这补充此前“Instagram 未实测”的范围，但不证明任意链接、长期稳定成功率、最高画质、上传原文件、Reels、Stories、私密内容、登录态、Windows、release 性能或正式产品集成通过。两个 case 不足以推算成功率。没有新增相簿/模特/策划/画册入口或写入图库；本轮对高级感与设计质感无直接界面改变，不虚构产品视觉验收。

## 原生 WKWebView 单帖验证：2026-11-04

用户继续授权在 Foliune 的原生 WebView 环境验证同一链接。本次使用当前 Foliune Cargo.lock 的 Tauri 2.11.5 / tauri-runtime-wry 2.11.4 / wry 0.55.1 构建独立原生诊断入口，平台为 macOS 15.0.1（24A348）。它不是 Chrome，也不是产品现有主窗口或已完成的链接导入界面；隔离配置不初始化图库、不注册产品命令/插件/远程权限。默认 WKWebView User-Agent 保持不变，`incognito(true)` 对应底层 `WKWebsiteDataStore::nonPersistentDataStore`，未输入账号、扫码或导入任何 Cookie。

**结果：该笔记的 5 张正文静态图片按顺序提取、全新下载及完整解码全部通过。** Avenil 管理独立 `app.foliune.native-link-probe` 实例，实际页面路径为 `/explore/6ac7142b000000001a032408`，标题“避雷！！！！”。页面曾出现可关闭登录提示，但不妨碍本次提取；未进入登录路径，亦未进行登录。原生截图显示帖子 `1/5` 与诊断窗口“正文 5 · 已下载 5”。

流程为 WKWebView 初始化脚本读取正文非重复轮播 → 专用导航回传并在宿主截获阻止导航 → Rust reqwest 无 Cookie 请求刚取得的 CDN 图片地址 → Rust image 解码及保存。请求禁重定向，限定 HTTPS 小红书 CDN，每图限 25 MiB、20 秒。不是 WebView 自己直接保存图片字节，也没有沿用上一轮已下载文件。

| 帖子顺序 / slideIndex | 实际文件 | 实际像素 | 字节数 |
| --- | --- | --- | --- |
| 1 / 0 | 01.jpg | 1080 × 2347 | 176757 |
| 2 / 1 | 02.jpg | 1080 × 1440 | 128522 |
| 3 / 2 | 03.jpg | 1080 × 1440 | 196194 |
| 4 / 3 | 04.jpg | 1080 × 1440 | 170271 |
| 5 / 4 | 05.jpg | 1080 × 1920 | 388590 |

本次 CDN 明确提供 `nd_dft_wlteh_jpg_3` JPEG，上次浏览器提供 WebP；没有自行改写 CDN 规格、转码或降清晰度。独立验收者复核了源码、原生截图和全部五图，另以 Pillow 完整解码并重算字节数、尺寸和 SHA；5 个资源 ID 与 SHA 均不同，DOM 位置和 slideIndex 连续为 0–4，排除了头像、评论和轮播复制项。第 3–5 图尚未在轮播中渲染时 DOM 自然尺寸为 0，但地址提取及实际下载解码均成功。样本内容与正文一致。

证据位于 `.build/verification/xhs-native-probe/run-a4598465-ffa5-47c3-88d0-6cd8ed2489c5/`，含 `session.json`、`navigation.ndjson`、`page-status.json`、`result.json` 和 5 个 JPEG；父目录含 `native-window.png`、`independent-decode.json`。诊断源码归档 `.build/native-link-probe/native_link_probe.rs`，配置、私有0600链接输入、启动脚本和独立 `.app` 同目录，不进入正式源码构建。临时 `examples` 入口构建后移除，避免常规全目标构建依赖本地忽略配置。已通过 Avenil 停止本轮诊断实例；原有应用实例保持。本任务未修改产品功能代码或图库；核对期间观察到其他业务文件发生并行变化，已保留，不据此声称整个工作区校验值不变。

边界：这证明当前 macOS 原生依赖栈对这一帖子可完成“匿名加载 → 有序正文图列表 → 宿主新下载 → 解码”，不保证任意链接、最高画质或上传原文件。图库导入、正式交互、登录态、其他帖子、Instagram、Windows、release 性能及分发仍未验证。本轮对“高级”与“设计感和质感”无直接界面改动；完整图片与真实格式的核验为后续照片优先的质量呈现提供依据，不声称产品设计验收通过。下文较早的“未进行原生验证”声明仅描述当时阶段，由本节补充实际验证范围。

## 真实样本验证补充：2026-11-04

用户随后授权验证笔记 `6ac7142b000000001a032408` 的完整分享链接。本节更新此前“未下载真实照片”的范围声明：本次已下载该用户指定帖子中的图片，仅放独立临时目录，未导入或修改 Foliune 图库。下文原调研的未实测声明对应最初资料调研阶段。

| 检查 | 实际结果 |
| --- | --- |
| 本机 Python urllib、桌面浏览器 User-Agent、不提供账号 Cookie、保留完整分享参数 | 最终重定向到 `/login`；HTTP 200，HTML 37294 字节，没有 `imageList`，不算解析成功 |
| Codex 内置浏览器打开同一完整分享链接 | 成功显示笔记，标题“避雷！！！！”，轮播计数 1/5；出现登录提示，关闭后仍可查看。本次未输入账号、扫码、导入 Cookie 或执行登录 |
| 正文图片提取 | 从 `#noteContainer` 内轮播的非重复 slide 提取 5 张；排除轮播复制节点、头像、评论图片；保留 DOM 中帖子顺序 |
| 下载与格式验证 | 5/5 文件成功下载；系统 sips 识别格式/尺寸，Pillow `Image.load()` 全部完整解码成功，5 个文件 SHA-256 各不相同 |
| 文件位置 | `/tmp/foliune-link-check/01.webp` 至 `05.webp`；记录 `/tmp/foliune-link-check/download-results.json`。浏览器下载先落 Downloads，再移入该独立临时目录 |

| 顺序 | 实际像素 | 格式 | 文件字节 |
| --- | --- | --- | --- |
| 1 | 1080 × 2347 | WebP | 121184 |
| 2 | 1080 × 1440 | WebP | 96422 |
| 3 | 1080 × 1440 | WebP | 170424 |
| 4 | 1080 × 1440 | WebP | 135946 |
| 5 | 1080 × 1920 | WebP | 441224 |

结论：本样本已跑通“浏览器页面 → 正文五图识别 → 下载 → 本地完整解码”，且 WebP 属于当前 Foliune 支持格式。直接 HTTP 请求本次未跑通；两种环境结果不同，尚未控制网络出口、TLS 特征、游客会话等变量，不能断言差异完全由某一原因造成。未使用浏览器之外的用户会话，不把本次成功推定为所有链接免登录成功。

限制：当前下载为页面明确提供的 `nd_dft_wlteh_webp_3` 版本，未改写 CDN 地址索取其他规格，未对照作者原文件；没有证实这是最大清晰度或上传原件。3 张带 LIVE 标识的内容仅取得其静态图片，本次不提取动态视频。没有做 Foliune 原生 WebView、Rust 网络实现、图库导入、备份、其他链接或 Windows 验收，也未进行产品界面的设计验收。测试不改产品界面，对“高级”与“设计感和质感”无直接视觉影响；实际像素和完整构图是后续质量标注的依据。

调研日期：2026-11-04。范围：小红书、Instagram 的单篇公开帖子链接及多图提取；只调研，不实现功能、不登录账号、不下载真实照片。

本文的“事实”指本次实际读到的官方文档或项目源码；“推断”指据此作出的工程判断；“未验证”指未在目标机器与平台账号上操作，不能当作运行验收。源码的 master 分支和在线文档会继续变化，以下链接是本次阅读入口，不代表锁定依赖版本。

## 结论

**技术上可以研究并实现单篇链接的图片导入，但不能承诺任意公开帖、免登录、稳定成功或摄影原图。** 两个平台需要分别处理；现成开源工具提供了多图提取实现证据，不等于 Foliune 本机已成功，更不等于获得平台或作品权利人的使用许可。

| 路径 | 小红书 | Instagram | 对本需求的判断 |
| --- | --- | --- | --- |
| 官方授权 API | 本次可读的账号平台仅开放基本资料，读取笔记仍列为规划中 | 面向 Business/Creator 专业账号管理，存在授权范围与账号限制 | 不能作为“任意公开单帖链接下载”通用入口 |
| 直接请求网页并解析 | 有实际维护的专用项目，支持笔记链接、短链接与图集 | 有维护中的提取项目，依赖网页/非公开接口与会话 | 可作限范围原型；须接受失效和登录/风控失败 |
| 用户在浏览器打开后提取 | 可以利用实际页面已加载的数据，但需要另建浏览器/扩展集成 | 同理，登录后可见不保证自动请求可用 | 复杂度更高，也未消除平台限制 |
| 本地文件导入 | 复用现有能力 | 复用现有能力 | 可保留为用户自行取得文件后的明确路径 |

上表依据见下文逐项来源。“高级”与“设计感和质感”在本轮没有直接界面变化；对应产品约束是准确表达图像质量、让用户看清导入范围与失败状态，不能用低清缩略图冒充摄影原件。本轮未进行视觉验收。

## 小红书

### 官方能力边界

**事实：** 本次可读的官方账号开放平台 Scope 页标明当前仅开放 `basic_info`，`read_notes` 为“规划中”，其说明也是读取授权用户发布的笔记。API 目录主要是 OAuth、Token、基本资料和解除授权，没有公开单帖图集下载接口。因此不能把“有小红书开放平台”理解为可通过官方 API 读取任意公开笔记。这里仅描述本次可见文档，不排除另有定向合作能力。来源：[官方 Scope](https://openaccount.xiaohongshu.com/docs/scope)、[官方 API 目录](https://openaccount.xiaohongshu.com/docs/api-reference)。

### 网页与开源实现

**事实：** XHS-Downloader README 列出 `explore`、`discovery/item`、带 `xsec_token` 的笔记地址和 `xhslink.com` 短链接，支持按序号下载图文中的图片。README 同时提示旧日期链接可能遭风控、Cookie 非强制但异常时可能需要更新，并明确标记“从浏览器读取 Cookie”功能已失效。以上是项目维护者说明，未作为本机成功证据。来源：[XHS-Downloader README](https://github.com/JoeanAmier/XHS-Downloader)。

**事实：** 当前 `app.py` 短链接正则覆盖 `xhslink.com` 和 `xhslink.cn`；请求层读取 HTML 或最终重定向 URL，包含请求头、Cookie、延时及浏览器模拟参数。它走的是网页提取路径，不是官方 OAuth 笔记 API。来源：[app.py](https://github.com/JoeanAmier/XHS-Downloader/blob/master/source/application/app.py)、[request.py](https://github.com/JoeanAmier/XHS-Downloader/blob/master/source/application/request.py)。

**事实：** 图像实现遍历 `imageList`，从 `urlDefault` 或 `url` 提取图像标识，再生成 CDN 地址；支持多种图像格式。该代码证明有多图提取办法，但地址改写与转格式不能证明文件与摄影师上传文件逐字节一致，也没有证明保留 RAW、EXIF、ICC 或未经平台压缩的尺寸。来源：[image.py](https://github.com/JoeanAmier/XHS-Downloader/blob/master/source/application/image.py)、[作品信息与类型解析 explore.py](https://github.com/JoeanAmier/XHS-Downloader/blob/master/source/application/explore.py)。

**推断：** 首轮应保留用户粘贴的完整分享文本/URL，在解析请求时保留 `xsec_token` 等访问参数；不能先删光查询参数、只留下笔记 ID 后再期待一定能访问。帖子身份去重和访问凭据应分开，日志应隐藏这些参数。短链接展开成功也应继续判断最终是否为笔记、登录页、错误页或风控页，不能把 HTTP 200 当图集解析成功。

**未验证：** 本机当前网络下成功率；游客 Cookie 是否足够；`xsec_token` 的准确绑定机制和有效期；各类短链接能否顺利跳转；完整图集数量、顺序、可用分辨率；图片 CDN 地址有效期。本研究不宣称能由笔记 ID 计算有效 Token，也不计划绕过验证码或风控。

## Instagram

### 官方接口与任意帖子

**事实：** Meta 维护的官方 Postman 文档将 Instagram Login API 定位为专业账号管理；Facebook Login 路径明确不能访问 consumer account，并涉及专业账号与 Facebook Page 的连接。另有业务发现等有限能力，但这不构成“粘贴任意公开个人帖 URL 即可下载”的授权接口。来源：[Meta 官方 Instagram API 集合](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)。

**未验证：** 本次 Meta 开发者主站的 Instagram API、oEmbed 与 Basic Display 停用公告均返回 429，因此未直接核实这些页面的当前细则。oEmbed 的嵌入用途不能直接当图片下载授权；本轮不以其 Token 要求或返回字段作为方案前提，也不依据旧 Basic Display 教程制定实施方案。供后续核对：[Instagram Login API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)、[oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed/)、[Basic Display 公告](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/)。

### 非官方提取能力与限制

**事实：** Instaloader 文档支持通过 shortcode 下载单帖；其数据结构区分单图、视频及 `GraphSidecar` 多项帖子。`get_sidecar_nodes()` 可枚举多图/视频；当前源码获取较高画质版本会尝试登录会话下的移动端媒体信息接口，而非保证上传原文件。来源：[单帖命令说明](https://instaloader.github.io/cli-options.html)、[Instaloader structures.py](https://github.com/instaloader/instaloader/blob/master/instaloader/structures.py)。

**事实：** Instaloader 的故障文档专门说明 429、请求速率假设、短时间反复启动导致限流的可能性，以及通过 Firefox 会话 Cookie 处理部分登录问题。它证明登录会话和限流是实际维护问题，不能承诺用户登录一次后永远稳定。来源：[Instaloader Troubleshooting](https://instaloader.github.io/troubleshooting.html)。

**事实：** gallery-dl 的支持站点表列出 Instagram，并将认证方式标为 Cookies；当前提取器处理 `carousel_media`，也显式识别登录页/挑战页重定向。源码中用户名密码登录被标为不再支持，要求使用浏览器 Cookies。来源：[支持列表](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md)、[Instagram 提取器](https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/instagram.py)。

**推断：** Instagram 可以作为受限的单帖解析能力研究，但首次使用就可能要求会话，且会遇到 429、检查点、页面结构/API 变化及网络不可达。私密帖、Stories、Reels 视频、整账号抓取和搜索均不应借由“支持 Instagram”自动纳入本轮范围。混合图文/视频帖子需要明确只选静态照片，不能把视频封面算作原帖静态照片。

**未验证：** 匿名单帖解析成功率、登录与双重认证流程、会话有效期、国内外网络差异、当前平台版本下完整轮播提取，以及 Windows/macOS 的实际成功率。

## 浏览器、Cookie 与桌面差异

**事实：** Tauri 在 macOS 使用 WKWebView，Windows 使用 Edge/Chromium WebView2。它们的运行时不同。来源：[Tauri WebView 文档](https://tauri.app/reference/webview-versions/)。

**推断：** Foliune 自身 WebView、系统默认浏览器、Chrome/Firefox 的会话不能假定相通。若走“在应用内登录后解析”，需要分别验证网站能否在两个系统的 WebView 登录、挑战页面能否完成、会话如何隔离和清除；若走外部浏览器，则还需要扩展、显式会话导入或另一个受控桥接，单纯打开网页不会把图片和 Cookie 自动交给 Rust。这里不建议默认扫描全部浏览器配置或要求管理员权限读取会话。

Cookie 可能代表账号会话，不能作为普通配置明文写入导入记录、错误报告或共享日志。对用户的能力表述应区分“打开网页”“完成登录”“已读取帖子”“图片已下载”，不要把登录成功当作导入成功。上述为工程建议，本轮没有读取或保存用户 Cookie。

**事实：** XHS-Downloader 项目提供 Mac/Windows 使用说明，但 macOS 的上游可执行文件被明确描述为未签名。Instaloader 安装页提供 Windows 独立可执行文件与 Python 安装方式；gallery-dl README 的独立包说明主要列 Windows/Linux，macOS 提供包管理器路线。工具可跨平台不等于可以原样随 Foliune 分发。来源：[XHS-Downloader README](https://github.com/JoeanAmier/XHS-Downloader)、[Instaloader 安装文档](https://instaloader.github.io/installation.html)、[gallery-dl README](https://github.com/mikf/gallery-dl)。

**推断：** 网络解析本身可以尽量集中在本地后端；如果引入 Python sidecar，还会增加运行时、架构包、签名、公证、版本升级及依赖维护。不能因当前 Rust 已有 HTTP 客户端就认为能复现专用工具的 TLS/浏览器模拟行为；也不能仅因工具作者提供二进制，就认为 macOS/Windows 集成已经完成。

## 是否直接采用现成依赖

| 候选 | 已核对能力 | 对 Foliune 的取舍 |
| --- | --- | --- |
| XHS-Downloader | 小红书单帖、多图、图片序号与下载地址；Python ≥3.12、curl-cffi，GPL-3.0 | 可作实现对照与原型候选。整体应用依赖较多，不宜未经许可与分发评估整包引入 |
| Instaloader | 专注 Instagram，单帖、轮播与登录会话；MIT | 可作 Instagram 原型候选；维护成本与风控失败仍然存在 |
| gallery-dl | Instagram 有提取器与 Cookie 支持；GPL-2.0 | 可对照提取实现，但不是已核实的两平台统一依赖 |

许可与运行时依据：[XHS-Downloader pyproject.toml](https://github.com/JoeanAmier/XHS-Downloader/blob/master/pyproject.toml)、[Instaloader LICENSE](https://github.com/instaloader/instaloader/blob/master/LICENSE)、[gallery-dl LICENSE 与说明](https://github.com/mikf/gallery-dl)。这些只是许可识别，不是法律兼容性结论。

gallery-dl 当前 README 还说明主开发已迁至 Codeberg。本次访问 Codeberg 受限，GitHub 支持表内未检索到 Xiaohongshu，直接读取 `xiaohongshu.py` 返回 404，因此只能得出“本轮未确认其支持小红书”，不能把它选成已具备两平台能力的依赖。后续选型应固定版本/commit、核对活跃上游和适配器范围。来源：[gallery-dl README](https://github.com/mikf/gallery-dl)、[GitHub 支持表](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md)。

## 平台许可与验证边界

本次能读取 Meta 官方反抓取说明，其明确把未经许可的自动采集描述为违反平台条款。该说明讨论 Facebook，不能直接替代 Instagram 最新具体条款全文；Instagram 条款页本次返回 429，小红书官方用户协议页没有可读正文。因此本研究不作“只抓公开内容即可合规”的结论，也不把任何开源项目许可证当作平台许可或作品使用授权。来源：[Meta How We Combat Scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/)、[Instagram 条款入口](https://help.instagram.com/termsofuse)、[小红书用户协议入口](https://agree.xiaohongshu.com/h5/terms/ZXXY20220331001/-1)。

若继续实施，先用自有或明确授权测试帖子验证两个平台、两个桌面系统。最低样本包括单图、多图、混合视频、失效短链接、缺失访问参数、登录失效、限流和中途取消；记录成功率、总张数/顺序、实际像素与格式、失败原因、残留文件和重复导入行为。图像质量应标为“平台可取得版本”，只有与原始文件对比后才可描述其具体保真程度。

本轮实际完成的是资料与源码核对；未安装或运行上述工具，未启动 Foliune 或其他服务，未读取用户会话、未下载真实照片、未测试账号风控、未进行原生界面或 Windows 验收。

## Foliune 当前代码与接入判断

以下为本仓库代码核对结果和接入建议，不代表已实现或已通过原生验收。

### 已有能力与入口差异

| 场景 | 当前实现 | 接入影响 |
| --- | --- | --- |
| 相簿 | `LibraryWorkspace.tsx` 调用 `prepareImport`，经 `curation.rs` 候选暂存和确认 | 链接下载结果可接同一候选链路；保持容量取舍和取消语义 |
| 模特 | `ModelEditor.tsx` 调用 `api.importPhotos('work')`，立即入库，再把照片 ID 加入未保存档案 | 现有导入与档案保存不是同一事务；新入口必须明确“导入图库”和“保存档案”的边界 |
| 策划 | `PlanPhotos.tsx` 使用共用 `PhotoPicker.tsx` 从图库选图 | 需补本地/链接导入及上层快照刷新；每场景最多 3 张，不得自动截取帖子前三张 |
| 画册 | `BookCreator.tsx` 独立实现图库选片，并未使用 `PhotoPicker` | 需接统一来源能力，保留章节、选片顺序与独立版本规则 |

相关源码：
- [导入 IPC 与本地文件选择](../apps/desktop/src/lib/curation-api.ts)
- [候选暂存、确认和清理](../apps/desktop/src-tauri/src/curation.rs)
- [本地图片解码与管理副本](../apps/desktop/src-tauri/src/photos.rs)
- [模特导入](../apps/desktop/src/features/models/ModelEditor.tsx)
- [策划参考图](../apps/desktop/src/features/planning/PlanPhotos.tsx)
- [共用图库选片](../apps/desktop/src/components/PhotoPicker.tsx)
- [画册选片](../apps/desktop/src/features/books/BookCreator.tsx)

已有 `Photo.source` 和数据库 `photos.source` 是自由文本，可保存可回看的帖子来源；尚无结构化平台、帖子 ID、媒体 ID/序号或内容哈希去重契约。需要重复导入识别时，应先明确其业务语义；不能把会过期的 CDN URL 当成稳定照片身份。外部参考图默认归“收藏”是产品建议，不能照搬模特本地导入当前默认“作品”的行为。开发前需确认或在来源流程中提供清楚的归属选择。

### 建议的统一流程

保持各场景原有主入口，通过紧凑来源选择提供“从图库选择 / 本地照片 / 链接导入”。相簿按原职责保留导入入口，不为其增加无关选片流程。

链接路径为：
粘贴单篇链接或包含链接的分享文字 → 平台识别与短链接解析 → 获取有序图片列表 → 完整构图预览与选片 → 下载选中图片并验证 → 候选确认入库 → 返回稳定照片 ID → 当前相簿/样片/场景/画册引用。

- 解析预览不等于已导入。确认前使用会话暂存，取消清理本会话，不生成正式照片。
- 导入成功后使用本地管理副本；平台删帖、离线和 CDN 链接过期不影响已导入照片的欣赏、备份及画册。
- 关联业务文档取消编辑后的行为必须明确：建议已显式确认入库的照片保留，取消仅放弃文档引用；这是建议，不能误称当前所有模块已有同一行为。
- 保持帖子图片顺序；只列帖子媒体，不把头像、推荐区、封面占位图混入结果。无法确认完整多图时不能以单张封面冒称解析成功。
- 策划按剩余参考名额限制最终选择，超额由用户选；混合图文/视频帖明确标识图片范围，不把视频封面当照片。
- 下载失败明确到图片；用户能够看见哪些没有取得，不能把部分成功显示成整帖完整成功。
- 复用中性深色控件、原比例图片和按需状态反馈；不新增长期占据工作区的抓取面板或大量说明文案。该提案对“高级”与“设计感和质感”的支持来自流程一致及照片优先，尚未进行视觉验收。

### 技术边界

建议由 Rust 宿主负责受限网络、下载与暂存，React 只组织流程；平台解析分别实现，不放到每个业务页面。现有 `reqwest` 可承担 HTTP，但不自带平台动态页面或登录能力。当前 CSP 不允许普通前端直接请求平台或展示任意远程图片，不能仅在 React 中 fetch 并预览后称完成。

允许的平台链接、短链重定向和媒体下载地址须分别验证；限制响应体、图片像素和超时，防止任意 URL 访问本地网络及巨量下载。分享链接解析时保留访问所需签名，避免归一化丢失；持久来源与日志避免泄露会话凭据或不必要的敏感查询参数。格式继续受 JPEG/PNG/WebP 支持范围约束；下载内容须验证，不按 URL 后缀假定格式。除非用户明确另开格式需求，不悄悄转码或降清晰度。

若采用用户登录的独立 WebView，网站不得取得本地图库 IPC 权限；登录状态只用于对应平台，支持退出清除，不进入图库备份或日志。这是待验证路线，不是已证实能登录并抓取的平台能力。[Tauri 远程能力安全说明](https://v2.tauri.app/reference/config/)、[WebviewWindow Cookie API 及平台限制](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)。

### 开发前的最小验证门槛

先用用户授权或专门测试内容验证两平台的单篇取图：小红书完整分享链接/短链、Instagram 单图/多图、匿名/登录/会话过期、原始排序、实际像素、重复导入、部分失败、取消和切库。记录样本与成功/失败原因，再确定平台实现及依赖。若打算采用开源下载器，单独核对许可证、打包体积、运行时和更新方式；无需先承诺把 Python/浏览器运行时装进桌面包。

最小验证通过后，再接统一来源界面和四类业务入口；不能把任一平台脚本能下载一篇帖子直接作为全功能验收。

### 本轮验证范围

本轮仅查阅平台一手资料、开源项目资料与本仓库源码；没有启动应用、登录平台账号、读取浏览器 Cookie 或下载用户照片，没有通过真实链接取图、原生 WebView 登录、Windows、成功率、性能或视觉验收。现有工作区变更未改动；除本调研记录外不修改功能代码。不把结构可复用推定为平台请求已跑通。


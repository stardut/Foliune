# 相簿电视欣赏可行性研究

研究日期为 2026-11-19。结论基于仓库源码和平台官方资料，实际电视、macOS 原生窗口与画质仍待验证。

## 第二轮 · Foliune 内发现同 Wi-Fi 的国产电视

用户已明确目标是直接在 Foliune 选择电视开播。以下是当前实施方向，后半部分保留首轮对系统外屏的研究。

### 可行性判断

**优先验证 DLNA／UPnP AV 的主动推送模式。** Foliune 在 Mac 上作为控制端，搜索电视的 MediaRenderer 接收服务。用户选定一台电视后，电视从 Mac 读取本次会话的媒体，Mac 控制播放队列。对支持这条链路的机型，日常可做到选中电视即播，也能避开整屏镜像。厂商可能要求打开电视的投屏开关，或者在首次接收时用遥控器允许连接。 [UPnP AV 架构](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-AVArchitecture-v1-20020622.pdf) · [长虹首次允许投屏说明](https://cn.changhong.com/fw/gdfw/gwzn/faq/202609/t20260930_497530.html?f=nvi)

市场覆盖率目前无法可靠量化。厂商的宣传将屏幕镜像、手机图库分享、影视 App 投视频、电视主动浏览共享文件等称为投屏。Foliune 需要逐型号确认三个条件：**Mac 发现电视、电视接受局域网本地媒体、Mac 能控制连续播放**。电视能显示 U 盘照片、接收某个 App 的在线视频或声明支持 DLNA，只能说明对应能力。电视固件、销售地区、投屏组件版本以及接收模式都可能改变实际结果。

### 中国大陆常见品牌的公开证据

| 品牌／样本 | 厂商资料证实的能力 | 对 Foliune 的判断 |
| --- | --- | --- |
| 小米／Redmi | 小米「米联」帮助明确提到同局域网、兼容 DLNA，以及投放本地图片。该页使用旧款小米盒子和早期手机系统作为示例。小米 S Pro Mini LED 2025 款和 Redmi A 2025 款的互联清单确认屏幕镜像，并要求对应电视投屏版本。 | **优先实测。** 有历史图片推送证据，现代机型样本仍要验证标准接收服务、JPEG 和逐张切换。可选一台 S Pro 和一台 Redmi A 系列，对照两台的固件及投屏组件。 [米联帮助](https://www.mi.com/service/mitv/wireless) · [小米跨端智联适配清单](https://os.mi.com/continuity/abilities/ab0000) |
| 华为智慧屏／MateTV | 影视 App 指南明确给出同 WLAN 的 DLNA 投屏。MateTV／MateTV 2 的指南也提到应用内视频、音乐和图片，具体步骤指向影视 App 指南。华为手机图库另有向兼容设备推图片的 DLNA 说明。MateTV 的苹果设备镜像流程需要在电视上安装「小柚投屏」。 | **优先实测一台 Vision 或普通智慧屏。** 有强视频证据和图片方向线索，需实测 Mac 发出的局域网 JPEG、MP4 和切换控制。MateTV 系列单独统计，手机图库成功与第三方桌面发端成功分别记录。 [华为影视 App 投屏](https://consumer.huawei.com/cn/support/content/zh-cn15790907/) · [MateTV 投屏指南](https://consumer.huawei.com/cn/support/content/zh-cn16077448/) · [华为手机图库 DLNA](https://consumer.huawei.com/cn/support/content/zh-cn15916424/) |
| TCL | 全球官网明确记载指定手机 TCL 20 Pro 5G 向 C825／R646 同网 DLNA 推送照片、视频和音频。中国大陆 98GA2 商用机页面将图片多屏互动、MacBook AirPlay 镜像、影视 App 投屏分别列出。大陆家用 V8E 产品页有多种投屏和 NFC 手机镜像说明。 | **优先实测一台大陆家用机。** C825／R646 有具体的照片推送记录，销售地区、固件和通用 Mac 控制端仍待核对。商用机型号及海外 Google TV 的能力单独记录。 [TCL 全球 C825／R646](https://www.tcl.com/global/en/blog/work-smarter-with-tcl-multi-screen-collaboration) · [大陆 98GA2](https://www.tcl.com/cn/zh/commercial-tvs/98-inch-ga2) · [大陆 V8E](https://www.tcl.com/cn/zh/tvs/65-inch-v8e) |
| 海信 | 投屏接收方案厂商乐播的 2019 年海信指南描述聚好看同网搜索、手机本地资源和海信微助手相册投屏。海信海外 VIDAA U9 手册还单独说明同网媒体分享、电视端浏览及 Miracast 屏幕共享。 | 大陆机型有照片投送场景线索，适用型号／固件和通用 JPEG MediaRenderer 仍待验证。海外 VIDAA 手册仅作对照。 [乐播海信电视指南](https://www.lebo.cn/news/mobileAboutNewsContent?id=458) · [海信海外 VIDAA U9 手册](https://www.hisense.com.my/wp-content/uploads/2025/08/93041_9603VIDAA_U9_EUEMCO_E-Manual_eng_202502%E5%AE%8C%E6%95%B4%E6%9F%A5%E7%9C%8B%E7%89%88.pdf#page=51) |
| 创维／酷开 | 酷开「爱投屏」官网区分手机内容投屏和镜像。创维商用 65BG22 在开封大学采购合同技术附件中列出 Miracast、AirPlay 和 DLNA，属于采购规格。 | 有设备级 DLNA 线索。大陆家用机的 JPEG／通用 MediaRenderer 仍待验证，可对照内置「爱投屏」开启或关闭时分别发布什么接收服务。 [酷开爱投屏](https://www.skytv.cc/) · [开封大学采购合同第 50 页](https://erqi.zfcg.henan.gov.cn/cmsweb81e27e/nas/webfile2024/kaifeng/rootfiles/2025/09/04/bfad32688f0f43948fb10f380a9cbd09.pdf#page=50) |
| 长虹 | 2026 年官方帮助注明同 Wi-Fi、选电视、电视端允许，以及图片等适用内容。2016 年多屏分享教程曾列出标准 DLNA 和 AirPlay，图片演示走 iPad AirPlay。 | 历史 DLNA 证据适合选样和排查，近期帮助只确认手机用法。新款的局域网 JPEG 推送、换图和首次授权仍待测。 [长虹 2026 手机投屏](https://cn.changhong.com/fw/gdfw/gwzn/faq/202609/t20260930_497530.html?f=nvi) · [长虹多屏分享旧指南](https://cn.changhong.com/fw/cjwt/czzd/ds_1024/201607/t20160731_55584.html) |
| 荣耀／康佳 | 荣耀 Magic UI 4.0 的智慧屏文档区分首连确认、手机镜像、Miracast 电脑投影和影音 App 投屏。康佳 A8 Pro 官方资料说明有多种投屏方式。 | 可列为后续扩展样本。两者当前资料均不足以确认 Mac 通用发端可推 JPEG 或可控制相簿播放。 [荣耀智慧屏](https://www.honor.com/cn/support/content/zh-cn15831140/) · [康佳 A8 Pro](https://www.konka.com/p-1381.html) |

乐播公开的接收端支持发布 DLNA 服务，另有可能需要确认的防骚扰模式。其发送端公开 SDK 面向 iOS 和 Android，虽然官方有电脑客户端，未找到面向 Foliune 的公开 macOS 发送 SDK。厂商合作和装机数字不能转成 Foliune 的支持率。 [乐播接收与发送说明](https://cloud.lebo.cn/document/9790727bb205722e.html) · [乐播 SDK 平台](https://www.lebo.cn/SdkCooperation.jsp)

### 最小实施路线

1. **发现设备。** React 复用相簿顺序和照片 ID 队列。Rust 宿主在用户打开「投到电视」后发起 SSDP 发现，读取 MediaRenderer 设备描述及实际服务，用 `ConnectionManager.GetProtocolInfo` 的接收侧能力作为筛选信号，再实测 `AVTransport` 对 JPEG／MP4 的支持。有设备名称、投屏图标或 MIME 声明都只是信号。网络权限及家庭 Wi-Fi 客户端隔离影响这条链路。macOS 15 起要验证局域网权限，Apple 还记录了从终端启动与正常安装启动的权限差异，验收需打开实际发行形态的 app。 [MediaRenderer 规范](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-MediaRenderer-v1-Device.pdf) · [Apple 局域网权限](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy?changes=_2%2C_2) · [现有桌面工程边界](architecture.md)
2. **首轮对照两种媒体。** 用同一电视验证一张 JPEG、连续 JPEG 和一段本地 H.264 MP4。电视要能从 Mac 的局域网地址实际取到样片，控制调用返回成功与电视真实上屏分别观察。首轮可用固定样片测试，无需先做转码集成或界面。 [AVTransport 规范](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-AVTransport-Service.pdf)
3. **在实测后选一种首版播放形态。** 如果 JPEG 可重复快速切换，而且没有明显黑帧、每张弹出播放器界面或误裁切，就用照片直推。播放间隔、暂停和前后张由 Mac 的队列控制。电视是否支持预取下一资源不能假定，`SetNextAVTransportURI` 在规范中是可选动作。若目标样本的视频接收明显更完整，可另评估 Mac 用 AVFoundation 将选集生成临时 MP4。电视一次播放整段，可能更适合稳定转场或配乐，代价是生成耗时、压缩、改间隔可能要重新生成，以及上一张／下一张依赖电视实际支持 `Seek`。是否能播本地 MP4 与是否能投在线影片要分别验证。 [AVTransport 规范 §§5.4.1–5.4.3、5.4.13](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-AVTransport-Service.pdf) · [Apple AVAssetWriter](https://developer.apple.com/documentation/avfoundation/avassetwriter?changes=lat_2)
4. **数据和控制限于本次投屏。** 只在用户选定电视后开放该会话所需的展示副本。沿用图库 ID、读取规则、EXIF 旋正和等比呈现，可用带短时凭据的媒体 URL。媒体 URL 通常须由电视主动 GET，若电视只支持 HTTP，该链路不加密，结束时应撤销读取权限并清理临时文件。设备发现和控制端点也限制在当前局域网和已选接收器。作品目录路径、GPS、未选照片及原片均无需公开。 [现有图片读取边界](architecture.md) · [UPnP AV 架构](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-AVArchitecture-v1-20020622.pdf)

如果实测决定采用视频形态，AirPlay 可单独评估应用内媒体投放。macOS 的 `AVRoutePickerView` 可在应用里显示系统媒体接收设备，并绑定原生 `AVPlayer`。这条路径需要兼容的 AirPlay 视频接收端及可路由的媒体，也需要实测本地生成的视频能否播放。电视的 AirPlay 镜像能力和 AVPlayer 的视频接收能力应分别记录。 [Apple AVRoutePickerView](https://developer.apple.com/documentation/AVKit/AVRoutePickerView?changes=_8&language=objc)

如果各品牌的内置接收服务无法满足画质与切换体验，**Foliune 专用电视接收端**可以接管全屏舞台、预加载、换图和配对，代价是目标电视必须支持安装，并完成一次电视端设置。这适合在原生 DLNA 路线实机结果出来后再决定。 [乐播电视端安装方式示例](https://www.lebo.cn/mobile/UseHelp.html) · [华为智慧屏应用中心](https://consumer.huawei.com/cn/support/content/zh-cn00750004/)

### 真机通过条件

建议先以一台小米／Redmi、一台华为智慧屏和一台大陆 TCL 家用机为样本，再补海信、创维、长虹。对每台记录完整型号、地区、固件、接收组件版本和电视当前页面。样本按实际可用设备替换。

- **发现与确认**。电视开机停留在首页时能否发现，是否要先开启投屏服务或打开接收页，首次和第二次是否需要遥控器确认。记录从打开设备列表到选中设备的路径。
- **本地媒体**。同一组测试素材分别推送 JPEG 和本地短 MP4，记录实际 HTTP 取图、首张上屏、瞬时黑帧、每张切换时的电视提示及停止结果。测试先短队列，再以两本相簿走连续播放、暂停、翻页、跨相簿和断开；MP4 对照额外测定位和准备时间。
- **摄影呈现**。用横幅、竖幅、方幅、全景和有细节的照片检查比例、边缘裁切、暗部和颜色。测试 1080p 与 2160p 的派生样片，实看画面细节，不用面板规格推定投屏画质。发生断线时检查 Mac 提示、关闭后是否仍能读取会话资源，以及电视是否残留上一帧。
- **覆盖结论**。只有在型号和固件的实际收图及连续控制通过后，才将该组合列入支持清单。把只验证了单张、只接受 MP4、需要额外接收应用或需重复遥控确认的组合分别记录。

本轮完成源码和官方资料核查，没有取得电视真机结果。初版方向是先验证照片直推，并以本地视频作兼容性对照。电视端的高级感由完整构图、真实细节和连贯换图验收，Mac 控件或接收成功日志不能代替这项验收。

## 第一轮 · macOS 系统外屏方案

第一轮评估了「多相簿欣赏 + macOS 已连接显示器全屏播放」。 用户在系统连接 AirPlay 电视或 Apple TV，并选择扩展显示，然后在 Foliune 选择一个或多个相簿及要播放的屏幕。电视呈现完整照片，Mac 保留播放控制。HDMI 扩展屏可用同一应用路径验证。AirPlay 配对由 macOS 处理，Foliune 负责照片队列、播放状态和画面。 [Apple AirPlay](https://support.apple.com/en-ie/guide/mac-help/mchld7e543a0/mac) · [Mac 连接 HDMI](https://support.apple.com/en-gb/108928)

「在 Foliune 内搜索同网电视并直接播放」是另一种体验，需要按电视所支持的协议分别实现和验证。如果目标电视只有 DLNA 或 Google Cast，且不能作为 Mac 扩展屏，首版无线方案就无法覆盖该电视。直接投屏应先以具体型号、地区版本和固件选择接收协议。

## 可复用的现有实现

| 能力 | 源码现状与接入判断 |
| --- | --- |
| 相簿成员及顺序 | `libraryAlbums` 已组织相簿及有效、废弃照片。相簿详情沿用 `sortAlbumPhotos` 或作品分组的浏览顺序，传入有序照片 ID。可复用这些规则构造多个相簿的队列。 [相簿模型](../apps/desktop/src/features/library-albums.ts) · [相簿工作区](../apps/desktop/src/features/LibraryWorkspace.tsx) · [产品约定](product.md) |
| 播放规则 | `App` 已将照片 ID 列表交给 `PhotoPlayer`。播放器包含自动播放、暂停、前后翻页、随机、循环、停留时间和当前会话配乐。外屏播放应共用一个队列、当前帧和播放计时器，避免两个窗口各自推进。 [播放入口](../apps/desktop/src/App.tsx) · [PhotoPlayer](../apps/desktop/src/features/PhotoPlayer.tsx) |
| 照片舞台 | 已有相邻照片预解码、切换动效、减少动态效果和等比适配。电视舞台可复用照片呈现机制，控件留在主窗口。现有播放器是主窗口内的模态，独立外屏窗口和断开后的状态处理需要新增。 [PlayerPresentation](../apps/desktop/src/features/PlayerPresentation.tsx) · [播放器样式](../apps/desktop/src/features/player.css) |
| 照片数据 | 应用使用受限 asset URL 和按照片 ID 读取外部原件的 `work-photo` 协议。独立的本地 Tauri 窗口可沿用应用内读取机制，目标窗口权限仍需按职责核对。由电视独立取图时，电视无法使用这些本地 WebView URL，需要单独的会话取图方式。 [图像 API](../apps/desktop/src/lib/api.ts) · [Tauri 配置](../apps/desktop/src-tauri/tauri.conf.json) · [工程边界](architecture.md) |
| 外接屏 | 项目中的 Tauri API 版本已提供 `availableMonitors` 和 `setFullscreenOnMonitor`，用于系统已识别的显示器。显示器枚举得不到尚未配对的电视清单。AirPlay 扩展屏在连接、断开及重连时的枚举和定位须用实机确认。 [Tauri Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#availablemonitors) · [当前窗口权限](../apps/desktop/src-tauri/capabilities/default.json) |

## 连接方式与边界

| 方式 | 能提供的体验 | 实施判断 |
| --- | --- | --- |
| macOS AirPlay 扩展显示、HDMI 扩展显示 | 电视全屏看照片，Mac 保留控制。AirPlay 需要兼容的接收设备和系统连接，HDMI 需要相应接口或转接。 | **首选。** 两条连接路径复用同一外屏播放器。画面实际清晰度、色彩、帧间稳定性由目标 Mac、电视、显示模式和连接决定。 [Apple 扩展显示](https://support.apple.com/en-ie/guide/mac-help/mchlb5f905a1/mac) · [Apple HDMI](https://support.apple.com/en-gb/108928) |
| macOS 系统镜像或共享窗口 | 已连接 AirPlay 的用户可先试单相簿本机欣赏。整屏镜像会同步桌面和控件，支持单窗口共享的系统与接收设备可缩小展示范围。 | 适合快速体验。系统文档列出镜像、扩展和共享窗口，具体选项按实机确认。 [Apple AirPlay](https://support.apple.com/en-ie/guide/mac-help/mchld7e543a0/mac) |
| Windows Miracast | 兼容 PC 和电视可通过 `Win + K` 连接，使用扩展显示时可沿用外屏思路。 | 后续 Windows 验证项。项目当前只有 macOS 构建和原生操作证据。 [Microsoft 无线显示](https://support.microsoft.com/en-gb/windows/hardware/display-graphics/screen-mirroring-and-projecting-to-your-pc-or-wireless-display?nochrome=true) · [项目 Windows 说明](../apps/windows/README.md) |
| Google Chrome 投放 | Chrome 可以将整屏或浏览器标签页投向兼容设备。可用整屏投放现有播放器，作为只支持 Cast 的电视的连通性对照。 | 依赖 Chrome 和用户手动选设备，整屏模式会显示桌面与控件，配乐可能仍从电脑输出。 [Chrome 投放说明](https://support.google.com/chrome/answer/3228332) |
| 应用内 Google Cast | 通过受支持的发送端控制 Cast 电视上的自定义接收页面，电视端负责呈现。 | Google 的桌面 Web Sender 面向支持 Cast 的浏览器，Tauri 用 WKWebView／WebView2，官方未列出这两个嵌入式宿主的发送支持。相册需要 Custom Web Receiver，涉及注册、发布时的 HTTPS 与电视能否取到照片。Google 标注静态图像显示上限 720p，并说明自定义接收页面在 Chromecast 的图形层为 720p、部分 Android TV 可到 1080p。4K 视频能力无法证明照片舞台能以 4K 呈现。 [Google Web Sender](https://developers.google.com/cast/docs/web_sender) · [Web Receiver](https://developers.google.com/cast/docs/web_receiver) · [注册要求](https://developers.google.com/cast/docs/registration) · [图片格式](https://developers.google.com/cast/docs/media#image_formats) · [接收端图形层](https://developers.google.com/cast/docs/web_receiver/core_features#guidelines_for_android_tv_compatibility) · [Tauri WebView](https://v2.tauri.app/concept/process-model/) |
| DLNA／UPnP AV | 对支持远程控制的 MediaRenderer，可让电视按 URI 读取文件。部分电视有兼容功能，图像、切换、停留和播放界面要按型号实测。 | 可作指定型号的兼容验证。电视能浏览共享媒体或能播 DLNA 视频，不足以证明能接收照片队列、保持等比构图或稳定无黑帧切换。 [UPnP AV 架构](https://openconnectivity.org/wp-content/uploads/2015/11/UPnP-av-AVArchitecture-v1-20020622.pdf) · [小米投屏支持示例](https://www.mi.com/service/mitv/wireless) |
| 电视浏览器或专用接收应用 | 电视主动打开同网播放会话，或由安装好的接收应用配对。Foliune 可控制照片舞台。 | 架构上可行。浏览器方案的入口、全屏、遥控器和实际画质依赖机型，接收应用另有开发与分发成本。合适的路径取决于目标设备，当前无实机证据。 |

Apple 的 `AVRoutePickerView` 提供 AirPlay 媒体路由。现有幻灯片由 WebView 图片元素绘制，本地配乐则由音频元素独立播放。仅增加媒体路由选择器不能据此实现照片舞台的共享。 [Apple AVFoundation AirPlay](https://developer.apple.com/documentation/avfoundation/supporting-airplay-in-your-app) · [现有播放实现](../apps/desktop/src/features/PhotoPlayer.tsx)

如果后续做电视独立取图，建议按次建立短时会话，只提供用户确认播放的照片和必要控制，使用高熵会话凭据，停止或退出即撤销。沿用稳定照片 ID 校验资源，使用旋正、等比的展示副本，避免披露原件路径、EXIF 或未选相簿。需要按接收设备实测局域网权限、网络隔离、HTTP/HTTPS、跨域与首次载入。Google 文档允许接收器加载 HTTP 内容，实际私有地址取图仍须验证特定接收器的请求方式。 [Google 注册要求](https://developers.google.com/cast/docs/registration) · [Google Cast 局域网权限](https://support.google.com/chromecast/answer/10063094)

## 首版体验建议

1. **选相簿。** 单本从详情页已有「欣赏」进入，多本建议从相簿列表进入多选。首版可让每次多选从当前相簿列表取材，是否需要跨收藏和作品连续选取另由实际场景决定。
2. **确认播放范围。** 显示已选相簿和实际播放张数。建议按本次选簿顺序串接，每本沿用浏览顺序，仅纳入当前有效成员。同一个稳定照片 ID 跨相簿重复时只保留首次出现的位置。采用本次会话队列，空相簿无可播内容时给出反馈，原件不可用时延续播放器的明确状态。
3. **选屏并播放。** 在欣赏入口提供「在外接屏播放」，只列系统已经识别的独立屏幕。没有可选屏幕时提示通过 macOS 控制中心连接 AirPlay 并选择扩展显示，或连接 HDMI。连接成功后，Mac 保留播放、暂停、前后切换、间隔、循环、随机及停止。配乐以系统实际音频输出为准，验收时明确验证声音落在 Mac 或电视。
4. **电视端只显示作品。** 中性暗底、保留横竖幅和方幅的完整构图，按可用画面等比居中。控件和错误操作留在 Mac。预加载下一张，照片就绪后才切换，避免黑帧。电视断开时结束外屏会话并告知用户，避免照片窗口自动落回错误屏幕。停止欣赏关闭 Foliune 播放窗口，系统 AirPlay 连接由用户管理。

## 实机通过条件

- 用隔离图库，包含至少两本有重复照片的相簿、横竖幅及方幅、细节丰富的高清图、EXIF 旋转图及外部原件缺失样本。验证单本、多本、顺序、去重、空队列、缺原片和排序一致性。
- 用 Apple Silicon Mac 加一台实际目标 AirPlay 电视或 Apple TV。先用现有单相簿播放器验证系统连通，再验证扩展屏枚举和目标窗口全屏。可用 HDMI 建立同一电视的画面对照。
- 在 release 桌面应用记录 Mac 系统版本、电视型号与固件、连接模式、实际输出分辨率、第一张上屏时间和连续切换表现。检查照片无裁切、无明显黑帧，竖图边距与横图细节合适，并观察暗部与颜色偏移。若有配乐，核对音频落点和暂停是否同步。
- 播放中反复断开、切换目标屏、停止和重新开始，检查电视端和主窗口状态同步，退出后无播放窗口或音频残留。用真实电视照片或短录屏记录画面和交互结果，分别判定功能与视觉质量。

本轮的设计取舍是让电视端专注于照片的完整构图、细节和播放节奏，把连接与控制放在 Mac。首版范围与队列规则均为研究建议。本次验证覆盖源码和官方资料，尚无电视实测、4K 或色彩验收结论。

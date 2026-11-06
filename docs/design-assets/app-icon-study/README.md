# Foliune 应用图标候选

2026-11-01。用户已明确回复“可以”，接受新的纯黑背景、柔和曲线 F 视觉稿。当前生产六资源已由这张精确源图作工程规格处理生成，不使用此前任何 C SVG。此前平版、厚版、双色稿及折面稿均作为历史记录；App 字标、字体和 UI 未改。实际包与 Dock 待验收。

## 最新：已接受的纯黑曲线 F · 工程接入

用户接受的精确输入为 `.build/verification/logo-clean-exploration/solid-black.png`，1254×1254 RGB。原始字节已复制到 [approved-solid-black.png](approved-solid-black.png)，SHA-256：

`40d2d8f7c8c9311a7dea0d2fa6f97f27ab8199919f973cf3c389cfcc59515730`

先看 [approved-format-board.png](approved-format-board.png)：包含原图与工程母版对照，以及真实 128 / 64 / 32px 在深浅底的显示。该板只核对格式、留白和小尺寸，不据此新增审美认可或 Dock 验收结论。

### 只做尺寸与透明遮罩

- 将完整 1254 方图以 LANCZOS 等比缩至 1024 方图，**不再次将原图挤入 864**，不调整 F 的位置或占比。
- 在 1024 画布上追加 `x80 / y80 / 864×864 / radius190` 的圆角 alpha 遮罩，采用 4× 抗锯齿；只将外部黑背景变透明。
- F 的亮度大于 32 区域在缩放后为 `(352,255)–(752,788)`，未触及遮罩。所有被遮罩影响的像素最大 RGB 仅为 `(1,2,1)`，确认只裁黑色背景。
- 遮罩前的直接缩放 RGB 与遮罩后的母版 RGB 逐像素差值为 **0**；即除了整图必要重采样，没有改 F 轮廓、颜色、光泽，也没有添加边线、投影、微光或重新着色。黑底沿用接受稿，不改回 `#15171a`。

工程母版 [approved-icon-master.png](approved-icon-master.png) 为 1024×1024 RGBA，SHA-256：

`4cf76bacfecb9dbb0469c7b58aa6e13c59b367bc7be90e92192854f70568ca13`

同目录提供 `approved-icon-128.png`、`approved-icon-64.png`、`approved-icon-32.png`。母版是接受稿的工程包装，不是新的创意版本。

### 六资源与格式验证

仅替换 `apps/desktop/src-tauri/icons/` 原有六文件：1024px `icon.png`、32px `32x32.png`、128px `128x128.png`、256px `128x128@2x.png`，以及真实多尺寸 `icon.icns` / `icon.ico`。未新增 iOS / Android 等平台目录。

- 所有 PNG 均为 RGBA，四角透明；生产 `icon.png` 与工程母版字节完全一致。
- ICO 包含 16 / 24 / 32 / 48 / 64 / 128 / 256px 七个真实帧，逐帧尺寸、RGBA 和透明角落通过。
- ICNS 由系统 iconutil 生成，并反向解包验证 10 个 16–1024px / @2x 图像，容器长度与分块也通过。
- 当前旧厚版六资源及 SHA-256 备份于 `.build/verification/app-icon-approved/before/`；新哈希、PNG 元数据、ICO 帧和 ICNS roundtrip 记录见 `.build/verification/app-icon-approved/after-manifest.json`。
- 源图至母版的像素、遮罩与缩放记录见同目录 `source-master-checks.json`；`source-scaled-1024.png` 是无遮罩参考，`tile-alpha-mask.png` 是单独 alpha 遮罩。工程生成与格式板脚本保存在该目录。

已实际查看接受源、母版与小尺寸格式板，未见 F 被裁。源图原字节和全部新资源哈希复核通过。未启动服务或执行前端构建；Tauri 包内资源、运行中应用与 Dock 的显示由主代理后续验收。

## 历史：C 折面结构稿

以下历史渲染命令中的 `/path/to/node_modules/sharp` 需替换为本机已安装的 `sharp` 模块目录。

失败双面稿的问题不是明暗不足：宽灰面占据竖干大部分，顶端、臂根和底端没有对应几何变化，64px 的轻折线消失后仍只是双色填充。本轮允许调整局部外轮廓，先构成闭合的面，再赋予明暗。

先看 [fold-structure-board.png](fold-structure-board.png)：512px 主图、仅与失败 clean 稿比较，以及真实 128 / 64 / 32px 深浅底成对检查。失败稿不是另一个可选方向。

结构稿由两个主面和一个窄转折面构成，均为实体中性色；没有渐变、阴影、描边、偏移 F 副本或滤镜：

- **正面 `#e5e5e2`**：100 单位宽竖干与 92 单位厚横臂组成完整 F；不是将原竖干大部分涂灰。内侧 18 单位回转属于正面自身轮廓。
- **侧面 `#b2b2af`**：仅 24 单位宽，在正面左侧与其沿共边连接；不在正面内部覆盖一条灰带。
- **窄转折 `#cececa`**：18 单位高的顶帽和臂根帽，共用同一个 `(24,18)` 投影方向。

可直接在图上核对三组连接：顶端 `(328,266) → (352,284)`，中横臂根/末端 `(610,460) → (634,478)`，底端 `(328,724) → (352,742)`。侧面的顶与底由同一向量收口，顶帽与臂根也按该向量改变外形。因此结构依据来自对应几何，不来自多画一条轮廓。它是克制的几何折面表达，不添加画册纸页、外框或其他图案。

已实际查看母版和对照板：128px 与 64px 可区分窄侧、顶帽和臂根连接；32px 优先保留 F 主形，细面自然收敛。主代理初看认为比宽灰条具有更完整的顶、侧和末端响应，可以进入独立图审；最终设计是否满足用户仍待审查，源检查不能代替该结论。

资产为 `c-fold-structure.svg/png`、`c-fold-structure-128.png`、`c-fold-structure-64.png`、`c-fold-structure-32.png`，检查记录见 `c-fold-structure-checks.json`。SVG XML、无滤镜/渐变/描边/字体/外部资源和四张 RGBA PNG 的尺寸、透明留白检查通过。生产六文件仍与旧厚版哈希一致，没有应用构建、服务或 UI 改动。

```sh
node docs/design-assets/app-icon-study/render-fold-structure.mjs /path/to/node_modules/sharp
python3 docs/design-assets/app-icon-study/render-fold-structure-board.py
```

## 历史：C 双面几何稿（图审未通过）

本稿曾作为候选检查，随后图审明确未通过：虽比旧厚版干净，但宽灰条没有顶端、臂根与底端响应，正面被挤窄，仍像双色分区。以下保留当时的尝试与局限，不再作为可选方案。

复盘旧厚版：偏移 F 与正面叠成双轮廓，连续灰切边、明暗和投影在同一边缘重复出现；缩小后容易合为灰边。继续添加阴影不能解决用户要求的干净程度和设计结构。

先看 [clean-planes-board.png](clean-planes-board.png)：512px 主图、平版 / 旧厚版 / 双面稿三者对照，以及每组依次排列的真实 128 / 64 / 32px 深浅底比较。不再增加方向菜单。

本稿完全移除偏移轮廓、投影、滤镜、渐变、窄描边和第三条切边。底色保持单一 `#15171a`，F 正面外轮廓与 C 平版相同，只保留两个实体中性受光面：

- 柔白 `#e7e7e4`：两条横臂与右侧竖干作为一个连续主面。
- 中性银灰 `#b4b4b2`：竖干左侧的宽次平面，宽 52–64 单位，占 96 单位竖干的一半以上，不作为窄轮廓线。分界在上横臂根部轻折，用意是将承托横臂的竖干视作结构轴。

这是一种几何折面意图，不是假称真实折射或三维材料计算。已实际查看：去除了旧厚版重复灰边，32px 保留 F 主形；但宽灰左面仍可能读成双色填充分区，两个面的转折是否足以形成用户所需层次尚未确定，不宣称已解决设计感。需主代理与独立审查直接判断，不用更强阴影补偿。

资产为 `c-clean-planes.svg/png`、`c-clean-planes-128.png`、`c-clean-planes-64.png`、`c-clean-planes-32.png`；检查见 `c-clean-planes-checks.json`。已通过 SVG XML、无外部资源、正面轮廓一致、无 filter / gradient / stroke / transform，以及四张 PNG 的尺寸、RGBA 与透明外留白检查。本轮生产六文件 SHA-256 与旧厚版 manifest 保持一致，没有前端、服务或构建操作。

```sh
node docs/design-assets/app-icon-study/render-clean-planes.mjs /path/to/node_modules/sharp
python3 docs/design-assets/app-icon-study/render-clean-planes-board.py
```

## 历史：C 材质层次稿（用户未认可）

用户否定了只调整比例、圆角与纯色填充的平版效果。本轮保留已选 C 的一体 F 正面轮廓和单一近黑 `#15171a` 底，将变化限定在 F 的材料和厚度，不返回折页、叠框方向。

先看 [depth-board.png](depth-board.png)：左侧 512px 主图、右侧与旧平版对照；下方每组左平版、右材质版，以真实 128 / 64 / 32px 在深浅底比较。

- **柔银正面**：`#f0f2f5 → #dce1e7 → #bbc5d0` 平缓明暗，不采用亮暗反复的强镜面高光。
- **连续臂根切面**：12 单位窄切面沿上横臂下沿、竖干内侧和中横臂上沿展开，处理实际转折；不会横穿标记形成无关的装饰光带。
- **薄侧缘**：正面轮廓向右 8、向下 18 单位的侧面投影，侧色为 `#8995a3 → #586473`。正面路径与上一轮逐字符一致，外侧厚度是新增可见层次。
- **近距离柔投影**：偏移 `(10,26)`、模糊 10 单位、不透明度 `.48`，让 F 与底分开，不采用大范围环境光雾。背景仍为单色，不增加图标框或额外符号。

交付 `c-depth.svg/png` 与 `c-depth-128.png`、`c-depth-64.png`、`c-depth-32.png`；渲染记录见 `c-depth-checks.json`。已实际查看：128 / 64px 可见侧缘、臂根转折和正面明暗；32px 主要保留 F 的轮廓，材质细节自然减弱。取舍是将厚度集中在低幅度侧面，避免为了小尺寸强行放大高光和阴影。这是观察记录，不作为用户认可或 Dock 验收结论。

SVG 可解析、内部引用无外链，正面轮廓一致；四张 RGBA PNG 尺寸与透明留白检查通过。设计阶段确认生产资源未变后，主代理与独立审查实际看图无必须返修项，随后执行下述资源接入。本轮未修改界面、前端或服务，未重新构建应用；实际包与 Dock 待验证。

```sh
node docs/design-assets/app-icon-study/render-c-depth.mjs /path/to/node_modules/sharp
python3 docs/design-assets/app-icon-study/render-depth-board.py
```

### 材质稿应用资源

仅替换 `apps/desktop/src-tauri/icons/` 原有六文件：`icon.png` 1024px、`32x32.png` 32px、`128x128.png` 128px、`128x128@2x.png` 256px，均为 RGBA 透明外留白。`icon.icns` 由系统 iconutil 从 SVG 逐尺寸渲染的 iconset 生成，反向解包 10 个 16–1024px / @2x 图像通过；`icon.ico` 逐帧验证 16 / 24 / 32 / 48 / 64 / 128 / 256px 七个真实帧。厚度、高光与主稿一致，不再加强。

上一轮平版六资源与哈希备份于 `.build/verification/app-icon-depth/before/`；新资源 SHA-256、PNG 元数据、ICO 帧及 ICNS roundtrip 记录见 `.build/verification/app-icon-depth/after-manifest.json`。同目录保留生成、验证和精确复制脚本。未新增平台目录，App 左上字标保持原样。

## 历史：C 深色平版精修与资源接入

用户已选择 C 的简洁几何 F 方向，并明确图标背景保持应用黑色。本轮只收敛 C，不继续 A / B；以下三方向材料作为历史对照保留。

先看 [c-refined-board.png](c-refined-board.png)：左侧 512px 主稿，右侧旧 C 与精修稿采用相同底色和标记颜色比较轮廓，下方在深浅背景展示真实 128 / 64 / 32px。

- 底色为单一中性近黑 **`#15171a`**，F 为实体柔白 **`#e2e5e9`**；没有大面积渐变、金属高光、纹理、边框或折页装饰。
- 竖干从 100 调至 96 单位，横臂厚度从 88 调至 92，避免机械等宽带来的僵硬。中横臂相对于顶横臂的轮廓宽度从约 82% 收至约 74%，使长短节奏更清楚。
- 内侧折转改为 22 单位柔弧；两横臂使用相同 `28 / 92` 轻斜切，较原版 `28 / 88` 更缓和。竖干底端取消斜收，改为克制的圆角平收，避免额外速度感。
- 竖干左侧从 x312 调至 x328，下端从 y756 收至 y740；结合更短的中臂调整留白与光学重心。所有轮廓均为独立单一路径，不依赖字体。

交付 `c-refined.svg`、`c-refined.png`（1024 RGBA）、`c-refined-128.png`、`c-refined-64.png`、`c-refined-32.png`。`c-original-dark.svg/png` 仅用于公平比形，不是新增方向，也不覆盖原 C。

已实际查看新对照板：32px 中长短臂与竖干分离清楚，内弧在小尺寸中自然收敛，不依靠细装饰维持识别。SVG XML、无外链/字体/位图/滤镜检查，以及五张 PNG 的尺寸、RGBA 和透明外留白检查通过，记录见 `c-refined-checks.json`。主稿已通过主代理与独立视觉审查，已生成应用资源；原生包及 Dock 待验收。

```sh
node docs/design-assets/app-icon-study/render-c-refined.mjs /path/to/node_modules/sharp
python3 docs/design-assets/app-icon-study/render-c-refined-board.py
```

### 应用资源接入

仅替换 `apps/desktop/src-tauri/icons/` 现有六文件，没有新增平台目录或修改界面：

| 文件 | 内容 |
| --- | --- |
| `icon.png` | 1024×1024 RGBA |
| `32x32.png` | 32×32 RGBA |
| `128x128.png` | 128×128 RGBA |
| `128x128@2x.png` | 256×256 RGBA |
| `icon.icns` | SVG 逐尺寸渲染后由系统 iconutil 生成，完整 16–1024px / @2x 图标组 |
| `icon.ico` | 16 / 24 / 32 / 48 / 64 / 128 / 256px 七个真实帧 |

保留透明外留白。原始六文件及 SHA-256 位于 `.build/verification/app-icon-c/before/`；新资源 SHA-256、PNG 元数据、ICO 帧、ICNS 容器与系统反向解包检查位于 `.build/verification/app-icon-c/after-manifest.json`。生成脚本及中间产物留在同目录，不进入应用运行逻辑。资源验证通过，不等于 Dock 及其他平台显示已验收；本轮未运行应用或前端构建。

## 历史：三方向对照

先看 [comparison.png](comparison.png)。上部三款为 300px 观察图，下部在深浅底展示真实 128 / 64 / 32px；打开原图以 100% 查看小尺寸，避免页面缩放影响判断。

| 方向 | 几何与意图 | 取舍 |
| --- | --- | --- |
| A · 折页 | 烟黑圆角底、银色页片；F 是页片中真实镂空，折角连接照片页与画册。下部斜切为自绘几何的一部分。 | 文件页联想较强，可能偏向文档工具而非摄影应用。 |
| B · 叠影 | 偏移照片框与开放 F 前片交叠；长短横臂以相同斜角收尾。 | 摄影关联较强，值得继续发展；32px 后框偏密，仍需精修。 |
| C · 刊印 | 浅中性底、墨色单体；斜切横臂与斜收竖干形成独立轮廓。 | 识别最简洁，摄影关联最弱，偏向出版物上的品牌印记。 |

三者作为平等的方向候选呈现，不预设推荐或成品结论。B 的摄影关联较强，但小尺寸仍需精修；选择方向后再做针对性收敛。

三款均为独立路径，不使用字体 F、外部字体、位图、外链或脚本。1024 画布的圆角 tile 位于 `(80,80)`，尺寸 `864×864`，保留透明外留白。明暗只用于轻微表面层次，不把图标材质当成窗口系统玻璃。A / B 采用烟黑与银白，C 采用中性浅底，不加入光圈、相机符号、彩光或纹理。

## 资产

- `a-fold.svg` / `a-fold.png`
- `b-frames.svg` / `b-frames.png`
- `c-monogram.svg` / `c-monogram.png`
- 每款的 `-128.png`、`-64.png`、`-32.png` 为直接从 SVG 渲染的检查尺寸，不从对照板截取。

## 生成与检查

本机使用已有 sharp 0.34.5 / librsvg 2.61.2，将 SVG 渲染为 RGBA PNG；未安装项目依赖。生成命令从仓库根目录执行：

```sh
node docs/design-assets/app-icon-study/render-study.mjs /path/to/node_modules/sharp
python3 docs/design-assets/app-icon-study/render-board.py
```

`render-study.mjs` 也可接收另一台机器已有的 sharp 模块路径；省略参数时使用 Node 本地模块解析。对照板通过 Pillow 合成，中文使用本机 STHeiti，英文使用 SF Pro；这些字体仅用于说明，不属于图标资产。

自动检查：3 个 SVG 均可解析、无字体或外部资源依赖；12 张 PNG 的尺寸、RGBA 通道、透明角落通过，记录见 `render-checks.json`。

历史观察：A 在 32px 保留清晰负形 F，折角仅作次级线索；B 在 32px 仍可辨 F，但框与字的层次趋近；原 C 小尺寸识别直接，浅底下 tile 边界较弱而墨色标记清晰。这是初轮候选观察，不作为真实 Dock 验收。初轮当时尚未生成生产 ICNS / ICO，也未启动应用或修改生产图标；后续 C 精修及接入状态以上方最新记录为准。

## C 主稿应用接入验证（2026-11-01）

用户选择 C 并明确黑色背景后，已精修并替换 Tauri 既有六个图标资源；原资源备份于 `.build/verification/app-icon-c/before/`。独立审查已实际看精修主稿及32/64/128px对照，未见阻塞问题；品牌独特性仍是克制的几何F，不声称具有强专属记忆点。

PNG尺寸/透明角落、ICO7帧、ICNS10条目及系统反解检查通过，生产icon.png与SVG主稿PNG一致。Tauri release app构建通过；包内Contents/Resources/icon.icns与生产ICNS逐字节一致，记录在`.build/verification/app-icon-c/bundle-check.json`。Avenil启动“Foliune 深色设计验收”后原生页面正常加载，现有字体、字标和页面未改。

本轮未实际观察Dock/Finder显示或系统缓存刷新，也未运行Windows包；文件和构建验证不推定这些项目已通过。

## 材质稿打包验证（2026-11-01）

用户反馈平版缺少设计感与层次后，已在保持C正面轮廓和#15171a黑底的基础上增加柔银face、连续根部切面、薄侧缘和近投影。主代理与独立审查实际看depth-board：层次在128/64px明显、32px保持识别，无必须返修项；改善限于材质，轮廓专属辨识并未大幅变化，不将审查通过当用户认可。

生产6资源已替换，平版备份位于`.build/verification/app-icon-depth/before/`；新PNG/ICO7帧/ICNS10条目和系统反解检查通过。Tauri release构建通过，包内ICNS与生产源逐字节一致，哈希5e334b0b7af2a260ae40e1532f36fad4ec6c7d6a865dafc3c8c9269af2cefc82，证据bundle-check.json。验收应用已通过Avenil重启，前端JS/CSS资源保持BcmoXwOB/Xd5xY5FD。实际Dock/Finder视觉缓存及Windows运行未实测。

## 最终接受稿打包与系统显示（2026-11-01）

用户明确回复“可以”接受纯黑背景曲线F，接入原稿为`approved-solid-black.png`（源字节hash40d2d8f7c8c9311a7dea0d2fa6f97f27ab8199919f973cf3c389cfcc59515730）。完整1254方缩至1024后仅追加既有tile圆角alpha，RGB与直接缩放逐像素差0，F bbox(352,255,752,788)不触遮罩。独立工程复核原图、母版、生产6资源、ICO7尺寸、ICNS10条目及小尺寸对照通过；不再重新评价用户已经接受的方向。

Tauri release构建成功，包内ICNS与生产源逐字节一致（hash b7524383d13b3448a5bbf4328e39f093c54981c1d5f35060a3c6fa70b24177ec），证据`.build/verification/app-icon-approved/bundle-check.json`。Avenil重启验收应用后原生相簿首页正常加载。Finder Quick Look实际显示正确的新纯黑曲线F，截图`finder-preview.png`。没有修改页面、字体、字标或照片数据。Dock图标缓存及Windows实机未验，Windows资源已生成验证不等于Windows运行通过。

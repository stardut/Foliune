# 原生材质受控对照

2026-10-30，用户实窗反馈HUD配合统一`.88`遮光“深度合适，但仍像纯色”。人工纹理已清除且禁止恢复，本轮尝试公开支持的Popover系统材质，先保持同一遮光、Dark/Active及透明宿主，以比较系统配方；只有实际结果支持时再减少前端遮光。未将材质名称当作更深或更透的保证。

场景与主次：保持现有深度、作品优先、内容隔离，不动布局、纸张、业务或B控件。系统材质没有公开的黑位/透光独立控制参数，因此需如实记录能否满足自然通透目标，不能用渐变/噪声掩盖限制。

首轮仅修改macOS主配置和独立验收配置`hudWindow→popover`，前端`.88`不变；原生同窗取证后比较采样与实看。不同壁纸/桌面参与不能仅用单窗截图证明。

## 控制变量结果

首包Popover+.88前端类型/生产构建与macOS release构建通过，原生对照图`native-popover/popover88.png`。相同无内容区域旧HUD RGB约20/21/25，新Popover约17/18/22。仅说明单窗截图中的配方明度较深，不是实测壁纸透明度或平均整窗深度。首轮配置冻结`source-popover88.json`。

据此仅减薄同色遮光`.88→.84`，保留Popover。理论系统颜色参与余量12%→16%，约1.33倍，但这只是alpha数学，不保证用户感知改善或不同壁纸效果。没有加入人工图案。最终Popover+.84前端类型/生产构建与macOS release构建通过，资源`index-_mSULC4S.css` / `index-BYt4z5Eh.js`，Avenil独立实例PID21653。有效配置与源码冻结`source-final.json`，四项独立核对匹配。相同截图区域最终RGB约21/22/24，与旧20/21/25接近；不能据此声称全壁纸深度相同。

主代理实操宽窄收藏首页、弹窗打开取消、已有3页画册打开未编辑，最后恢复宽窗。证据`native-popover/{final-wide,narrow,dialog,book}.png`。独立图审确认深度/无人工图案/照片纸张隔离无新问题。

**用户实际反馈：深度合适，仍像纯色。核心自然透光目标未通过。** 不将alpha理论增加或构建成功当材质成功。保留当前可检查候选，不再凭名称试其他系统材质。

## 合成链诊断

只读核对最新release构建指纹及Tauri/Wry/Tao/window-vibrancy源码：review运行参数确为Popover/Dark/Active/transparent/零alpha，Tauri的macos-private-api和Wry transparent特性启用；NSWindow非opaque且背景透明，WK drawsBackground=false，underPageBackgroundColor透明；VFX加在当前Parent的WK之下且BehindWindow。Parent没有全窗填色，普通图库只有一层surface；未发现隐藏不透明底板、错误配置覆盖或效果加在旧视图上的证据。这是源码/构建核对，不是运行时完整视图树证明。

通过仅查询系统属性的临时AppKit小程序，实际读到reduceTransparency=false、increaseContrast=false，未修改设置。直接Swift查询因本机Swift/SDK不匹配失败，改为clang编译的Objective-C读取成功；脚本未创建窗口或项目服务。

当前已知链路为桌面→系统材质→透明WK/网页根→84%统一遮光→内容。当前公开接口没有把黑位与壁纸对比度独立调节的参数，不能靠同一alpha同时保持黑位和显著扩大背景变化。用户曾确认较薄HUD候选透壁纸，进一步不支持永久不透明覆盖假设。需要扩大到原生材质实现的可行性验证时，先说明范围；不默默加入未记录私有渲染接口或屏幕采集。

# 深色玻璃通透与层次

2026-10-30，用户认可加深后的背景，但反馈仍像纯色，要求增加毛玻璃通透和材质层次。本轮保留连续深色、照片优先与既有布局，调整系统材质、外壳遮光和极轻整窗反光；不添加分区底板、彩色光斑、照片滤镜或新动画。

现有UnderWindowBackground配合64%前端tint，前端层只保留36%的系统底色差异。Apple没有公布各材质透明度排序，不能断言换配方必然更透。本轮单候选为Dark/Active的HUDWindow系统材质，加`rgba(8,10,13,.36)`遮光：让原生材质更多参与，在真实窗口核对是否仍足够深。HUD原本语义为抬头浮窗背景，用于本项目整窗是一项视觉取舍，Tauri现有API支持，不需要新依赖或运行时注入。

外壳补中性、低强度、连续反光与极细内侧边缘，装饰仅限外壳背景，不覆盖照片/纸张，不拦截鼠标，不增加窗口内大范围模糊或动态重绘。

验收：构建与原生包；同实例真实摄影宽窄首页、弹窗、照片墙和画册纸张检查；对照深度、文字/焦点、材质连续性与是否偏灰。工具单窗口截图通常缺少桌面合成，壁纸实际透光程度由本机实看确认，不把CSS权重、截图或构建当作透光证明。

## 候选实施与待验项

候选已实施：macOS与验收覆盖配置同步为HUDWindow、Dark/Active；唯一tint为`rgba(8,10,13,.36)`；外壳背景增加`linear-gradient(135deg,#ffffff06 0%,transparent 42%,#00000008 100%)`与极细内缘，未增加伪层或新模糊。前端构建（含TypeScript）与macOS release打包通过，资源`index-DCplhw5b.css` / `index-DIoXkoX5.js`。Avenil独立验收实例`app.foliune.dark-review`本轮PID7274，停留相簿首页。

原生页面已显示，截图为`.build/verification/glass-depth/hud-candidate.png`，四份修改前基线及`source-freeze.json`同目录。单窗截图相较旧版明显偏浅；用户随后实看明确反馈“通透了，但明显变浅”，确认新材质更通透，同时该候选未满足深度目标。

## 依据实看反馈校正深度

保留已确认更通透的HUD材质和连续微反光，仅将中性tint由`.36`调为`.68`，压住HUD配方的高明度；这是同一材质上的深度校正，不将其与旧UnderWindowBackground同alpha直接比较。暗化和壁纸参与存在权衡，不能声称加厚遮光完全不影响通透。先核对原生明度、文字/浮层及照片呈现，再由用户实看最终通透与深度平衡。

校正仅修改`theme.css`一行alpha，前端构建（含TypeScript）与macOS release构建通过；最终资源`index-BliSxTIe.css` / `index-C375MX7P.js`，Avenil验收实例PID11371，首页运行。原生检查宽窄首页、新建相簿打开/取消、已保存3页画册纸张与字幕，再恢复首页尺寸。图片保存在同目录`hud-deep.png`、`hud-deep-narrow.png`、`hud-deep-dialog.png`、`hud-deep-book.png`。宽窗2640×1760，窄窗1842×1242像素。

同尺寸同位置截图内背景样本从RGB(83,84,86)降为(46,47,49)，证明这一组捕获中的加深，不等于桌面合成测量或所有壁纸下的固定亮度。主代理实看文字、按钮、焦点和浮层边界可辨，白纸、照片和字幕未受外壳反光覆盖。五张业务表规范化指纹、65原图SHA和冻结源码均一致，见`final-integrity.json`。本轮以更通透的系统材质、克制连续反光和深度校正落实质感方向，未以自评分声称已获最终审美认可。

用户仅确认`.36`版本更通透，`.68`下的最终透光与深度平衡尚未得到实看确认；不将旧确认直接外推。相簿弹窗取消与已保存画册未产生业务变更。本轮未重验图库中末段、完整动效、外部AI、HTML导出、Windows或正式分发，照片/纸张/导出隔离另有源码检查；不以构建替代这些验证。

原生材质研究：Apple未公布配方透明度排序；Tauri2.11.5现有HudWindow映射和BehindWindow路径支持本次改动，无新依赖/运行时注入。参考[HUDWindow](https://developer.apple.com/documentation/appkit/nsvisualeffectview/material-swift.enum/hudwindow)、[NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview)。

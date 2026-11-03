# 雨天湿玻璃材质方向

2026-10-30，用户明确指出规则渐变不自然、不高级，希望雨天雨滴洒在玻璃上的自然变化。本轮从规则光带转向不规则水滴聚散、湿膜散射与局部柔和反光，保留深色基底和B控制层，照片/纸张/布局不变。

制作项目自有透明湿玻璃纹理资产，保留生成alpha，接入外壳背景绘制；纹理控制为静态、不规则、自然大小分布，背景中可辨，不覆盖照片或文字。系统HUD与壁纸透明宿主继续保留，但静态纹理只表达表面水滴与散射，不能宣称真的折射了系统壁纸。

验收先看资产，再看原生同首页宽窄/弹窗代表状态：是否摆脱规则色带，是否像自然湿玻璃；水滴不能抢过照片，不能让文字脏乱。背景纹理、透明合成与用户最终审美分开判断。前端/原生构建、独立源审及实图检查；不改图库、纸张或系统壁纸，不加自动雨滴动画。

## 生成资产

使用内置imagegen生成透明资产，原件`/Users/junran/.codex/generated_images/01a18bc1-163d-7b01-838b-be87676acbc6/exec-83441e29-1898-4729-ad01-730957a1f6c7.png`原样复制为`apps/desktop/public/textures/rain-glass-v1.png`。1536×1024 RGBA，alpha范围2–249、均值约73.45；原/public/dist哈希均为`ea2fa381e6148331845e00cfb6fe4a50e1cff573ee186139f9f837e3596a7acc`，没有resize或改alpha。不是用户照片，也不是系统壁纸截图。

实际生成提示词：

> Use case: photorealistic-natural. Asset type: transparent PNG material overlay for a premium dark macOS photography application's background. Create a wide landscape 3:2 texture layer of REALISTIC RAIN-WET FROSTED GLASS viewed straight on, only the water film, translucent condensation and raindrop surface reflections, with a genuinely transparent alpha background. No app, no text, no objects, no window frame, no scenery. Natural rainy-day water distribution: many irregular small and medium droplets, a few gently coalescing drops and soft short trails, varying density and focus, subtle cloudy diffusion and soft irregular patches of reflected overcast daylight. Sophisticated smoked-glass surface: neutral charcoal and silvery cool gray reflections, restrained highlights and soft dark rims, no brilliant white sparkles. The droplets should form organic material variation across the full pane, not a regular grid, no painted diagonal light band or regular radial gradient, no dramatic bokeh circles, no large lens balls, no neon colors. Keep ample visually quiet areas interspersed organically so text and photographs can be readable over the final dark UI; this is a subtle physical material, not a rain-themed poster. Aim for photographic, tactile, believable rainy window glass, high detail, natural randomness, gentle optical softness. Preserve real transparency between water features and in glass so a separate dark native glass base can show through. Output ONLY the transparent material layer, full bleed, landscape.

## 接入与检查

移除旧规则背景光带，纹理通过shell隔离栈中负层级`::before`绘制，位于父背景之上/所有业务内容之后，`pointer-events:none`，center/cover/no-repeat，不接收交互。shell增加relative已核对既有absolute内容都有自身定位祖先；固定浮层不变。深黑基底与B控件不动。

首包`.32`透明度原生图已显示自然水滴/水痕，但主代理判断明显偏抢眼，未作最终验收通过，记录`rain-glass/after-native.png`。接着仅将纹理层强度收至`.18`，不改资产alpha或整个窗口透明度，以维持照片优先。

最终`.18`版前端类型检查/生产构建与macOS release app构建通过，最终资源`index-CIDkoTtu.css` / `index-B96OhCYA.js`。Avenil复用独立实例`Foliune 深色设计验收`（`app.foliune.dark-review`），PID68141，检查后恢复宽窗收藏首页，留供用户实看。

主代理实际检查宽窄收藏首页、新建相簿弹窗打开与取消、已有3页画册打开；没有创建相簿或编辑画册。证据在`.build/verification/rain-glass/`：`final-wide.png`、`narrow.png`、`dialog.png`、`book.png`。本轮`before-native.png`可能处在启动加载阶段，不作有效对照；此前规则渐变参照`glass-reflection/final-native.png`。

独立审查核对源码、资产原件/public/dist一致性及最终四张代表图：水滴/水痕可辨，照片无纹理覆盖，文字、导航、计数可读，弹窗和白纸保持干净，宽窄cover未见非等比拉伸、拼接缝或平铺。没有确认的功能或内容隔离阻断问题。

**设计验收保留**：最终`.18`依然能明显读到具象大水滴，空相簿、标题周围和画册属性区尤其明显，更接近雨玻璃背景图；不能据此宣称已经克制、不抢作品或高级达标。此次完成雨天材质候选的实现与代表状态检查，用户最终审美认可仍待实看。静态透明纹理不产生真实桌面折射，系统玻璃底层保留，但本轮截图不证明桌面合成效果。未重验照片墙中末段、完整动效、独立导出、其他平台及正式分发。

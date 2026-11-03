# 沉浸查看与焦点白框治理

2026-11-01，用户要求预览静止时隐藏上下工具栏、鼠标移动显示，并指出返回照片墙后的整图白框及其他位置的类似问题。

## 方案与边界

预览初始工具栏可见，约2.2秒无操作后隐藏；指针移动和键盘导航唤醒，工具栏悬停或拥有键盘焦点时保持可操作。隐藏工具栏不得拦截指针、被Tab聚焦或被读屏当可用操作，关闭后清理计时器。照片舞台的空间不随工具栏显隐变化，保留完整构图；减少动态效果时采用即时显隐。

整图白框按焦点来源治理：指针操作和程序恢复焦点不应因WebView保留的focus-visible状态绘制大白框。统一区分指针与键盘导航，仅在需要键盘定位时显示克制焦点，保持焦点恢复和键盘可达性；不得全局禁用outline，也不得误删照片已选框、画册选中、标注边界或输入框反馈。修改适用全应用入口，避免逐页blur补丁。

验收：查看器静止隐藏、移动唤醒、反复显隐照片尺寸稳定、工具栏/键盘焦点保护、隐藏可达性与timer清理；鼠标单击预览→返回/关闭后照片无白框，右键取消、相簿入口与Tab焦点、跨页面检查。
## 实施与验证

正式源码6文件：PhotoReview/photo-review.css、library.css、index.css、main.tsx及lib/input-modality.ts。工具栏初始awake，以一个计时器及最后活动时间检查2200ms闲置；指针事件只更新ref，不持续setState。悬停或键盘工具焦点保护；hidden同时inert/aria-hidden/visibility/pointer-events，Tab同步flush唤醒，pointer控件焦点隐藏前转回舞台。grid行保留，减少动态效果不依赖动画。卸载清timer，输入模式监听在入口安装、HMR清理。

统一输入规则：pointerdown设pointer，Tab/导航键/Enter/Space/ContextMenu/F10设keyboard；Esc/纯文字/修饰键及程序focus不改变方式。pointer/default只移除非表单焦点描边，并排除.region-box；键盘照片/相簿为1px细边。选择框与标注边界不改，焦点恢复不删除。

三项组件/timer/modality/选择回归、TypeScript/Vite和Tauri release构建通过，最终资源index-BcmoXwOB.css/index-Xd5xY5FD.js，经Avenil重启“Foliune 深色设计验收”。macOS隔离65图相簿原生实测：初始可见→静止2.6秒上下工具栏从截图和AX消失；指针点击舞台唤醒；再次静止→Tab唤醒并落到下一张按钮，焦点保留2.5秒后仍可用；指针悬停页码区2.6秒保持显示。awake与idle的照片中段在排除指针后逐像素一致，显隐不改变舞台几何。

鼠标点击返回、指针打开后Esc返回、右键菜单取消后均无整图白框；Tab到下一张仍有1px焦点提示，相簿返回首页未见鼠标白框。没有修改原件、相簿关系或画册。证据`.build/verification/immersive-preview/`，final-idle、awake/idle、pointer-awake、keyboard-awake、toolbar-hover、mouse-return、escape-return、menu-cancel、photo-keyboard-focus、album-home-pointer及source-final.json。

独立审查已检查源码、重跑三项回归PASS、查看八张原生代表图，已测范围通过。纯pointermove唤醒仅组件/源码验证（原生工具用了指针点击），没有真实读屏、窄窗、Windows或系统减少动态效果开关实测；其他页面每一处焦点未逐一原生遍历，统一机制源审不等于所有页面实测通过。

本轮通过闲置退场与按输入方式提供反馈减少作品干扰，同时保留键盘可达性及必要选择语义。

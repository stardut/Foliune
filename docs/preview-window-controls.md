# 大图查看的窗口拖动与缩放

2026-11-01 用户报告大图查看时顶部无法拖动窗口、无法双击放大。

## 根因与方案

全屏dialog位于顶层，覆盖App已有header拖动区；PhotoReview本身未声明拖动区域。工具栏又会进入inert/隐藏状态，单纯给内部header加属性无法覆盖隐藏时的操作。

复用已安装Tauri2.11.2的data-tauri-drag-region机制，保留常驻顶部安全带和非inert的header拖动承托；标题及空白支持deep拖动，返回按钮明确阻断。内部工具栏仍按既有2200ms规则隐藏，外层保留原grid尺寸，舞台/底部按钮不成为拖动面。使用框架原生macOS鼠标抬起双击处理，不增加手写IPC、窗口权限或自定义替代路径。

验收：顶部空白与标题拖动、双击放大/恢复，HUD隐藏时保持；返回/翻页不触发拖动，图片与底部空白不误拖。原生操作与实际框架drag.js事件回归、定时器回归分别记录；窗口交互不得改变照片布局/数据。
## 实施与验证

正式仅改PhotoReview.tsx和photo-review.css。常驻绝对top strip高safe-top+12，header外新增非inert的deep拖区承托，内部header继续原inert/隐藏规则；返回按钮显式false。舞台和footer不声明drag。没有新增API调用、事件替代、权限或native配置。

组件/定时器回归通过；在VM直接执行本机Tauri2.11.2真实drag.js，结合实际JSX composed path验证strip、标题、HUD隐藏后的外壳、按钮/SVG阻断、舞台/footer排除，以及macOS鼠标抬起双击/移动取消。独立审查已读源码并重跑通过。TypeScript/Vite及Tauri release构建成功，资源index-CXV8d7mE.css/index-Do4cpLYD.js，经Avenil重启“Foliune 深色设计验收”。

macOS真实65图隔离相簿原生检查：双击标题由2640×1760变3024×1888，再双击恢复2640×1760；HUD静止隐藏、AX无返回按钮后，双击顶部空白仍变3024×1888。下一张按钮仅切到2/65、窗口保持正常尺寸，返回按钮正确关闭预览。原生顶部拖动已执行；截图只含窗口本身，无法据此量化桌面位置，用户在实际窗口明确确认“可以正常拖动”。

证据目录`.build/verification/preview-window-controls/`：normal/title-double/title-restored、idle-before-double/idle-top-double、after-top-drag、next-button、native-results.json及source-final.json。未修改照片、持久化数据、图标或其余页面。Windows/Linux本轮未实测，不能外推为通过；没有重复无关Rust业务测试。

本轮恢复预览内标准桌面窗口操作，保持连续深色、照片主体和隐藏工具栏的既有视觉，避免新增可见把手或说明文字。

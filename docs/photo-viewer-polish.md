# 大图查看界面精修

2026-11-01，用户要求去除预览外围白框、精修按钮及工具栏、保持深色让照片突出；右下角不显示选择框，预览默认查看。

## 方案与范围

舞台外围白线来自入场主动聚焦stage叠加focus-visible，不能把整面舞台当作控件描边。仅在本查看器移除舞台轮廓，保留返回/左右按钮的键盘焦点和Esc、箭头键路径。预览只负责查看，移除已选计数、选择按钮、空格选片与相应props，保留照片墙的右键选择及多选规则；已有选择在开关查看器时保持。

视觉沿用连续中性深色与克制胶囊控件：头部标题降噪，返回控件细化；底部左右切换和页码合为紧凑深色胶囊，减少对照片的争夺。照片完整contain，不裁切/拉伸，不增加人工光雾或全局样式变更，不改导航、相簿、画册纸张。默认内容可见，关闭直接卸载。

验收覆盖横/竖/方摄影、大图可见与完整构图、无外围框和选择UI、左右点击/键盘边界、Esc与返回、空格不改变选择，以及预览前后照片墙选择保持。宽窄窗检查控件和作品不遮挡。
## 实施与验证

正式源码仅PhotoReview、photo-review.css及LibraryWorkspace调用（删selected/onSelect），照片墙与菜单逻辑保持。舞台局部outline:none、tabIndex=-1，入场焦点/关闭恢复及按钮focus-visible保留。首包原生发现返回按钮被后载.text-button覆盖，提升本查看器选择器优先级后重包，最终32px胶囊生效，未改全局控件。

两项组件事件回归、TypeScript/Vite及Tauri release构建通过。最终资源index-JB0A03y4.css/index-DBR2gzH2.js，通过Avenil重启“Foliune 深色设计验收”。使用65图真实摄影隔离相簿，在宽2640×1760、窄1842×1242物理像素窗口观察横/方/竖图完整contain，舞台无白框，无已选数和选择控件；按钮键盘焦点仅包住目标控件。左右键/点击翻页、首张上一张禁用、Esc及返回、重新单击打开均正常。空格不选择，退出后照片墙仍为浏览；预先右键选中1张再经菜单开查看器，空格/关闭后仍保持1张，未改已有选择。没有修改原图或相簿关系。

证据目录`.build/verification/photo-viewer-polish/`：final-wide、final-focus、final-narrow-landscape、final-narrow-portrait及首包wide-square/portrait，最终源码source-final.json。preview-before.png来自上一轮相同旧包的实际原生预览截图；before.png是本轮开始时照片墙状态，不作预览前对照。

本轮未原生构造缺图、未检验Windows；缺图组件及提示滚动规则保留、仅源审。照片墙/共享PhotoImage/全局index、theme和library样式哈希不变。本轮通过连续深色背景、较小且统一的控件及无外围框的作品展示落实照片优先与质感。

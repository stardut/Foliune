# 胶囊导航与按钮精修

2026-10-31，用户认为短下标导航像网页标签，明确恢复有质感的胶囊导航，可参考CleanMyMac，按钮也要更精致。已认可字体、相簿卡片和背景保持，不接入任何材质试验。

## 方案

参考用户原始截图的紧凑嵌套关系，并查看[CleanMyMac官方产品页](https://macpaw.com/cleanmymac)作完成度参考，不将用户截图身份或实现当作已核实。导航采用深色外槽+浅色选中胶囊，圆角与留边按同心关系统一，浅凹槽与轻浮起选中块形成触感。去掉短下标，未选透明融入槽；current/hover/active/focus/disabled明确，底字即时同步，不依赖过渡。

外槽目标约40px高、内段约34px，不能挤压header或改变内容页版式；原13px/500字体保持。浅选中使用柔和两端面色与细内缘，不回到强金属四段高光。主按钮用小胶囊呼应导航，保留浅面深字和微弱边缘/短阴影；次按钮低调，按下反馈明确，不靠位移。控件上的极轻表面过渡不扩展到页面背景。

仅控件CSS，library/AlbumOverview/native与字体保持；必要时恢复纸张缺图按钮旧样式。原生核验三导航、主次按钮弹窗、键盘焦点、窄窗与已有画册，记录独立源/图审与实际限制。用户对最终精致感的认可不由构建或自评分代替。

## 实现与验证

仅theme/index变动。导航外槽40px（34px内段+上下2px padding+两条1px边）、全圆角、gap2，内段min-width82/padding6px y，13px/500字体保持。选中浅色两端面+深字、细内缘/短阴影；未选透明，current hover/active显式保深字，disabled/focus独立，无background/color过渡。旧marker伪元素完全删除。

主按钮保36px高度，以小胶囊/横16px内距呼应导航，用低幅两端面色/轻内缘/短阴影；次、quiet、danger、disabled规则保持角色，按下无位移。library/books/AlbumOverview/native主配置和review配置hash未变，已认可字体、卡片、背景未改。源冻结在`.build/verification/capsule-controls/source-final.json`。

前端类型/生产构建与macOS release通过，资源`index-z7cT1UOA.css` / `index-BmUDWrcq.js`，Avenil独立验收实例最终PID6036，停留宽窗收藏首页。

主代理实操弹窗打开取消、ShiftTab定位画册导航（AX焦点确认）后Space切换、收藏/作品/画册三态、已有3页画册打开未编辑及保存禁用、窄窗再恢复宽窗。证据`capsule-controls/{final-wide,narrow,dialog,nav-focus,nav-books,nav-work,book}.png`，宽2640×1760，窄1842×1242。胶囊嵌套/留边可见，焦点完整，窄窗未挤压，白纸/字幕保持。

独立源审七项冻结匹配，盒模型40/34成立，marker清除，selected/hover/active/disabled优先级及paper边界确认；最终七图独立审查完成，无确认需修项：嵌套留边紧凑，三导航浅面深字清楚、无marker；focus伸出外槽完整，宽窄header未挤压；主按钮小胶囊与导航呼应，面色低幅无四段金属断层，dialog和书页正常。此为已审范围通过，不替代用户对精致感的最终认可。hover/active真实动态、缺图、长中文、完整动效/实导出、性能与其他平台未新验。最终是否达到用户期待的精致质感以实看反馈为准，不由构建或自评分代替。

# 独立macOS原生材质样机

2026-10-30，用户明确授权独立原生样机，保持当前深色，不加渐变/云雾，重点验证真实壁纸透光，确认效果后再接入应用。本轮不修改apps生产代码、配置或图库。

## 待回答的问题与形态

采用独立AppKit窗口，真实NSVisualEffectView BehindWindow，Dark/Active。样机放在`.build/prototypes/native-material/`，无持久化、无壁纸文件读取、无桌面截图/录屏权限、无私有渲染接口。相比Web原型，此处必须独立native窗口才能验证系统合成，故按用户要求覆盖prototype技能的浏览器路由/变体布局约定；不提交实验代码或接入正式UI。

对照三种机制：A先复现现有Popover+.84参数，随后按原生实际像素校深至.895；B尝试公开NSView Core Image滤镜，只作用背景子树、以非线性压暗代替强均匀遮光；C无滤镜的较薄遮光对照。背景不绘任何图案，控件独立叠加不受滤镜污染。B是验证假设，滤镜参数非nil不等于真实壁纸有效，不能宣称已经做到深度/通透独立控制。

通过条件：与A相近的深度；实际移动窗口或背后内容变化时，真实背景变化比A可辨；没有人工云斑、图案或控件污染。构建、参数日志、单窗口截图只作结构证据；用户实看与运行时变化才是材质依据。B如无效或变浅，如实记失败，不把C的提亮误称成功。

## 实现与运行证据

Objective-C AppKit样机约190行，源码/Info.plist/build.sh/README位于`.build/prototypes/native-material`，构建`sh .build/prototypes/native-material/build.sh`，产物`NativeMaterial.app`，bundle id `app.foliune.native-material-prototype`。Clang构建无警告、plist有效、arm64 Mach-O。通过Avenil注册服务“Foliune 原生材质样机”（`5d51bbb9-6593-43c4-a2f0-c45be1c45e16`），最终PID31955，当前B Gamma4.0。

A最终同色遮光.895，无CI；B遮光.35，公开`NSView.contentFilters`设置新建的`CIGammaAdjust`，Gamma1/2.4/4.0可切换，默认4；C遮光.35，无滤镜。灰色探针属于VFX子树，遮光/正文/按钮/诊断为兄弟层，滤镜不作用正文。所有参数与模式写stdout，可用Avenil logs读取。

主代理实际点击A/C/B、Gamma1/2.4/4，AX状态与stdout对应，未出现残留或控件不可用。取证在`.build/verification/native-material-prototype/`，首轮`A/C/B10/B24/B40.png`，校深后`final-A.png`/`final-B40.png`。同空白区截图RGB：初A(.84)29/30/34，C=B1为102/102/104，B2.4为49/49/51，B4为19/19/21；最终A(.895)21/22/26。以上仅证明该取样处截图明度/恒等对照与Gamma响应，尚不证明真实桌面经过同一滤镜。原生AppKit与WK像素不完全相同，所以A的校深值不直接用于产品。

正式实现的四项源指纹仍与上轮native-popover最终冻结一致，未将样机接入。样机源码冻结、产品未改指纹及取样JSON在同一证据目录。未读取真实照片或数据库。

## 公开API边界

Apple只承诺contentFilters处理view/layer内容；CI滤镜可能将渲染移回进程内，未保证BehindWindow由WindowServer捕获的桌面进入CI。`backgroundFilters`也不是跨窗口读取接口，根layer会忽略它。本轮只用公开contentFilters，不用私有CAFilter。[Apple contentFilters](https://developer.apple.com/documentation/appkit/nsview/contentfilters)、[渲染路径说明](https://developer.apple.com/documentation/appkit/nsview/layerusescoreimagefilters?language=objc)、[backgroundFilters](https://developer.apple.com/documentation/quartzcore/calayer/backgroundfilters?language=objc)。Gamma是公开pow函数，但截图色彩空间使数字不能直接当物理透光率。[Core Image滤镜说明](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Reference/CoreImageFilterReference/index.html)。

独立源审确认公开API、无采集/壁纸文件/持久化/私有selector及前景隔离；最终五张运行图与冻结指纹独立复审通过结构/隔离范围：C与B1近同，Gamma增大使背景逐步压暗，最终A与B4深度接近，前景清楚。灰色探针与平灰背景接近，截图不能独立确认阳性；不能凭这些结论声称真实桌面更通透。已请求用户把样机放到真实壁纸前（避免其他深色窗口挡在背后）比较A/B并拖动。**用户最终实看反馈：“深度合适，但 B 仍像纯色”。因此本轮候选未通过真实壁纸通透验收，不接入正式应用。**

## 实验结论

本次独立样机已回答所测机制的问题：公开NSVisualEffectView + contentFilters/CIGammaAdjust在本机所测参数下，能获得接近产品的深度，但未呈现用户要求的更明显、自然的真实壁纸层次。结构/切换/压暗响应通过，不等于材质目标通过。不把这次失败外推为所有macOS原生实现都不可行，也不能据此认定具体是桌面未进入CI输入、系统散射抹平还是对比被压缩；这些机制尚未被运行时证据区分。

保留样机和证据供复查，正式实现未更改，不扩大到私有渲染接口、桌面采集或壁纸图模拟；停止沿此Gamma参数路线继续试调。后续若继续，需要先建立可直接判断原生背后动态内容是否进入滤镜链的验证，再选择新实现，而非重复调暗。

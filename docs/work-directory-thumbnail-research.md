# 作品目录同步：缩略图性能研究

2026-11-05 初始调研。优先优化 JPEG 解码和缩小尺寸。**libjpeg-turbo 缩放解码是本机组件诊断中最快的候选。** Image I/O 直接生成缩略图在同一批样本上没有胜过同一框架的全图解码后缩放。若希望保留当前解码行为，还可单独测 Rust SIMD 缩放。EXIF 内嵌小图不适合作为正式缩略图的捷径。

2026-11-06，macOS 作品目录 JPEG 已接入 Image I/O 全图解码后缩放，保留原件校验和相簿提交边界。相同 75 张照片的原生 release 对照中，确认到末本提交中位数从 8.80 秒降至 6.45 秒。见[桌面验收](desktop-verification.md#2026-11-06-作品目录-jpeg-同步)及[原生计时明细](../.build/verification/work-directory-imageio-ab/results.md)。

## 实测瓶颈与现有契约

[原生 release 基线](../.build/verification/work-directory-perf/results.md)：M1 Pro、macOS 15.0.1、内置 APFS SSD。75 份文件来自竖幅 2000×3011、全景 3920×1776、横幅 4912×3264 三张真实 JPEG，三本新相簿各自提交。同步线程共用时 **10,071.5 ms**，其中完整 JPEG 解码 4,941.2 ms（49.06%）、Triangle 缩放 3,318.7 ms（32.95%），两项合计 **82.01%**；两次 SHA-256 共 754.2 ms（7.49%）。因此，单改缩放就算把该阶段耗时降为零，也最多省下这批约 3.32 秒；移除校验或把任务并发不是首选。这个基线不含发现、确认、排队和前端渲染，也不代表冷盘或不同格式。

[当前解码与缩略图代码](../apps/desktop/src-tauri/src/photos.rs#L71)分别检查支持的扩展名和识别后的格式，允许 JPEG、PNG、WebP。完整解码后按主图 EXIF 方向旋转或镜像，最长边缩到不超过 960 px，不裁切或放大小图；有透明像素时铺白底，再输出 JPEG。当前 `image 0.25.2` 默认 [JPEG 质量 75](https://github.com/image-rs/image/blob/v0.25.2/src/codecs/jpeg/encoder.rs#L351-L360)。图库保存的是**旋正后的原图宽高**，不能用缩略图宽高替代；拍摄时间和 GPS 沿用当前 EXIF 读取规则。

[当前同步准备流程](../apps/desktop/src-tauri/src/work_directory/sync.rs#L274)从经校验的只读句柄读取，解码前后核对 SHA-256 和文件状态；整本相簿准备完成后再次打开目录并核对源文件，缩略图经暂存，索引和任务按相簿提交。缩略图后端应处理从这同一个句柄读取的内容，例如有界压缩字节缓冲区或数据提供者；诊断用的路径 URL 不能直接替代产品的受检句柄。文件身份、内容指纹和解码完整性是三个不同问题：前两项可以发现替换或写入变化，不能证明静止的文件本来就完好。[工程边界](architecture.md#作品目录与外部原件)

## 候选路径

| 路径 | 能省下什么 | 代价与适用范围 |
| --- | --- | --- |
| macOS Image I/O | `CGImageSourceCreateThumbnailAtIndex` 直接请求目标尺寸，避免应用显式保留整张 RGB 位图；也可用 `CGImageSourceCreateImageAtIndex` 加系统缩放作对照。 | Apple 框架，不适用于 Windows。直接缩图与全图缩放都要验画质和坏图行为；本机未观察到直接缩图更快。 |
| libjpeg-turbo | 缩放 IDCT 直接输出较小的像素缓冲；从库支持的倍率中选**满足目标尺寸的最小倍率**，再等比缩到 960。对于 3011、3920、4912 长边，这一选择分别是 3/8、1/4、1/4。 | JPEG 专用；原生依赖需要打包和验证 Windows，ICC 转换、EXIF 方向和最终缩放还要单独处理。渐进 JPEG 仍需处理多扫与中间系数缓冲；不能把像素面积缩小比例直接当作耗时或峰值内存节省。无损 JPEG 不走 IDCT 缩放。 |
| 纯 Rust `jpeg-decoder` | `Decoder::scale` 支持 1/8、1/4、1/2、1，输出后再精缩。 | 倍率较粗，且是换解码器；须核对兼容性、错误接受范围和平台性能。没有 Foliune 实测。 |
| 现有 Rust 解码 + SIMD 缩放 | `fast_image_resize` 有 ARM NEON、x86 SSE4.1/AVX2 实现，可以先单测缩放，保留现有格式、解码行为和发布流程。 | 仍要全尺寸解码和分配像素；滤波、舍入、透明边缘和色彩不能假定相同。属于依赖较轻的对照路线。 |
| 直接使用 EXIF 内嵌图 | 只需解码较小图像，或可直接复制某些 JPEG 内嵌数据。 | Exif 缩略图可缺失，有独立数据、尺寸和方向；规范不保证能达到 960 px。它可与主图构图或编辑状态不一致，也可在主图损坏时仍正常。两图即使宽高比一致也不能证明内容一致，故不作为正式缓存或同步通过依据。 |

依据：[Apple 降采样说明](https://developer.apple.com/videos/play/wwdc2018/416/)、[TurboJPEG 3.1.2 API](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.2/src/turbojpeg.h)、[libjpeg 多扫与内存说明](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.2/doc/libjpeg.txt)、[jpeg-decoder 的缩放 API](https://docs.rs/jpeg-decoder/0.3.2/jpeg_decoder/struct.Decoder.html#method.scale)、[fast_image_resize SIMD 文档](https://docs.rs/fast_image_resize/latest/fast_image_resize/)、[CIPA Exif 缩略图文件结构](https://www.cipa.jp/std/documents/e/DC-008-2010_E.pdf)。

Foliune 锁定的 [image JPEG 适配器](https://github.com/image-rs/image/blob/v0.25.2/src/codecs/jpeg/decoder.rs)与 [zune-jpeg 0.4.21 实现](https://github.com/etemesi254/zune-image/blob/fa2c767a01d7d9373911d0bf63e0588553d67e0e/crates/zune-jpeg/src/decoder.rs)可读头和 ICC，也能设色彩输出或解码限制，但未暴露缩放解码接口。仅改用 `ImageReader::into_dimensions` 或改成直接调用当前 zune，只解决读尺寸的开销，随后生成缩略图仍需解码；加快缩放也不会移除原图像素缓冲。若以后选 Windows 系统后端，[Microsoft WIC 原生 JPEG 缩放](https://learn.microsoft.com/en-us/windows/win32/api/wincodec/nf-wincodec-iwicbitmapsourcetransform-getclosestsize)有 1/2、1/4、1/8，可作为对照；PNG 在该接口没有原生缩放，Windows 未实测。

### Image I/O 的参数与边界

- 源读取时可设置 `kCGImageSourceShouldCache=false`；缩略图用 `CreateThumbnailFromImageAlways=true` 明确从主图生成，即使存在内嵌图也不用它。指定 `ThumbnailMaxPixelSize=960`，开启 `CreateThumbnailWithTransform` 应用图像方向和像素宽高比。不要再按 EXIF 重复旋转；另从图像属性或格式头记录原图尺寸，方向 5–8 对调宽高。诊断向缩略图请求传入了 `ShouldCacheImmediately=true`，Apple 的该键文档具体列的是读属性和原图 API，因此计时覆盖到真实渲染和编码，不能把函数返回当作像素已经物化的证明。[Image I/O 源与选项](https://developer.apple.com/documentation/imageio/cgimagesource?language=ob_2)、[缩略图示例](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/ImageIOGuide/imageio_source/ikpg_source.html)、[解码时机](https://developer.apple.com/documentation/imageio/kcgimagesourceshouldcacheimmediately?language=objc)
- Apple 的 `SubsampleFactor` 允许 2、4、8，支持 JPEG、HEIF、TIFF、PNG；指定倍率不可用时可能返回较大甚至原尺寸图。它不能替代最终尺寸检查，也不据此扩大现有格式范围。尤其不能把 JPEG 的速度推广到透明 PNG 或 WebP。[SubsampleFactor](https://developer.apple.com/documentation/imageio/kcgimagesourcesubsamplefactor?language=objc)
- 维持 JPEG 缓存，输出像素已经旋正，不复制旧方向、GPS 或 EXIF 小图。对带 ICC 的图片，应明确约定将源色彩转换到带标签的目标色彩空间，或保留并正确携带源配置；本机计时用 Core Graphics 绘制到 sRGB 位图再编码。不能只给原样 RGB 字节重新贴 sRGB 标签，尤其是 Display P3、Adobe RGB 和 CMYK/YCCK。编码时检查 `CGImageDestinationFinalize` 返回值；系统编码的 `0.75` 与 Rust 的 `75` 只是各自参数，不代表相同量化、文件大小或画质。透明格式仍须保持白底，验证半透明边缘。[Quartz 色彩空间](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/drawingwithquartz2d/dq_color/dq_color.html)、[Quartz 位图](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/drawingwithquartz2d/dq_images/dq_images.html)、[Image I/O JPEG 质量](https://developer.apple.com/documentation/imageio/kcgimagedestinationlossycompressionquality?changes=_8)、[写入完成条件](https://developer.apple.com/documentation/imageio/cgimagedestinationfinalize%28_%3A%29?changes=_11)

## 本机诊断

同一台 Mac、同一批 75 个文件，用优化编译的独立诊断程序，每条路径跑 5 批并取中位数。Image I/O 直接缩略图与全图解码两条路径交替先后，均渲染到最终尺寸的 sRGB 位图再在内存编码 JPEG；另测直缩时按长边显式选择 2、4 或 8 的降采样因子。TurboJPEG 3.1.2 用缩放 IDCT，读取压缩字节、以 RGBX 解码并按 sRGB 解释，最后走相同的 Core Graphics 缩放和 JPEG 编码。三张原样均无 ICC 和方向标签；TurboJPEG 与 Image I/O 分开运行，TurboJPEG 路径没有做源 ICC 转换，也未开启遇警告即停。下表是**组件诊断**，不含生产指纹检查、EXIF 业务解析、写盘暂存、相簿事务或界面，不是 Foliune 同步耗时。

| 路径 | 解码、缩放及输出位图中位数 | 75 张组件总耗时中位数 | 总耗时范围 |
| --- | ---: | ---: | ---: |
| Image I/O 直接缩略图 | 4,757.4 ms | 5,014.5 ms | 4,984.4–5,329.0 ms |
| Image I/O 直接缩略图，加显式降采样 | 4,756.8 ms | 5,005.4 ms | 4,959.3–5,030.4 ms |
| Image I/O 全图解码后缩放 | 4,554.5 ms | 4,821.6 ms | 4,797.5–4,858.2 ms |
| libjpeg-turbo 缩放解码 | 4,098.8 ms | 4,339.1 ms | 4,313.8–4,392.1 ms |

同一框架下，直接缩略图比全图解码后缩放慢约 4.0%；显式降采样也没有反转这个结果。本次没有测峰值内存。TurboJPEG 在此组诊断中耗时较低，足够支持优先做同等条件的产品原型；还不能据此推断上线能省多少。原生基线的图像阶段（解码、缩放、像素转换、编码写入）约 8.95 秒，组件诊断与它的计时边界、缩放和色彩实现不同，只能看数量级。原始证据：[Image I/O 源码](../.build/verification/work-directory-thumbnail-research/probe.m)、[Image I/O 结果](../.build/verification/work-directory-thumbnail-research/imageio.json)、[显式降采样源码](../.build/verification/work-directory-thumbnail-research/probe-imageio-subsample.m)、[显式降采样结果](../.build/verification/work-directory-thumbnail-research/imageio-subsample.json)、[TurboJPEG 源码](../.build/verification/work-directory-thumbnail-research/probe-turbo.m)、[TurboJPEG 结果](../.build/verification/work-directory-thumbnail-research/turbojpeg.json)。

方向诊断将同一竖幅分别写入 1–8 的 EXIF 方向：1–4 输出 638×960，5–8 输出 960×638。该证据只验证尺寸和轴交换，没有检查 2、4、5、7 的镜像像素是否正确，也未覆盖无方向、小原件或带 ICC 的真实照片。

### 渐进与损坏 JPEG

把真实竖幅副本重编为基线与渐进 JPEG，分别生成缺少 EOI、截断一半、截断一半后补 EOI；渐进 JPEG 另加「保留首个完整扫描，接 EOI」。Image I/O 使用上文缩略图选项并实际编码输出；Rust 探针使用当前锁定的 `image 0.25.2 / zune-jpeg 0.4.21`；libjpeg-turbo 3.1.2 用 `djpeg -strict -scale 3/8`。

| 输入 | Image I/O | 当前 Rust 解码 | libjpeg-turbo 严格模式 |
| --- | --- | --- | --- |
| 完整基线、完整渐进 | 通过 | 通过 | 通过 |
| 缺 EOI（各 1 份） | 通过 | 通过 | 拒绝 |
| 截断一半（各 1 份） | 通过 | 通过 | 拒绝 |
| 扫描内截断一半后补 EOI（各 1 份） | 通过 | 通过 | 拒绝 |
| 保留首个完整渐进扫描，接 EOI | 通过 | 通过 | 通过 |

Image I/O 九份均返回 638×960，实际写入内存 JPEG 成功，前后的源状态和第 0 帧状态都返回 `Complete`；当前 Rust 对九份都返回 2000×3011。原竖幅直接截断的另一组探针也显示，状态为 `Complete` 时，缩略图可能成功，也可能返回空。Apple 的[状态枚举](https://developer.apple.com/documentation/imageio/cgimagesourcestatus?changes=_5&language=objc)描述操作状态；这里的 `Complete` 不代表严格主图校验。当前 Rust 适配器设置 `strict_mode(false)`，全尺寸解码也不能据此宣称阻断所有损坏。libjpeg-turbo 能用 `TJPARAM_STOPONWARNING` 拦截底层警告，并可配置渐进扫描数和中间内存上限，但无法仅凭一份文件判断完整首扫之后是否本应有更多细节。[TurboJPEG 参数](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.2/src/turbojpeg.h)、[djpeg 严格模式](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.1.2/doc/usage.txt)

这批反例表明，成功产出小图、完整尺寸、`Complete` 或找到 EOI，都不能单独作为原件可用性的门禁。基线兼容范围和是否更严格拒绝坏 JPEG，应在接入时作为可核对的产品行为单独处理；不要再跑一遍现有整图解码当作严格门禁。证据：[样本生成](../.build/verification/work-directory-thumbnail-research/jpeg-integrity/make-fixtures.py)、[Image I/O 探针](../.build/verification/work-directory-thumbnail-research/jpeg-integrity/probe.c)、[Image I/O 状态表](../.build/verification/work-directory-thumbnail-research/jpeg-integrity/imageio.tsv)、[Rust 状态表](../.build/verification/work-directory-thumbnail-research/jpeg-integrity/rust.tsv)、[libjpeg-turbo 状态表](../.build/verification/work-directory-thumbnail-research/jpeg-integrity/libjpeg-turbo.tsv)。

## 下一步验证

1. 在工作目录准备阶段做 JPEG 局部原型，保留受检文件句柄、原图宽高和元数据、两次指纹、再次打开校验、暂存和每相簿原子提交。PNG/WebP、普通手动导入和替换原件继续使用现有路径，不在 JPEG 解码失败后静默改走更宽松的解码器。候选的格式检查、源图尺寸与解码资源限制应明确对齐现有行为。
2. 先做一轮同条件对照：同一批独立样本、同一文件输入、同一 JPEG 输出编码器与明确的色彩策略，量解码、最终缩放、编码、整体同步及峰值内存。分别测温缓存与物理硬盘，保留原 75 张作回归，再补不同的摄影原件、较小 JPEG、真实渐进、灰度、广色域和 CMYK/YCCK，避免把三个样本的重复数据当作总体收益。只有在同条件下确实有收益且分发成本合适时，才确定接入哪条路径。
3. 验证方向 1–8 的像素角标，尤其是镜像；核对极端长宽比、小图不放大、照片完整构图、透明边缘、ICC、原图与缩略图切换、画册与离线占位。用 960 px 现有输出作画质参考，在原生 WebView 比较细节、色偏、肤色、高对比边缘和 JPEG 体积，不能只核对尺寸。坏图、同步时原件被替换、相簿失败重试、清理暂存及原件字节完整性也需要回归。

本轮只有调研和隔离诊断，没有修改产品代码、界面或图库。对「高级」与「设计感和质感」的直接要求是保留完整构图、可靠方向、可信色彩和离线浏览质量；仅有尺寸及组件计时证据，真实产品界面、接入后的 release 同步、Windows、冷盘与正式分发均未验收。

# 工程边界

## 当前桌面路线

当前使用 `apps/desktop` 的 Tauri 2 宿主与 React 19 界面，TypeScript 定义前后端共享的数据契约，Vite、Tailwind CSS 4 和 Motion 负责界面开发。
旧 `apps/macos` SwiftUI 工程保留归档，不参与本路线的构建。没有新增移动端工程。
Tauri 的结构具备跨桌面平台扩展条件，但当前仅验证 macOS，Windows 构建和系统集成仍需目标环境验收。

## 模块职责

- `src/lib/types.ts`：照片、分组、成员关系及操作输入。
- `src/lib/api.ts`：Tauri IPC、系统文件选择、受限 asset URL 转换。非桌面环境明确报错。
- `src/features`、`src/components`：界面及交互，不直接读写数据库或文件系统。
- `src-tauri/src/db.rs`：SQLite 建表、快照读取和持久连接。
- `src-tauri/src/photos.rs`：格式验证、解码、EXIF、管理副本、缩略图和照片信息。
- `src-tauri/src/groups.rs`：分组 CRUD、容量检查及成员关系。
- `src-tauri/src/curation.rs`：导入、加入、恢复和降上限的候选会话与原子确认。
- `src-tauri/src/books.rs`、`book_layout.rs`、`book_export.rs`：独立画册文档、版本、排版和 HTML 导出。
- `src-tauri/src/ai.rs`、`credentials.rs`：官方 API 请求、结果存储、系统凭据。
- `src-tauri/src/backup.rs`、`libraries.rs`：一致性备份、校验恢复与显式切库。
- `src-tauri/src/music.rs`：只供当前欣赏会话的管理音频缓存。
- `src-tauri/src/model_profiles.rs`：当前图库的模特档案、有序样片引用及每份档案的可选标签目录，事务校验并保存；删除只解除本模块关系。`tag_options` 为可空JSON列，旧记录null由编辑器采用初始目录，显式空数组保留全部删除结果；启动及备份恢复的init在旧表缺列时增加该列，不清旧数据。
- `src-tauri/src/social.rs`：保留首版历史排版数据的结构与恢复校验。当前模拟界面不再调用草稿接口，本轮不破坏性删除旧数据。
- `src-tauri/src/content_refs.rs`：上述两个模块共用的文案、时间戳和稳定照片引用校验，不承担图库导入与画册排版。
- `src/lib/model-types.ts`、`model-api.ts`：模特档案的类型与 IPC；`social-types.ts` 只定义临时预览输入。`src/features/models`、`src/features/social` 负责界面，`src/components/PhotoPicker.tsx` 提供共用选片对话框；模拟排版仅使用组件内存，不读写草稿或浏览器存储。
- `src-tauri/src/lib.rs`：宿主初始化与 IPC 入口。

Tauri 文件对话框只允许选择公开支持的 JPEG、PNG、WebP。导入端再次按文件内容解码验证，不仅相信扩展名。
asset protocol 仅开放应用数据目录的原件、缩略图、候选图和音频缓存；恢复图库同样只开放对应的图像子目录，不开放数据库、配置或整个用户目录。
照片解码和批量导入使用后台任务，避免占用 WebView 的界面线程。

## 数据规则

SQLite 文件和管理副本位于 Tauri `app_data_dir`，不写入源码目录。
照片使用持久 UUID；分组与照片之间的成员记录有独立的 `active` / `discarded` 状态和排序位置。
同一照片可进入同图库的多个分组。废弃、恢复只修改指定关系。分组容量计算有效成员，恢复和批量加入都要检查容量。
SQLite 外键确保分组删除只级联删除成员关系，保留照片与原件。

批量导入返回成功 ID 与逐项失败原因；每个文件解码、复制、缩略图完成后在事务中建立照片和可选成员记录。
单项失败回滚该项数据库并清理本次副本，不更改来源文件。数据库错误不回退为空库。
取舍使用独立候选暂存与确认接口。候选新照片只进入该会话的暂存目录；确认时校验保留集合、容量与原分组签名，防止跨会话伪造及并发修改。取消与失败只清理该会话明确持有的目录，未选的新图不进入正式库。批量废弃与恢复也在一个事务中校验并更新，避免部分成功。

## 画册与图库

画册持有独立选片、章节、页面布局与版本，不受分组成员废弃影响。重排增加自动版本，不覆盖手工版本；原照片重新定位保持 ID，所有画册引用会采用替换文件，因此必须明确确认替换。
`Store.root` 是应用根目录，当前图库路径从持久连接取。切换图库先验证并读取候选连接，再取消待确认会话、持久选择并替换受 Mutex 保护的连接，不使用 Tauri 的不安全 unmanage。
恢复库位于 `libraries/<UUID>`；导入和重新定位始终使用当前连接所属目录。

## AI 与凭据

照片分析只由显式用户操作触发，发送已旋正的 960px JPEG 预览，不上传原件、音乐或整个图库。OpenAI Responses 使用 input_image，Claude Messages 使用 base64 image，DeepSeek Chat Completions 使用 image_url。
固定官方端点，不接收任意 URL；请求禁止重定向，连接超时 15 秒、总超时 90 秒，响应限制 4 MiB。HTTP 错误只返回状态与操作提示，不回显可能包含 Key 的提供方错误正文。
系统凭据库以 `app.foliune.desktop.ai` 服务名保存 Key；SQLite 只存模型及图像能力开关。分析结果在 photo_analyses 独立表中，不覆盖人工字段。请求前记录图库和图片修订，完成后若发生切库或替换图片则拒绝把旧结果写到新内容上。

2026-10-29 核验的官方来源：

- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses)
- [Claude Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)
- [DeepSeek 模型能力字段](https://api-docs.deepseek.com/api/list-models/)

默认模型仅为可编辑的起点。未知模型由用户明确设置图像能力；未启用时图像分析报错，不静默改用文本结果。

## 备份与恢复

使用 SQLite backup API 取得一致性快照，和引用的原件、缩略图一起写入 ZIP，附 SHA-256 和大小清单。不包含系统 Key、音频缓存、未确认会话、库选择文件和旧的未引用图片修订。
恢复只接受白名单相对路径，拒绝重复条目、链接、目录穿越、额外文件及校验失败。SQLite 数据库再做完整性、外键、画册布局与图像解码检查，并将原平台绝对图像路径重写为新库路径；文件名提取同时识别 Windows 与 Unix 分隔符。
全部校验在独立 `.restoring-<UUID>` 目录完成，成功后重命名为新图库，失败清理该目录，现库不被覆盖。用户显式切换新库后，前端刷新选片、画册与 AI 结果。

暂不提供物理删除照片原件、云端同步或跨设备帐号。系统异常终止可能遗留暂存/缓存；正常取消、失败与退出负责清理明确持有的文件，不扫描删除无关文件。

模特资料存入当前图库数据库，图片引用 `photos.id`，因此随数据库快照及现有图像文件一起备份；切库后重建对应工作区，不沿用旧库编辑状态。历史排版数据仍随旧库快照保留和校验，当前模拟不新增或更新它们。恢复时检查内容、照片引用及顺序，不因补建表掩盖残缺结构；旧备份不含新模块时补建空表。

## 拼图界面与输出契约

`src/features/collage/collage-layout.ts` 负责有序行分割、网格与长图几何、来源有效像素密度、统一整数矩形、输出尺寸校验、锁比例输出缩放和撤销历史；布局不读写数据库。2400宽参考几何仅用于预览及设计控件，默认成片按所有照片所需倍率的最大值保留来源像素，cover包含zoom后的取景密度；整数化留出边界取整余量。单边32768、总像素160MP的限制只拒绝不支持的输出，不偷偷缩小布局；保存对话框允许用户显式调整并恢复原图尺寸。`CollageWorkspace` 组织内存编辑和生成/候选取舍，`CollagePreview` 用原件及同一矩形/crop语义渲染，`CollageSequence`、`CollageTools`、`CollageSaveDialog` 分别承担选片、工具与保存。预览的contain始终完整居中，cover按max(cell/source)×zoom缩放，offset 0–1定位溢出空间，与Rust合成契约一致。前端不使用Canvas截屏作为成片源。Rust逐张读取管理原件，在RGB画布上按alpha与背景合成并直接编码PNG，同尺寸原图或裁片跳过重采样；避免同时保留整幅RGBA画布及RGB转换副本。输出与来源像素上限均为160MP，原件仍服从现有解码器的格式及内存限制；错误明确返回，不降采样重试。

`src/lib/collage-types.ts`、`collage-api.ts` 定义并调用 `prepare_collage`；结果为现有 `CurationDraft`，通过已有commit/cancel原子确认及清理。提交失败后候选会话已消费，工作台保留编辑并重新prepare重试。工作台经 `LibraryWorkspace` 向App上报dirty/busy，复用现有导航与关闭保护；相簿滚动、选择及来源上下文保留在父工作区，不持久化拼图草稿。保存成功后父工作区只显示右上角单条临时反馈，不再维护成片查看、目标页码或查看后定位状态；反馈约3秒直接卸载，再保存重置计时，进入编辑、离开相簿或卸载时清理。原件修订通过预览节点key重新读取，读取失败明确显示；生成失败显示实际后端错误并保留编辑。


## 拍摄策划

`src-tauri/src/planning.rs` 负责当前图库策划的层级文档、CRUD、事务与引用校验。`shoot_plans.document_json` 保存版本化v2全案、Part、目标画面和逐图参考意图；同一照片可以多处引用，结构节点具有稳定独立ID。`shoot_plan_photos` 保存按全案/Part/画面顺序首次出现的照片ID并集，供外键及备份引用保护；加载和恢复严格核对其与文档一致，不把错配当成空参考。

旧schema没有document_json列时，在一次事务中增加列并迁移全部v1记录；已存在该列的库不得因NULL、坏JSON或未知版本重建内容。旧造型、光线、镜头清单归入「原拍摄安排」Part，备注归入执行准备，旧有序图片归入全案参考；保留策划ID和时间，不猜画面关系。新保存清空废弃旧内容列，不从旧字段复活已删内容。恢复旧备份采用同一迁移与validate_all，部分结构或损坏文档明确拒绝。删除只解除本模块关系，不删原件。

`planning_export.rs` 验证PNG内容、大小及像素限制，同目录临时文件写入后替换目标，失败清理临时文件并保留原目标。`src/lib/planning-types.ts`、`planning-api.ts` 定义层级数据契约、限额、IPC与系统保存对话框；`src/features/planning` 组织列表、阅读、编辑和长图。持久化仍完整保留全案/Part/画面的参考绑定和顺序；当前UI与导出仅展示Part场景图片及相邻意图，全案与镜头旧引用不删除、不迁移，非空意图转为相应区域内的纯文字参考要点。Canvas按原图与文本测量渲染，不截应用DOM；缺图和超限拒绝整个导出，不静默漏项。工作区沿用App dirty/busy导航和关窗保护，切库重新挂载，切库操作本身阻止导航。

场景（内部Part）的历史`shotList`自由文本继续保留在持久化契约和`inputOf`编辑副本中，参与含内容删除保护及原有备份；前端不提供填写入口，不参与阅读、搜索和PNG导出。镜头清单仅以`shots`结构化条目呈现；空`shots`显示“暂无镜头”，不因旧`shotList`非空隐藏空态。已知旧v2缺字段时serde默认空串；v1旧shot_list直接迁入该字段，不猜已有v2description内容。每场景3张参考仅在新保存时校验；list/validate_all及备份恢复保留历史合法超限引用，完整结构校验和有序照片并集约束不弱化。前端选择器限制新选3张，不slice旧图。

场景新增`focalLength`自由文本，Rust serde缺省空串并参与校验，前端新建、输入归一化、搜索及PNG通过场景字段表贯通；不引入焦段枚举或额外存储层。全案新增`styling`/`props`/`equipment`三项固定准备，通过`sharedFields`统一前端标签、输入归一化、搜索与导出；Rust三字段分别serde(default)，v1全案补空，不提升或拆分旧`part.styling`；旧引用并集与SQL废弃列清空规则不变。场景既有`timeWindow`在界面与PNG统一称为“拍摄时段”，置于场景标题区，页面和PNG参数区不重复，长文本完整换行；复用原有数据、限额和搜索链路，不新增字段或推导时间。界面按独立场景卡片组织：标题要点、显式“参考图”“拍摄参数”“镜头清单”三区，上区图与参数并排、下区全宽纯文字清单；参数统一单列对齐；镜头在固定阅读列内按名称/优先级、主拍法、单列标签详情、旧参考要点纵向组织；所有已填拍法直接可见，不使用details/summary。PNG内容模型显式表达章节起止、场景标题与时段、分区及标签字段；先测量图文与章节，再绘制连续白纸、场景前浅细线与内容，不根据文案推断结构，不绘制卡片背板或轮廓。全案整组准备前置且只出现一次，每场景按标题要点、参考图、拍摄参数、文字清单垂直组织，不输出全案及镜头图片。导出参考图最多两列，第三张及历史超限图片保持半列宽续行；按独立单元格测量、逐张解码绘制，文字与各自图列相邻，几何和照片比例保持一致。

当前内容精简见[策划内容精简](planning-content-cleanup.md)，页面方案与验收见[场景卡片与整组准备](planning-scene-cards.md)，长图见[连续纸张导出](planning-paper-export.md)，[紧凑场景阅读](planning-reading-compact.md)保留上一轮记录，[场景拍摄板](planning-scene-board.md)保留上一轮记录，[场景与镜头清单](planning-scenes.md)保留上一轮记录，[Part改版](planning-parts.md)及[首版](planning.md)保留历史证据。

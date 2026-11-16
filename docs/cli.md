# Foliune CLI

CLI 读写桌面应用使用的本地图库。命令按对象和动作组织，既可在终端使用，也可由 Agent 调用。首次使用前，通过 Foliune 打开图库一次。图库已初始化后，CLI 可以独立运行。

## 安装与运行

在 macOS 上把 `Foliune.app` 拖到「应用程序」。打开 Foliune 后，在「让 AI 助手帮你整理图库」提示里点击「安装命令行工具」。也可以选「暂不安装」，稍后从「设置 → 命令行工具」安装。需要写入权限时，macOS 会请求管理员授权。安装会创建 `/usr/local/bin/foliune-cli`，指向应用包里的 CLI。应用内更新会替换同一路径下的应用包，已有链接会直接使用新版 CLI。

安装后，可以把设置里的示例复制给支持调用终端的 AI 助手。

> 用 foliune-cli 找出标了『窗光』的照片，加入一个新相簿。

在包含 `/usr/local/bin` 的终端或 Agent 环境中运行：

```sh
foliune-cli --help
```

也可以直接运行应用包中的 CLI。若把 Foliune 放在其他目录，请替换下方路径。

```sh
/Applications/Foliune.app/Contents/MacOS/foliune-cli --help
```

从源码构建时，使用 `cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --bin foliune-cli`。`--library <DIR>` 指定隔离的应用数据目录，适合验收和脚本测试。

## 命令

| 对象 | 查询 | 编辑 |
| --- | --- | --- |
| `plan` | `search <关键词>`、`show <id>` | `create`、`update <id>`、`delete <id>` |
| `photo` | `search <关键词>`、`show <id>`、`preview <id> --output <path>` | `update <id>` |
| `album` | `list`、`show <id>` | `create`、`update <id>`、`delete <id>`、`add/discard/restore <id> <photo-id>…` |
| `book` | `search <关键词>`、`show <id>` | `create`、`update <id>`、`delete <id>` |
| `model` | `search <关键词>`、`show <id>` | `create`、`update <id>`、`delete <id>` |

- `--json` 将成功结果输出到 stdout，将结构化错误输出到 stderr。失败退出码为 `1`，参数错误为 `2`。参数详情可通过 `foliune-cli <对象> <动作> --help` 查看。
- `search` 与 `list` 返回 `items`、`total`、`limit` 和 `offset`。空关键词匹配全部。`--limit` 默认 50，可设为 1 到 500。照片搜索支持 `--kind collection|work` 和 `--album <id>`，相簿列表支持 `--kind`。按相簿搜照片时读取有效成员，`album show` 可查看废弃成员。
- `create` 和 `update` 通过 `--file <path>` 读取 JSON，`--file -` 从 stdin 读取。省略的字段保留当前值。可空字段用 `null` 清除。列表按提交顺序替换。策划的场景和镜头按稳定 ID 保留条目内未提交的字段。
- 策划、画册和模特档案的 `update` 和 `delete` 须带上 `show` 返回的 `--revision <revision>`。收到 `REVISION_CONFLICT` 后，重新读取并核对需要修改的字段。
- `photo preview` 将图库现有缩略图以 JPEG 格式写入新文件，即使原片暂时离线也可读取已有预览。目标文件已存在时会报错。作品目录原片需要重新核验时，`photo show` 的 `originalAvailable` 为 `null`。

## 策划参考图

在桌面端打开策划，进入编辑，在「参考图」里批量选图后保存。`plan show` 的 `references` 数组按保存顺序给出整案参考图，每项包含条目 `id`、`photoId` 和 `intent`。场景参考仍位于 `parts[].references`。保存策划仍需有效的执行日期。

```sh
foliune-cli plan search '窗边人像' --json
foliune-cli plan show "$plan_id" --json
foliune-cli photo preview "$photo_id" --output ./reference.jpg --json
printf '%s\n' '{"visualDirection":"用窗边侧光，保留背景暗部。"}' |
  foliune-cli plan update "$plan_id" --file - --revision "$revision" --json
```

创建的最小 JSON 可用 `{"title":"窗边人像","executionDate":"2026-11-20"}`。更新场景时提交完整的场景 ID 列表。对已有场景，只提供 `id` 和要改的字段即可。新建的场景、镜头、参考条目应提供各自唯一的 ID。参考图用现有照片 ID，镜头优先级为 `normal`、`must` 或 `try`。

## 其他编辑输入

- **照片**支持 `title`、`tags`、`annotation`、`source`、`location`、`project`、`capturedAt`。清空拍摄时间可传 `{"capturedAt":null}`。
- **相簿**新建用 `{"library":"collection","name":"窗边","capacity":50}`，还可提交 `description`。封面通过 `update` 提交 `{"cover":{"photoId":"…","offsetX":0.5,"offsetY":0.5,"zoom":1.0}}`。当新容量小于当前有效照片数时，更新可同时提供 `discardPhotoIds`，明确哪些成员要废弃。两项变更一起提交，照片原件保留。
- **画册**新建使用 `title`、`template`、`pageWidth`、`pageHeight` 和有序 `chapters`。每章包含 `id`、`title`、`photoIds`，模板支持 `white`、`full`、`pair`。`book show` 返回画册摘要与当前版本。更新时提交 `title` 或 `version`，后者可包含 `label`、`template`、`pageWidth`、`pageHeight`、`chapters`、`pages`。更新版面会保存新的内容版本。
- **模特档案**新建至少提供 `name`，编辑字段与 `model show` 中的档案内容对应，包括城市、联系方式、风格标签、有序 `photoIds` 和 `coverPhotoId`。搜索结果仅显示摘要。读取完整档案时请按用户指定的范围处理个人资料。

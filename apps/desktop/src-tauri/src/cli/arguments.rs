use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "foliune-cli", version, about = "查看和编辑 Foliune 本地图库")]
pub(super) struct Arguments {
    /// 将结果和错误输出为 JSON。
    #[arg(long, global = true)]
    pub json: bool,
    /// 应用数据目录。默认使用 Foliune 桌面端的图库。
    #[arg(long, global = true, value_name = "DIR")]
    pub library: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub(super) enum Command {
    /// 拍摄策划。
    #[command(subcommand)]
    Plan(DocumentAction),
    /// 摄影画册。
    #[command(subcommand)]
    Book(DocumentAction),
    /// 模特档案。
    #[command(subcommand)]
    Model(DocumentAction),
    /// 照片和预览。
    #[command(subcommand)]
    Photo(PhotoAction),
    /// 相簿与照片成员关系。
    #[command(subcommand)]
    Album(AlbumAction),
}

#[derive(Args)]
pub(super) struct Page {
    /// 最大返回条数。
    #[arg(long, default_value_t = 50, value_parser = clap::value_parser!(u32).range(1..=500))]
    pub limit: u32,
    /// 跳过的结果条数。
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
}

#[derive(Args)]
pub(super) struct Input {
    /// JSON 文件，或用 - 从标准输入读取。
    #[arg(long, value_name = "PATH")]
    pub file: PathBuf,
}

#[derive(Args)]
pub(super) struct Revision {
    /// show 返回的 revision。
    #[arg(long, value_name = "REVISION")]
    pub revision: String,
}

#[derive(Subcommand)]
pub(super) enum DocumentAction {
    /// 按关键词搜索。
    Search {
        query: String,
        #[command(flatten)]
        page: Page,
    },
    /// 查看完整记录。
    Show { id: String },
    /// 从 JSON 创建记录。
    Create {
        #[command(flatten)]
        input: Input,
    },
    /// 修改 JSON 中给出的字段。
    Update {
        id: String,
        #[command(flatten)]
        input: Input,
        #[command(flatten)]
        revision: Revision,
    },
    /// 按 ID 和修订号删除记录。
    Delete {
        id: String,
        #[command(flatten)]
        revision: Revision,
    },
}

#[derive(Clone, Copy, ValueEnum)]
pub(super) enum Kind {
    Collection,
    Work,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Collection => "collection",
            Self::Work => "work",
        }
    }
}

#[derive(Subcommand)]
pub(super) enum PhotoAction {
    /// 在图库中搜索照片。
    Search {
        query: String,
        #[arg(long)]
        kind: Option<Kind>,
        #[arg(long)]
        album: Option<String>,
        #[command(flatten)]
        page: Page,
    },
    /// 查看照片元数据和相簿关系。
    Show { id: String },
    /// 将图库现有缩略图以 JPEG 格式写入新文件。
    Preview {
        id: String,
        #[arg(long, value_name = "PATH")]
        output: PathBuf,
    },
    /// 修改照片资料。
    Update {
        id: String,
        #[command(flatten)]
        input: Input,
    },
}

#[derive(Args)]
pub(super) struct AlbumPhotos {
    pub id: String,
    #[arg(required = true, value_name = "PHOTO_ID")]
    pub photos: Vec<String>,
}

#[derive(Subcommand)]
pub(super) enum AlbumAction {
    /// 列出相簿。
    List {
        #[arg(long)]
        kind: Option<Kind>,
        #[command(flatten)]
        page: Page,
    },
    /// 查看相簿及按顺序保存的成员。
    Show { id: String },
    /// 从 JSON 创建相簿。
    Create {
        #[command(flatten)]
        input: Input,
    },
    /// 修改相簿资料或封面。
    Update {
        id: String,
        #[command(flatten)]
        input: Input,
    },
    /// 删除相簿。
    Delete { id: String },
    /// 将指定照片加入相簿。
    Add(AlbumPhotos),
    /// 废弃指定照片在当前相簿的成员关系。
    Discard(AlbumPhotos),
    /// 恢复指定照片在当前相簿的成员关系。
    Restore(AlbumPhotos),
}

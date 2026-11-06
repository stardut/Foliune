use super::{
    active, folders, queue,
    source::{
        expected_size, fingerprint, size_matches, stat_signature, BoundAvailability, RootDirectory,
        RootStamp,
    },
    staging, Root, Scan, LOCATOR_PREFIX,
};
use crate::{
    db, groups,
    models::{Group, Membership, Photo},
    photos,
};
use image::GenericImageView;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{self, Seek},
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Candidate {
    pub id: String,
    pub folder_name: String,
    pub album_id: Option<String>,
    pub file_names: Vec<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Decision {
    Sync,
    Ignore,
}

pub(super) fn candidates(
    conn: &Connection,
    root: &Root,
    scan: &Scan,
) -> Result<Vec<Candidate>, String> {
    let known = folders(conn, root)?;
    let mut result = Vec::new();
    for (folder_name, found) in &scan.folders {
        let (album_id, file_names) = match known.get(folder_name) {
            Some((None, _)) => continue,
            Some((album_id, known)) => (
                album_id.clone(),
                found.difference(known).cloned().collect::<Vec<_>>(),
            ),
            None => (None, found.iter().cloned().collect()),
        };
        if file_names.is_empty() {
            continue;
        }
        let identity = serde_json::to_vec(&(&root.id, folder_name, &album_id, &file_names))
            .map_err(|e| e.to_string())?;
        result.push(Candidate {
            id: format!("{:x}", Sha256::digest(identity)),
            folder_name: folder_name.clone(),
            album_id,
            file_names,
        });
    }
    Ok(result)
}

/// The watched directory may have moved. Only matching originals may follow it.
type Signatures = Vec<(String, Option<String>)>;

pub(super) fn verify_relink(
    conn: &Connection,
    root: &Root,
    path: &Path,
) -> Result<Signatures, String> {
    let directory = RootDirectory::open(path).map_err(|_| "所选作品目录不可读取")?;
    let mut stmt = conn
        .prepare(
            "SELECT folder,file_name,sha256,photo_id,stat_signature FROM work_directory_photos WHERE root_id=?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&root.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut existing = false;
    let mut signatures = Vec::new();
    for row in rows {
        let (folder, name, expected, photo_id, signature) = row.map_err(|e| e.to_string())?;
        existing = true;
        match directory.photo(&folder, &name) {
            Ok(mut file) => {
                let before = stat_signature(&file);
                if !size_matches(&file, expected_size(signature.as_deref()))
                    || fingerprint(&mut file)? != expected
                    || before != stat_signature(&file)
                {
                    return Err(format!("目录中的同名原件内容不同：{folder}/{name}"));
                }
                signatures.push((photo_id, before));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(format!("无法安全读取同名原件：{folder}/{name}")),
        }
    }
    if existing && signatures.is_empty() && (!root.authorized || root.path != path) {
        return Err("所选目录没有可核对的作品原件，请选择原目录或其完整副本".into());
    }
    Ok(signatures)
}

pub(super) fn save_signatures(tx: &Transaction<'_>, signatures: Signatures) -> Result<(), String> {
    for (id, signature) in signatures {
        tx.execute(
            "UPDATE work_directory_photos SET stat_signature=?1 WHERE photo_id=?2",
            params![signature, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn validate_batch(
    conn: &Connection,
    root: &Root,
    candidates: &[Candidate],
) -> Result<(), String> {
    if candidates.is_empty() || active(conn)?.as_ref() != Some(root) || !root.authorized {
        return Err("作品目录已变化，请重新查看待同步内容".into());
    }
    let mut folder_names = HashSet::new();
    for candidate in candidates {
        if !folder_names.insert(&candidate.folder_name) {
            return Err("待同步内容重复或无效".into());
        }
        validate_candidate(conn, root, candidate)?;
    }
    Ok(())
}

fn validate_candidate(conn: &Connection, root: &Root, candidate: &Candidate) -> Result<(), String> {
    let album = conn
        .query_row(
            "SELECT album_id FROM work_directory_folders WHERE root_id=?1 AND folder=?2",
            params![root.id, candidate.folder_name],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if album.as_ref().and_then(Option::as_ref) != candidate.album_id.as_ref()
        || matches!(album, Some(None))
        || candidate.file_names.is_empty()
    {
        return Err("待同步内容已变化，请重新查看后确认".into());
    }
    let mut known = conn.prepare_cached(
        "SELECT EXISTS(
           SELECT 1 FROM work_directory_photos WHERE root_id=?1 AND folder=?2 AND file_name=?3
           UNION ALL SELECT 1 FROM work_directory_ignored_files WHERE root_id=?1 AND folder=?2 AND file_name=?3
         )",
    ).map_err(|e| e.to_string())?;
    for name in &candidate.file_names {
        if known
            .query_row(params![root.id, candidate.folder_name, name], |row| {
                row.get::<_, bool>(0)
            })
            .map_err(|e| e.to_string())?
        {
            return Err("待同步内容已变化，请重新查看后确认".into());
        }
    }
    Ok(())
}

pub(super) fn ignore(
    conn: &mut Connection,
    root: &Root,
    candidates: &[Candidate],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    validate_batch(&tx, root, candidates)?;
    for candidate in candidates {
        if candidate.album_id.is_some() {
            for filename in &candidate.file_names {
                tx.execute(
                    "INSERT INTO work_directory_ignored_files(root_id,folder,file_name) VALUES(?1,?2,?3)",
                    params![root.id, candidate.folder_name, filename],
                ).map_err(|e| e.to_string())?;
            }
        } else {
            tx.execute(
                "INSERT INTO work_directory_folders(root_id,folder,album_id) VALUES(?1,?2,NULL)",
                params![root.id, candidate.folder_name],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

pub(super) fn validate_job(
    conn: &Connection,
    root: &Root,
    candidate: &Candidate,
) -> Result<(), String> {
    if active(conn)?.as_ref() != Some(root) || !root.authorized {
        return Err("作品目录已变化，请重新查看待同步内容".into());
    }
    validate_candidate(conn, root, candidate)?;
    if let Some(id) = &candidate.album_id {
        if groups::group_library(conn, id)? != "work" {
            return Err("相簿不属于作品图库".into());
        }
        groups::ensure_capacity(conn, id, candidate.file_names.len())?;
    }
    Ok(())
}

pub(super) struct PreparedAlbum {
    pub identity: Option<RootStamp>,
    photos: Vec<PreparedPhoto>,
    staging: PathBuf,
    published: Vec<PathBuf>,
}

struct PreparedPhoto {
    photo: Photo,
    digest: String,
    signature: Option<String>,
}

enum Thumbnail {
    Decoded(image::DynamicImage),
    #[cfg(target_os = "macos")]
    Jpeg(super::jpeg_macos::PreparedJpeg),
}

impl Thumbnail {
    fn prepare(input: photos::OpenImage) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        if input.reader.format() == Some(image::ImageFormat::Jpeg) {
            let orientation = input.orientation();
            return super::jpeg_macos::prepare(input.reader.into_inner(), orientation)
                .map(Self::Jpeg);
        }
        input.decode().map(Self::Decoded)
    }

    fn save(self, path: &Path) -> Result<(u32, u32), String> {
        match self {
            Self::Decoded(image) => {
                photos::save_thumbnail(&image, path)?;
                Ok(image.dimensions())
            }
            #[cfg(target_os = "macos")]
            Self::Jpeg(jpeg) => {
                jpeg.save(path)?;
                Ok(jpeg.dimensions)
            }
        }
    }
}

impl Drop for PreparedAlbum {
    fn drop(&mut self) {
        // Paths still in `published` have no committed database references.
        for path in &self.published {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir_all(&self.staging);
    }
}

pub(super) fn prepare(
    root: &Root,
    candidate: &Candidate,
    library: &Path,
    expected_root: Option<RootStamp>,
    mut progress: impl FnMut(usize) -> Result<(), String>,
) -> Result<PreparedAlbum, String> {
    let directory = RootDirectory::open(&root.path).map_err(|_| "作品目录当前不可用")?;
    let identity = directory.identity();
    if expected_root.is_some() && identity != expected_root {
        return Err("作品目录已变化，请重新查看待同步内容".into());
    }
    let staging = staging::root(library).join(Uuid::new_v4().to_string());
    fs::create_dir_all(&staging).map_err(|e| format!("无法创建作品目录同步暂存：{e}"))?;
    let mut prepared = PreparedAlbum {
        identity,
        photos: Vec::new(),
        staging,
        published: Vec::new(),
    };
    for (index, name) in candidate.file_names.iter().enumerate() {
        let name_path = Path::new(name);
        let mut file = directory
            .photo(&candidate.folder_name, name)
            .map_err(|e| format!("无法读取作品原件 {}/{name}：{e}", candidate.folder_name))?;
        let signature = stat_signature(&file);
        let digest = fingerprint(&mut file)?;
        file.rewind().map_err(|e| e.to_string())?;
        let copy = file.try_clone().map_err(|e| e.to_string())?;
        let cannot_sync = |e| format!("作品原件 {}/{name} 尚不能同步：{e}", candidate.folder_name);
        let input = photos::inspect_open_image(name_path, copy).map_err(cannot_sync)?;
        let (captured_at, location) = input.metadata();
        let thumbnail = Thumbnail::prepare(input).map_err(cannot_sync)?;
        file.rewind().map_err(|e| e.to_string())?;
        if fingerprint(&mut file)? != digest || signature != stat_signature(&file) {
            return Err(format!(
                "作品原件 {}/{name} 仍在写入，请完成后重试",
                candidate.folder_name
            ));
        }
        let id = Uuid::new_v4().to_string();
        let thumb_name = format!("{id}.jpg");
        let thumb = library.join("thumbnails").join(&thumb_name);
        let (width, height) = thumbnail.save(&prepared.staging.join(thumb_name))?;
        prepared.photos.push(PreparedPhoto {
            photo: Photo {
                original_path: format!("{LOCATOR_PREFIX}{id}"),
                id,
                library: "work".into(),
                title: name_path
                    .file_stem()
                    .and_then(|v| v.to_str())
                    .unwrap_or(name)
                    .into(),
                original_name: name.clone(),
                thumbnail_path: thumb.to_string_lossy().into_owned(),
                original_available: true,
                thumbnail_available: true,
                availability: Some(BoundAvailability::Available),
                width,
                height,
                tags: Vec::new(),
                regions: Vec::new(),
                annotation: String::new(),
                source: String::new(),
                captured_at,
                location,
                project: String::new(),
                imported_at: String::new(),
            },
            digest,
            signature,
        });
        progress(index + 1)?;
    }
    // Re-open by path to catch a disconnected/replaced directory or a file changed
    // while a later photo was decoding. No external filesystem work occurs in commit.
    let current = RootDirectory::open(&root.path).map_err(|_| "作品目录当前不可用")?;
    if current.identity() != identity {
        return Err("作品目录已变化，请重新查看待同步内容".into());
    }
    for prepared in &prepared.photos {
        let name = &prepared.photo.original_name;
        let mut file = current
            .photo(&candidate.folder_name, name)
            .map_err(|e| format!("无法读取作品原件 {}/{name}：{e}", candidate.folder_name))?;
        let unchanged = if let Some(expected) = &prepared.signature {
            stat_signature(&file).as_ref() == Some(expected)
        } else {
            fingerprint(&mut file)? == prepared.digest
        };
        if !unchanged {
            return Err(format!(
                "作品原件 {}/{name} 已变化，请重试",
                candidate.folder_name
            ));
        }
    }
    Ok(prepared)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SyncDelta {
    pub library_id: String,
    pub job_id: String,
    pub created_album: bool,
    pub album: Group,
    pub photos: Vec<Photo>,
    pub memberships: Vec<Membership>,
}

pub(super) fn commit(
    conn: &mut Connection,
    root: &Root,
    candidate: &Candidate,
    album_id: &str,
    job_id: &str,
    library_id: &str,
    prepared: &mut PreparedAlbum,
) -> Result<SyncDelta, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    validate_job(&tx, root, candidate)?;
    let now = chrono::Utc::now().to_rfc3339();
    let created_album = candidate.album_id.is_none();
    if created_album {
        tx.execute(
            "INSERT INTO groups(id,library,name,created_at) VALUES(?1,'work',?2,?3)",
            params![album_id, candidate.folder_name, now],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO work_directory_folders(root_id,folder,album_id) VALUES(?1,?2,?3)",
            params![root.id, candidate.folder_name, album_id],
        )
        .map_err(|e| e.to_string())?;
    }
    let album = db::read_group(&tx, album_id)?;
    let first_position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM memberships WHERE group_id=?1",
            [album_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut memberships = Vec::with_capacity(prepared.photos.len());
    for (index, prepared) in prepared.photos.iter_mut().enumerate() {
        let photo = &mut prepared.photo;
        photo.imported_at.clone_from(&now);
        tx.execute(
            "INSERT INTO photos(id,library,title,original_name,original_path,thumbnail_path,width,height,captured_at,location,imported_at)
             VALUES(?1,'work',?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![photo.id, photo.title, photo.original_name, photo.original_path, photo.thumbnail_path,
                    photo.width, photo.height, photo.captured_at, photo.location, now],
        ).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO work_directory_photos(photo_id,root_id,folder,file_name,sha256,stat_signature) VALUES(?1,?2,?3,?4,?5,?6)",
            params![photo.id, root.id, candidate.folder_name, photo.original_name, prepared.digest, prepared.signature],
        ).map_err(|e| e.to_string())?;
        let position = first_position + index as i64;
        tx.execute(
            "INSERT INTO memberships(group_id,photo_id,status,position) VALUES(?1,?2,'active',?3)",
            params![album_id, photo.id, position],
        )
        .map_err(|e| e.to_string())?;
        memberships.push(Membership {
            group_id: album_id.into(),
            photo_id: photo.id.clone(),
            status: "active".into(),
            position,
        });
    }
    queue::finish(&tx, root, job_id)?;
    let names = prepared
        .photos
        .iter()
        .map(|photo| format!("{}.jpg", photo.photo.id))
        .collect::<Vec<_>>();
    staging::record_publication(&prepared.staging, &names)?;
    for (photo, name) in prepared.photos.iter().zip(names) {
        let path = PathBuf::from(&photo.photo.thumbnail_path);
        fs::rename(prepared.staging.join(name), &path)
            .map_err(|e| format!("无法保存作品缩略图：{e}"))?;
        prepared.published.push(path);
    }
    tx.commit().map_err(|e| e.to_string())?;
    prepared.published.clear();
    let photos = prepared
        .photos
        .drain(..)
        .map(|prepared| prepared.photo)
        .collect();
    Ok(SyncDelta {
        library_id: library_id.into(),
        job_id: job_id.into(),
        created_album,
        album,
        photos,
        memberships,
    })
}

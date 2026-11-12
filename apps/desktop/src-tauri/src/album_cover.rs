use crate::{
    collage::{crop_cover, MAX_SOURCE_PIXELS},
    db::{self, Store},
    models::{AlbumCover, Snapshot},
    photos,
    work_directory::{self, Original},
};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageDecoder};
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, MutexGuard, OnceLock},
};
use tauri::{async_runtime, AppHandle, Manager};

const CACHE_DIRECTORY: &str = "album-covers-v1";
const TARGET: (u32, u32) = (1200, 800);
const MAX_JPEG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_RGB_ICC_BYTES: usize = 512 * 1024;
const CHANGED: &str = "相簿封面或来源已变化";

type Fingerprint = [u8; 32];
// 作品原件使用索引中的内容摘要。其他原件的修订来自已打开文件的状态。
const INDEXED_REVISION: Fingerprint = [0; 32];
static READ_QUEUE: OnceLock<Arc<async_runtime::Mutex<()>>> = OnceLock::new();

struct Request {
    group_id: String,
    photo_id: String,
    original_path: String,
    thumbnail_path: Option<String>,
    cover: Option<AlbumCover>,
}

#[derive(PartialEq)]
struct Source {
    root: PathBuf,
    name: String,
    original_path: String,
    thumbnail_path: String,
    original: Original,
    cover: Option<AlbumCover>,
}

fn matches_cover(current: Option<&AlbumCover>, expected: Option<&AlbumCover>) -> bool {
    match (current, expected) {
        (Some(current), Some(expected)) => {
            // The caller echoes a snapshot through JavaScript and JSON.
            const EPSILON: f64 = 1e-12;
            current.photo_id == expected.photo_id
                && (current.offset_x - expected.offset_x).abs() <= EPSILON
                && (current.offset_y - expected.offset_y).abs() <= EPSILON
                && (current.zoom - expected.zoom).abs() <= EPSILON
        }
        (None, None) => true,
        _ => false,
    }
}

impl Source {
    fn resolve(conn: &Connection, request: &Request) -> Result<Self, String> {
        let (photo_id, name, original_path, thumbnail_path, cover) = conn
            .query_row(
                "SELECT p.id,p.original_name,p.original_path,p.thumbnail_path,
                        c.photo_id,c.offset_x,c.offset_y,c.zoom
                 FROM memberships m JOIN groups g ON g.id=m.group_id
                 JOIN photos p ON p.id=m.photo_id AND p.library=g.library
                 LEFT JOIN album_covers c ON c.group_id=m.group_id AND c.photo_id=m.photo_id
                 WHERE m.group_id=?1 AND m.status='active' AND p.hidden_after_album_delete=0
                 ORDER BY c.photo_id IS NOT NULL DESC,m.position,m.photo_id LIMIT 1",
                [&request.group_id],
                |row| {
                    let cover = match row.get(4)? {
                        Some(photo_id) => Some(AlbumCover {
                            photo_id,
                            offset_x: row.get(5)?,
                            offset_y: row.get(6)?,
                            zoom: row.get(7)?,
                        }),
                        None => None,
                    };
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        cover,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or(CHANGED)?;
        if photo_id != request.photo_id
            || original_path != request.original_path
            || request
                .thumbnail_path
                .as_ref()
                .is_some_and(|expected| *expected != thumbnail_path)
            || !matches_cover(cover.as_ref(), request.cover.as_ref())
        {
            return Err(CHANGED.into());
        }
        Ok(Self {
            root: db::library_root(conn)?,
            name,
            original: work_directory::original(conn, &photo_id, &original_path)?,
            original_path,
            thumbnail_path,
            cover,
        })
    }

    fn cache_key(&self, photo_id: &str) -> Result<Fingerprint, String> {
        let fields = serde_json::to_vec(&(
            photo_id,
            &self.name,
            &self.original_path,
            &self.thumbnail_path,
            &self.cover,
            self.original.indexed_hash(),
        ))
        .map_err(|error| error.to_string())?;
        Ok(Sha256::digest(fields).into())
    }
}

struct CacheEntry {
    revision: Fingerprint,
    jpeg: Vec<u8>,
}

impl CacheEntry {
    fn read(path: &Path, key: Fingerprint) -> Option<Self> {
        let mut file = File::open(path).ok()?;
        let mut stored_key = [0; 32];
        file.read_exact(&mut stored_key).ok()?;
        if stored_key != key {
            return None;
        }
        let mut revision = [0; 32];
        file.read_exact(&mut revision).ok()?;
        let mut jpeg = Vec::new();
        file.take(MAX_JPEG_BYTES + 1).read_to_end(&mut jpeg).ok()?;
        (jpeg.len() as u64 <= MAX_JPEG_BYTES
            && jpeg.starts_with(&[0xff, 0xd8])
            && jpeg.ends_with(&[0xff, 0xd9]))
        .then_some(Self { revision, jpeg })
    }
}

fn cache_path(root: &Path, group_id: &str) -> PathBuf {
    root.join(CACHE_DIRECTORY)
        .join(format!("{:x}.cache", Sha256::digest(group_id)))
}

pub(crate) fn remove_cached(conn: &Connection, group_id: &str) {
    if let Ok(root) = db::library_root(conn) {
        let _ = fs::remove_file(cache_path(&root, group_id));
    }
}

fn encode_profile(jpeg: Vec<u8>, profile: &[u8]) -> Vec<u8> {
    // JpegEncoder writes the JFIF APP0 marker immediately after SOI.
    let app0_end = 4 + usize::from(u16::from_be_bytes([jpeg[4], jpeg[5]]));
    // APP2 stores the 12-byte ICC identifier plus one byte each for sequence and count.
    // Its 16-bit length includes the two length bytes, so at most 65519 profile bytes fit.
    const CHUNK_BYTES: usize = u16::MAX as usize - 16;
    let chunks = profile.chunks(CHUNK_BYTES);
    let count = chunks.len() as u8;
    let mut tagged = Vec::with_capacity(jpeg.len() + profile.len() + 18 * usize::from(count));
    tagged.extend_from_slice(&jpeg[..app0_end]);
    for (index, chunk) in chunks.enumerate() {
        tagged.extend_from_slice(&[0xff, 0xe2]);
        tagged.extend_from_slice(&((chunk.len() + 16) as u16).to_be_bytes());
        tagged.extend_from_slice(b"ICC_PROFILE\0");
        tagged.extend_from_slice(&[index as u8 + 1, count]);
        tagged.extend_from_slice(chunk);
    }
    tagged.extend_from_slice(&jpeg[app0_end..]);
    tagged
}

fn render(file: File, name: &str, cover: Option<&AlbumCover>) -> Result<Vec<u8>, String> {
    let opened = photos::inspect_open_image(Path::new(name), file)?;
    let orientation = opened.orientation();
    let decode_error = |error| format!("封面原件解码失败：{error}");
    let mut decoder = opened.reader.into_decoder().map_err(decode_error)?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_SOURCE_PIXELS {
        return Err("封面原件超过 1.6 亿像素".into());
    }
    // Match ImageReader::decode's allocation check when using the decoder directly.
    let mut limits = image::Limits::default();
    limits
        .reserve(decoder.total_bytes())
        .map_err(decode_error)?;
    decoder.set_limits(limits).map_err(decode_error)?;
    let profile = decoder.icc_profile().ok().flatten().filter(|profile| {
        decoder.color_type().has_color()
            && profile.len() <= MAX_RGB_ICC_BYTES
            && profile.get(16..20) == Some(b"RGB ")
            && profile.get(36..40) == Some(b"acsp")
    });
    let image = photos::apply_orientation(
        DynamicImage::from_decoder(decoder).map_err(decode_error)?,
        orientation,
    );
    let (offset, zoom) = cover
        .map(|cover| ((cover.offset_x, cover.offset_y), cover.zoom))
        .unwrap_or(((0.5, 0.5), 1.0));
    let cropped = crop_cover(image, TARGET, offset, zoom);
    let units = (cropped.width() / 3)
        .min(cropped.height() / 2)
        .min(TARGET.0 / 3);
    if units == 0 {
        return Err("封面取景像素不足".into());
    }
    let size = (units * 3, units * 2);
    let resized = if (cropped.width(), cropped.height()) == size {
        cropped
    } else {
        cropped.resize_exact(size.0, size.1, FilterType::Lanczos3)
    };
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .encode_image(&photos::rgb_on_white(resized))
        .map_err(|error| format!("生成封面失败：{error}"))?;
    let bytes = match profile {
        Some(profile) => encode_profile(bytes, &profile),
        None => bytes,
    };
    if bytes.len() as u64 > MAX_JPEG_BYTES {
        return Err("生成的封面超过缓存大小限制".into());
    }
    Ok(bytes)
}

fn ensure_current<'a>(
    store: &'a Store,
    request: &Request,
    source: &Source,
) -> Result<MutexGuard<'a, Connection>, String> {
    let conn = store.connection.lock().map_err(|error| error.to_string())?;
    if &Source::resolve(&conn, request)? != source {
        return Err(CHANGED.into());
    }
    Ok(conn)
}

fn read(store: &Store, request: &Request) -> Result<Vec<u8>, String> {
    let source = {
        let conn = store.connection.lock().map_err(|error| error.to_string())?;
        Source::resolve(&conn, request)?
    };
    // One atomic entry per album. Editing the crop or relinking replaces the old
    // entry only when the current request has generated a complete new image.
    let path = cache_path(&source.root, &request.group_id);
    let key = source.cache_key(&request.photo_id)?;
    let indexed = source.original.indexed_hash().is_some();
    let cached = match CacheEntry::read(&path, key) {
        Some(entry) if indexed => {
            drop(ensure_current(store, request, &source)?);
            return Ok(entry.jpeg);
        }
        cached => cached,
    };
    let (file, signature) = match source.original.open_with_signature() {
        Ok(opened) => opened,
        Err(error) => {
            if let Some(entry) = cached {
                drop(ensure_current(store, request, &source)?);
                return Ok(entry.jpeg);
            }
            return Err(error);
        }
    };
    let original_revision: Fingerprint = Sha256::digest(&signature).into();
    if let Some(entry) = cached.filter(|entry| entry.revision == original_revision) {
        drop(ensure_current(store, request, &source)?);
        return Ok(entry.jpeg);
    }
    let bytes = render(
        file.try_clone().map_err(|error| error.to_string())?,
        &source.name,
        source.cover.as_ref(),
    )?;
    if work_directory::stat_signature(&file).as_deref() != Some(signature.as_str())
        || (!indexed && source.original.open_with_signature()?.1 != signature)
    {
        return Err(CHANGED.into());
    }
    let revision = if indexed {
        INDEXED_REVISION
    } else {
        original_revision
    };
    fs::create_dir_all(source.root.join(CACHE_DIRECTORY)).map_err(|error| error.to_string())?;
    let temporary = path.with_file_name(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file
        .write_all(&key)
        .and_then(|()| file.write_all(&revision))
        .and_then(|()| file.write_all(&bytes))
        .map_err(|error| error.to_string());
    drop(file);
    let published = written.and_then(|()| {
        let _current = ensure_current(store, request, &source)?;
        fs::rename(&temporary, &path).map_err(|error| error.to_string())
    });
    if published.is_err() {
        let _ = fs::remove_file(temporary);
    }
    published?;
    Ok(bytes)
}

#[cfg(test)]
mod tests;

async fn read_in_background(app: AppHandle, request: Request) -> Result<Vec<u8>, String> {
    let turn = READ_QUEUE
        .get_or_init(|| Arc::new(async_runtime::Mutex::new(())))
        .clone()
        .lock_owned()
        .await;
    async_runtime::spawn_blocking(move || {
        // Keep the permit until decoding ends, even if the awaiting IPC call is cancelled.
        let _turn = turn;
        let store = app.state::<Store>();
        let _active = store.restart_gate.require_work()?;
        read(&store, &request)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn prewarm(app: AppHandle, snapshot: &Snapshot, group_id: String) {
    let Some(cover) = snapshot
        .groups
        .iter()
        .find(|group| group.id == group_id)
        .and_then(|group| group.cover.clone())
    else {
        return;
    };
    let Some(photo) = snapshot
        .photos
        .iter()
        .find(|photo| photo.id == cover.photo_id)
    else {
        return;
    };
    let request = Request {
        group_id,
        photo_id: photo.id.clone(),
        original_path: photo.original_path.clone(),
        thumbnail_path: Some(photo.thumbnail_path.clone()),
        cover: Some(cover),
    };
    async_runtime::spawn(async move {
        let _ = read_in_background(app, request).await;
    });
}

#[tauri::command]
pub async fn read_album_cover(
    app: AppHandle,
    group_id: String,
    photo_id: String,
    expected_original_path: String,
    expected_thumbnail_path: Option<String>,
    expected_cover: Option<AlbumCover>,
) -> Result<tauri::ipc::Response, String> {
    read_in_background(
        app,
        Request {
            group_id,
            photo_id,
            original_path: expected_original_path,
            thumbnail_path: expected_thumbnail_path,
            cover: expected_cover,
        },
    )
    .await
    .map(tauri::ipc::Response::new)
}

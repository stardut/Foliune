use super::{supported_file, valid_component, LOCATOR_PREFIX};
use crate::{db, local_photo};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read, Seek},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BoundAvailability {
    Available,
    Offline,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct BoundSource {
    pub root: PathBuf,
    pub authorized: bool,
    pub folder: String,
    pub file_name: String,
    pub sha256: String,
    pub stat_signature: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Original {
    storage: Storage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Storage {
    Managed { root: PathBuf, path: PathBuf },
    Bound(BoundSource),
    Local(String),
}

fn original_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "照片原件缺失，请重新定位照片".into()
    } else {
        format!("读取照片原件失败：{error}")
    }
}

impl Original {
    pub(crate) fn indexed_hash(&self) -> Option<&str> {
        match &self.storage {
            Storage::Bound(source) => Some(&source.sha256),
            _ => None,
        }
    }

    pub(crate) fn open(&self) -> Result<File, String> {
        match &self.storage {
            Storage::Managed { root, path } => {
                let path = path.canonicalize().map_err(original_error)?;
                if path.parent() != Some(root.join("originals").as_path()) {
                    return Err("照片原件不在当前图库的管理目录中".into());
                }
                let file = File::open(path).map_err(original_error)?;
                if !file.metadata().map_err(original_error)?.is_file() {
                    return Err("照片原件不是普通文件，请重新定位照片".into());
                }
                Ok(file)
            }
            Storage::Bound(source) => {
                self.open_bound_with_signature(source).map(|(file, _)| file)
            }
            Storage::Local(locator) => local_photo::open(locator),
        }
    }

    pub(crate) fn open_with_signature(&self) -> Result<(File, String), String> {
        if let Storage::Bound(source) = &self.storage {
            return self.open_bound_with_signature(source);
        }
        let file = self.open()?;
        let signature = stat_signature(&file).ok_or("无法确认照片原件状态")?;
        Ok((file, signature))
    }

    fn open_bound_with_signature(&self, source: &BoundSource) -> Result<(File, String), String> {
        let mut file = source.open()?;
        let signature = stat_signature(&file).ok_or("无法确认作品原件状态")?;
        self.verify_content_hash(&fingerprint(&mut file)?)?;
        if stat_signature(&file).as_deref() != Some(signature.as_str()) {
            return Err(format!("作品原件在读取期间发生变化：{}", source.file_name));
        }
        file.rewind().map_err(original_error)?;
        Ok((file, signature))
    }

    pub(crate) fn verify_content_hash(&self, sha256: &str) -> Result<(), String> {
        if let Storage::Bound(source) = &self.storage {
            if sha256 != source.sha256 {
                return Err(format!("作品原件内容已变化：{}", source.file_name));
            }
        }
        Ok(())
    }

    pub(crate) fn read(&self) -> Result<Vec<u8>, String> {
        match &self.storage {
            Storage::Managed { .. } | Storage::Local(_) => {
                let mut bytes = Vec::new();
                self.open()?
                    .read_to_end(&mut bytes)
                    .map_err(original_error)?;
                Ok(bytes)
            }
            Storage::Bound(source) => {
                let mut file = source.open()?;
                let size = match source.expected_size() {
                    Some(size) => size,
                    None => {
                        // Earlier records have no fast stat signature. Check before allocating.
                        let size = file.metadata().map_err(original_error)?.len();
                        if fingerprint(&mut file)? != source.sha256 {
                            return Err(format!("作品原件内容已变化：{}", source.file_name));
                        }
                        file.rewind().map_err(original_error)?;
                        size
                    }
                };
                let limit = size.checked_add(1).ok_or("作品原件大小无效")?;
                let mut bytes = Vec::new();
                bytes
                    .try_reserve_exact(limit.try_into().map_err(|_| "作品原件过大")?)
                    .map_err(|_| "内存不足，无法读取作品原件")?;
                file.take(limit)
                    .read_to_end(&mut bytes)
                    .map_err(original_error)?;
                if bytes.len() as u64 != size
                    || format!("{:x}", Sha256::digest(&bytes)) != source.sha256
                {
                    return Err(format!("作品原件内容已变化：{}", source.file_name));
                }
                Ok(bytes)
            }
        }
    }

    pub(crate) fn availability(&self) -> Option<BoundAvailability> {
        match &self.storage {
            Storage::Bound(source) => Some(source.availability()),
            Storage::Managed { .. } | Storage::Local(_) => None,
        }
    }
}

pub(crate) fn original(
    conn: &Connection,
    photo_id: &str,
    locator: &str,
) -> Result<Original, String> {
    let storage = if let Some(id) = locator.strip_prefix(LOCATOR_PREFIX) {
        if id != photo_id || uuid::Uuid::parse_str(id).is_err() {
            return Err("作品原件引用无效".into());
        }
        Storage::Bound(
            conn.query_row(
                "SELECT r.path,r.authorized,p.folder,p.file_name,p.sha256,p.stat_signature
             FROM work_directory_photos p JOIN work_directory_roots r ON r.id=p.root_id
             WHERE p.photo_id=?1",
                [photo_id],
                |row| {
                    Ok(BoundSource {
                        root: PathBuf::from(row.get::<_, String>(0)?),
                        authorized: row.get(1)?,
                        folder: row.get(2)?,
                        file_name: row.get(3)?,
                        sha256: row.get(4)?,
                        stat_signature: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or("作品原件引用不存在")?,
        )
    } else if local_photo::is_locator(locator) {
        Storage::Local(locator.to_owned())
    } else {
        Storage::Managed {
            root: db::library_root(conn)?,
            path: PathBuf::from(locator),
        }
    };
    Ok(Original { storage })
}

pub(crate) fn original_status(
    conn: &Connection,
    photo_id: &str,
    locator: &str,
) -> Result<(bool, Option<BoundAvailability>), String> {
    if local_photo::is_locator(locator) {
        return Ok((local_photo::is_available(locator), None));
    }
    if locator.starts_with(LOCATOR_PREFIX) {
        let availability = original(conn, photo_id, locator)?.availability();
        return Ok((
            availability == Some(BoundAvailability::Available),
            availability,
        ));
    }
    Ok((Path::new(locator).is_file(), None))
}

impl BoundSource {
    fn expected_size(&self) -> Option<u64> {
        expected_size(self.stat_signature.as_deref())
    }

    fn open(&self) -> Result<File, String> {
        if !self.authorized {
            return Err("作品目录尚未重新定位".into());
        }
        let root = RootDirectory::open(&self.root).map_err(|_| "作品目录当前不可用")?;
        let file = root
            .photo(&self.folder, &self.file_name)
            .map_err(|_| format!("作品原件缺失或无法读取：{}", self.file_name))?;
        if !size_matches(&file, self.expected_size()) {
            return Err(format!("作品原件内容已变化：{}", self.file_name));
        }
        Ok(file)
    }

    fn availability(&self) -> BoundAvailability {
        if !self.authorized {
            return BoundAvailability::Offline;
        }
        let Ok(root) = RootDirectory::open(&self.root) else {
            return BoundAvailability::Offline;
        };
        let Ok(mut file) = root.photo(&self.folder, &self.file_name) else {
            return BoundAvailability::Missing;
        };
        if !size_matches(&file, self.expected_size()) {
            return BoundAvailability::Missing;
        }
        let unchanged = self
            .stat_signature
            .as_ref()
            .is_some_and(|expected| stat_signature(&file).as_ref() == Some(expected));
        if unchanged || fingerprint(&mut file).is_ok_and(|actual| actual == self.sha256) {
            BoundAvailability::Available
        } else {
            BoundAvailability::Missing
        }
    }
}

pub(super) fn expected_size(signature: Option<&str>) -> Option<u64> {
    let signature = signature?;
    let (platform, fields) = signature.split_once(':')?;
    let index = match platform {
        "unix" => 2,
        "windows" | "other" => 0,
        _ => return None,
    };
    fields.split(':').nth(index)?.parse().ok()
}

pub(super) fn size_matches(file: &File, expected: Option<u64>) -> bool {
    expected.is_none_or(|size| file.metadata().is_ok_and(|metadata| metadata.len() == size))
}

pub(crate) fn stat_signature(file: &File) -> Option<String> {
    let metadata = file.metadata().ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!(
            "unix:{}:{}:{}:{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.size(),
            metadata.mtime(),
            metadata.mtime_nsec(),
            metadata.ctime(),
            metadata.ctime_nsec()
        ))
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Some(format!(
            "windows:{}:{}:{}",
            metadata.file_size(),
            metadata.creation_time(),
            metadata.last_write_time()
        ))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let modified = metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?;
        Some(format!(
            "other:{}:{}:{}",
            metadata.len(),
            modified.as_secs(),
            modified.subsec_nanos()
        ))
    }
}

pub(super) fn fingerprint(file: &mut File) -> Result<String, String> {
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(original_error)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub(super) fn readable_root(path: &Path) -> bool {
    RootDirectory::open(path).is_ok()
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum EntryKind {
    Directory,
    File,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct RootIdentity([u8; 16], u64);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct RootStamp(u64, u64, Option<RootIdentity>);

impl RootStamp {
    pub fn durable(self) -> Option<RootIdentity> {
        self.2
    }
}

#[cfg(target_os = "macos")]
fn volume_uuid(directory: &File) -> Option<[u8; 16]> {
    use std::os::fd::AsRawFd;
    #[repr(C)]
    struct VolumeUuid {
        length: u32,
        uuid: [u8; 16],
    }
    let mut request = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: 0,
        volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut response = VolumeUuid {
        length: 0,
        uuid: [0; 16],
    };
    // The descriptor is still open, and the fixed response is the native
    // attribute-buffer length followed by the sixteen bytes of ATTR_VOL_UUID.
    let result = unsafe {
        libc::fgetattrlist(
            directory.as_raw_fd(),
            (&mut request as *mut libc::attrlist).cast(),
            (&mut response as *mut VolumeUuid).cast(),
            std::mem::size_of::<VolumeUuid>(),
            0,
        )
    };
    (result == 0
        && response.length as usize == std::mem::size_of::<VolumeUuid>()
        && response.uuid != [0; 16])
        .then_some(response.uuid)
}

pub(super) struct RootDirectory {
    #[cfg(unix)]
    directory: File,
    #[cfg(not(unix))]
    path: PathBuf,
}

impl RootDirectory {
    pub fn identity(&self) -> Option<RootStamp> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let metadata = self.directory.metadata().ok()?;
            // The device number can change when a disk is remounted. A volume
            // UUID plus directory inode is independent of the current mount.
            #[cfg(target_os = "macos")]
            let durable =
                volume_uuid(&self.directory).map(|uuid| RootIdentity(uuid, metadata.ino()));
            #[cfg(not(target_os = "macos"))]
            let durable = None;
            Some(RootStamp(metadata.dev(), metadata.ino(), durable))
        }
        #[cfg(not(unix))]
        {
            let creation = fs::symlink_metadata(&self.path)
                .ok()?
                .created()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?;
            Some(RootStamp(
                creation.as_secs(),
                u64::from(creation.subsec_nanos()),
                None,
            ))
        }
    }

    pub fn open(path: &Path) -> io::Result<Self> {
        if !path.is_absolute() {
            return Err(invalid_path());
        }
        #[cfg(unix)]
        {
            use std::{os::unix::fs::OpenOptionsExt, path::Component};
            let mut directory = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
                .open("/")?;
            for part in path.components() {
                match part {
                    Component::RootDir => {}
                    Component::Normal(name) => {
                        directory = open_at(&directory, name, libc::O_DIRECTORY)?;
                    }
                    _ => return Err(invalid_path()),
                }
            }
            Ok(Self { directory })
        }
        #[cfg(not(unix))]
        {
            if path.canonicalize()? != path || !fs::symlink_metadata(path)?.is_dir() {
                return Err(invalid_path());
            }
            fs::read_dir(path)?;
            Ok(Self { path: path.into() })
        }
    }

    pub fn entries(&self, folder: Option<&str>) -> io::Result<Vec<(String, EntryKind)>> {
        if folder.is_some_and(|name| !valid_component(name)) {
            return Err(invalid_path());
        }
        #[cfg(unix)]
        {
            let directory = match folder {
                Some(name) => open_at(&self.directory, name.as_ref(), libc::O_DIRECTORY)?,
                // Use a separate open file description; readdir changes its position.
                None => open_at(&self.directory, ".".as_ref(), libc::O_DIRECTORY)?,
            };
            entries_at(directory)
        }
        #[cfg(not(unix))]
        {
            let path = folder.map_or_else(|| self.path.clone(), |folder| self.path.join(folder));
            if path.canonicalize()? != path || !fs::symlink_metadata(&path)?.is_dir() {
                return Err(invalid_path());
            }
            Ok(fs::read_dir(path)?
                .flatten()
                .filter_map(|entry| {
                    let kind = entry.file_type().ok()?;
                    let name = entry.file_name().into_string().ok()?;
                    if kind.is_dir() {
                        Some((name, EntryKind::Directory))
                    } else if kind.is_file() {
                        Some((name, EntryKind::File))
                    } else {
                        None
                    }
                })
                .collect())
        }
    }

    pub fn photo(&self, folder: &str, file_name: &str) -> io::Result<File> {
        if !valid_component(folder) || !supported_file(file_name) {
            return Err(invalid_path());
        }
        #[cfg(unix)]
        let file = {
            let directory = open_at(&self.directory, folder.as_ref(), libc::O_DIRECTORY)?;
            // O_NONBLOCK avoids hanging if a once-indexed regular file becomes a FIFO.
            open_at(&directory, file_name.as_ref(), libc::O_NONBLOCK)?
        };
        #[cfg(not(unix))]
        let file = {
            let directory = self.path.join(folder);
            let path = directory.join(file_name);
            if path.canonicalize()? != path
                || !fs::symlink_metadata(&directory)?.is_dir()
                || !fs::symlink_metadata(&path)?.is_file()
            {
                return Err(invalid_path());
            }
            open_checked_file(&path)?
        };
        if !file.metadata()?.is_file() {
            return Err(invalid_path());
        }
        Ok(file)
    }
}

pub(crate) fn open_file_at_path(path: &Path) -> io::Result<File> {
    #[cfg(unix)]
    let file = {
        let root = RootDirectory::open(path.parent().ok_or_else(invalid_path)?)?;
        let name = path.file_name().ok_or_else(invalid_path)?;
        open_at(&root.directory, name, libc::O_NONBLOCK)?
    };
    #[cfg(not(unix))]
    let file = {
        if path.canonicalize()? != path || !fs::symlink_metadata(path)?.is_file() {
            return Err(invalid_path());
        }
        open_checked_file(path)?
    };
    if !file.metadata()?.is_file() {
        return Err(invalid_path());
    }
    Ok(file)
}

#[cfg(not(unix))]
fn open_checked_file(path: &Path) -> io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself if it replaced the checked file; never follow it.
        const OPEN_REPARSE_POINT: u32 = 0x00200000;
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(OPEN_REPARSE_POINT)
            .open(path)?;
        verify_windows_handle(&file, path)?;
        Ok(file)
    }
    #[cfg(not(windows))]
    File::open(path)
}

fn invalid_path() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "目录路径或文件类型无效")
}

#[cfg(unix)]
fn open_at(directory: &File, name: &std::ffi::OsStr, flags: libc::c_int) -> io::Result<File> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::ffi::OsStrExt,
        },
    };
    let name = CString::new(name.as_bytes()).map_err(|_| invalid_path())?;
    // The parent is an already opened directory, and name is one literal path component.
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | flags,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: successful openat returns an owned descriptor.
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(unix)]
fn entries_at(directory: File) -> io::Result<Vec<(String, EntryKind)>> {
    use std::{
        ffi::CStr,
        os::fd::{AsRawFd, IntoRawFd},
    };

    struct Entries(*mut libc::DIR);
    impl Drop for Entries {
        fn drop(&mut self) {
            // SAFETY: this DIR is owned by this guard and still open.
            unsafe { libc::closedir(self.0) };
        }
    }

    // SAFETY: directory is a live open directory descriptor. On success fdopendir
    // owns it; on failure the File continues to own it.
    let raw = unsafe { libc::fdopendir(directory.as_raw_fd()) };
    if raw.is_null() {
        return Err(io::Error::last_os_error());
    }
    let fd = directory.into_raw_fd();
    let entries = Entries(raw);
    let mut result = Vec::new();
    loop {
        // SAFETY: the entry remains valid through this iteration, until readdir is called again.
        let entry = unsafe { libc::readdir(entries.0).as_ref() };
        let Some(entry) = entry else { break };
        // SAFETY: d_name on a readdir result is a null-terminated filename.
        let name = unsafe { CStr::from_ptr(entry.d_name.as_ptr()) };
        let Ok(text) = name.to_str() else { continue };
        if !valid_component(text) {
            continue;
        }
        let kind = match entry.d_type {
            libc::DT_DIR => EntryKind::Directory,
            libc::DT_REG => EntryKind::File,
            libc::DT_UNKNOWN => {
                let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                // SAFETY: fd and name are live. fstatat initializes stat on success.
                if unsafe {
                    libc::fstatat(
                        fd,
                        name.as_ptr(),
                        stat.as_mut_ptr(),
                        libc::AT_SYMLINK_NOFOLLOW,
                    )
                } != 0
                {
                    continue;
                }
                // SAFETY: fstatat has initialized this value.
                match unsafe { stat.assume_init() }.st_mode & libc::S_IFMT {
                    libc::S_IFDIR => EntryKind::Directory,
                    libc::S_IFREG => EntryKind::File,
                    _ => continue,
                }
            }
            _ => continue,
        };
        result.push((text.into(), kind));
    }
    Ok(result)
}

#[cfg(windows)]
fn verify_windows_handle(file: &File, expected: &Path) -> io::Result<()> {
    use std::{
        ffi::{c_void, OsString},
        os::windows::{ffi::OsStringExt, fs::MetadataExt, io::AsRawHandle},
    };
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    if file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(invalid_path());
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(
            handle: *mut c_void,
            path: *mut u16,
            count: u32,
            flags: u32,
        ) -> u32;
    }
    let mut buffer = vec![0u16; 32768];
    // The handle is live and the buffer is writable for its declared size.
    let count = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if count == 0 {
        return Err(io::Error::last_os_error());
    }
    if count as usize >= buffer.len()
        || PathBuf::from(OsString::from_wide(&buffer[..count as usize])) != expected
    {
        return Err(invalid_path());
    }
    Ok(())
}

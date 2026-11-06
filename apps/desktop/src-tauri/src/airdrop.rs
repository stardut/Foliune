use tauri::WebviewWindow;

#[tauri::command]
pub async fn share_album_airdrop(
    window: WebviewWindow,
    group_id: String,
    photo_ids: Option<Vec<String>>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::share(window, group_id, photo_ids).await;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, group_id, photo_ids);
        Err("隔空投送仅在 macOS 上可用".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use crate::{
        db::{self, Store},
        work_directory::{self, Original},
    };
    use rusqlite::Connection;
    use std::{
        collections::HashMap,
        ffi::{c_char, c_void, CStr, CString},
        fs::{self, DirBuilder, OpenOptions},
        io,
        os::unix::{
            ffi::OsStrExt,
            fs::{DirBuilderExt, OpenOptionsExt},
        },
        path::{Path, PathBuf},
        sync::atomic::{AtomicBool, Ordering},
    };
    use tauri::{
        async_runtime::{self, channel, Sender},
        Manager, WebviewWindow,
    };

    #[derive(Debug, PartialEq, Eq)]
    struct Photo {
        id: String,
        name: String,
        original: Original,
    }

    fn selection(
        conn: &Connection,
        group_id: &str,
        photo_ids: Option<&[String]>,
    ) -> Result<Vec<Photo>, String> {
        let sql_error = |error: rusqlite::Error| format!("无法读取相簿：{error}");
        if !conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM groups WHERE id=?1)",
                [group_id],
                |row| row.get(0),
            )
            .map_err(sql_error)?
        {
            return Err("相簿已不存在，请返回相簿首页后重试".into());
        }
        let mut query = conn
            .prepare(
                "SELECT p.id, p.original_name, p.original_path
                 FROM memberships m JOIN groups g ON m.group_id=g.id
                 JOIN photos p ON m.photo_id=p.id AND p.library=g.library
                 WHERE g.id=?1 AND m.status='active' AND p.hidden_after_album_delete=0
                 ORDER BY m.position, p.id",
            )
            .map_err(sql_error)?;
        let members = query
            .query_map([group_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        let members = if let Some(photo_ids) = photo_ids {
            let mut by_id: HashMap<_, _> = members
                .into_iter()
                .map(|(id, name, path)| (id, (name, path)))
                .collect();
            photo_ids
                .iter()
                .map(|id| {
                    let (name, path) = by_id
                        .remove(id)
                        .ok_or("部分选片已不在当前相簿，请重新选择后投送")?;
                    Ok((id.clone(), name, path))
                })
                .collect::<Result<Vec<_>, &str>>()?
        } else {
            members
        };
        if members.is_empty() {
            return Err("没有可隔空投送的照片".into());
        }
        members
            .into_iter()
            .map(|(id, name, path)| {
                let original = work_directory::original(conn, &id, &path)
                    .map_err(|error| photo_error(&name, error))?;
                Ok(Photo { id, name, original })
            })
            .collect()
    }

    fn photo_error(name: &str, error: impl std::fmt::Display) -> String {
        format!("无法准备「{name}」用于隔空投送：{error}")
    }

    struct Staging(PathBuf);

    impl Staging {
        fn new(parent: &Path) -> io::Result<Self> {
            let directory = parent.join(format!("foliune-airdrop-{}", uuid::Uuid::new_v4()));
            DirBuilder::new().mode(0o700).create(&directory)?;
            Ok(Self(directory))
        }

        fn copy(&self, photo: &Photo) -> Result<CString, String> {
            let name = Path::new(&photo.name);
            if name.file_name().and_then(|name| name.to_str()) != Some(photo.name.as_str()) {
                return Err(photo_error(&photo.name, "原始文件名无效"));
            }
            let mut input = photo
                .original
                .open()
                .map_err(|e| photo_error(&photo.name, e))?;
            let revision = work_directory::stat_signature(&input)
                .ok_or_else(|| photo_error(&photo.name, "无法确认原件状态"))?;
            let mut path = self.0.join(name);
            let mut number = 2;
            let mut output = loop {
                match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&path)
                {
                    Ok(file) => break file,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        path = self.0.join(numbered_name(name, number));
                        number += 1;
                    }
                    Err(error) => return Err(photo_error(&photo.name, error)),
                }
            };
            io::copy(&mut input, &mut output).map_err(|e| photo_error(&photo.name, e))?;
            if work_directory::stat_signature(&input).as_deref() != Some(&revision) {
                return Err(photo_error(&photo.name, "复制时原件发生变化，请重试"));
            }
            CString::new(path.as_os_str().as_bytes()).map_err(|e| photo_error(&photo.name, e))
        }
    }

    impl Drop for Staging {
        fn drop(&mut self) {
            if let Err(error) = fs::remove_dir_all(&self.0) {
                eprintln!("无法清理隔空投送临时文件：{error}");
            }
        }
    }

    fn numbered_name(name: &Path, number: usize) -> String {
        let stem = name
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("photo");
        let extension = name.extension().and_then(|extension| extension.to_str());
        let suffix = extension.map_or_else(
            || format!(" ({number})"),
            |extension| format!(" ({number}).{extension}"),
        );
        let length =
            stem.floor_char_boundary(255usize.saturating_sub(suffix.len()).min(stem.len()));
        format!("{}{suffix}", &stem[..length])
    }

    fn prepare(
        store: &Store,
        parent: &Path,
        group_id: &str,
        photo_ids: Option<&[String]>,
    ) -> Result<(Staging, Vec<CString>), String> {
        let (root, photos) = {
            let conn = store.connection.lock().map_err(|e| e.to_string())?;
            (
                db::library_root(&conn)?,
                selection(&conn, group_id, photo_ids)?,
            )
        };
        let staging = Staging::new(parent).map_err(|e| format!("无法创建隔空投送临时目录：{e}"))?;
        let paths = photos
            .iter()
            .map(|photo| staging.copy(photo))
            .collect::<Result<_, _>>()?;
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        if db::library_root(&conn)? != root || selection(&conn, group_id, photo_ids)? != photos {
            return Err("图库、相簿或照片原件已更改，请确认后重新投送".into());
        }
        Ok((staging, paths))
    }

    static SHARING: AtomicBool = AtomicBool::new(false);

    struct ShareLease;

    impl ShareLease {
        fn acquire() -> Result<Self, String> {
            SHARING
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map(|_| Self)
                .map_err(|_| "已有隔空投送正在进行".into())
        }
    }

    impl Drop for ShareLease {
        fn drop(&mut self) {
            SHARING.store(false, Ordering::Release);
        }
    }

    struct Completion {
        staging: Staging,
        lease: ShareLease,
        result: Sender<Result<(), String>>,
    }

    impl Completion {
        fn finish(self, outcome: Result<(), String>) {
            async_runtime::spawn_blocking(move || {
                drop(self.staging);
                drop(self.lease);
                let _ = self.result.blocking_send(outcome);
            });
        }
    }

    extern "C" {
        fn foliune_share_airdrop(
            window: *mut c_void,
            paths: *const *const c_char,
            count: usize,
            context: *mut c_void,
            complete: extern "C" fn(*mut c_void, *const c_char),
        );
    }

    extern "C" fn complete(context: *mut c_void, error: *const c_char) {
        // The bridge calls this once, with an optional string valid for this call.
        let completion = unsafe { Box::from_raw(context.cast::<Completion>()) };
        let outcome = if error.is_null() {
            Ok(())
        } else {
            Err(unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned())
        };
        completion.finish(outcome);
    }

    pub(super) async fn share(
        window: WebviewWindow,
        group_id: String,
        photo_ids: Option<Vec<String>>,
    ) -> Result<(), String> {
        let lease = ShareLease::acquire()?;
        let app = window.app_handle().clone();
        let (staging, paths) = async_runtime::spawn_blocking(move || {
            let store = app.state::<Store>();
            prepare(
                &store,
                &std::env::temp_dir(),
                &group_id,
                photo_ids.as_deref(),
            )
        })
        .await
        .map_err(|e| e.to_string())??;
        let (result, mut finished) = channel(1);
        let completion = Completion {
            staging,
            lease,
            result,
        };
        let source = window.clone();
        window
            .run_on_main_thread(move || {
                let Ok(native_window) = source.ns_window() else {
                    completion.finish(Err("无法打开隔空投送窗口".into()));
                    return;
                };
                let pointers: Vec<_> = paths.iter().map(|path| path.as_ptr()).collect();
                // AppKit copies the paths into NSURLs synchronously and keeps the completion
                // context until the sharing service reports a terminal result.
                unsafe {
                    foliune_share_airdrop(
                        native_window,
                        pointers.as_ptr(),
                        pointers.len(),
                        Box::into_raw(Box::new(completion)).cast(),
                        complete,
                    );
                }
            })
            .map_err(|e| format!("无法打开隔空投送窗口：{e}"))?;
        finished.recv().await.ok_or("无法读取隔空投送结果")?
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::{groups, models::GroupInput, photos};

        fn album(store: &Store, name: &str) -> String {
            groups::create(
                &store.connection.lock().unwrap(),
                GroupInput {
                    library: "collection".into(),
                    name: name.into(),
                    description: String::new(),
                    capacity: None,
                },
            )
            .unwrap()
            .groups
            .into_iter()
            .find(|group| group.name == name)
            .unwrap()
            .id
        }

        fn photo(parent: &Path, subdir: &str, name: &str, color: [u8; 3]) -> String {
            let subdir = parent.join(subdir);
            fs::create_dir(&subdir).unwrap();
            let path = subdir.join(name);
            image::RgbImage::from_pixel(20, 10, image::Rgb(color))
                .save(&path)
                .unwrap();
            path.to_str().unwrap().into()
        }

        #[test]
        fn album_and_explicit_selection_stage_the_right_originals() {
            let root = tempfile::tempdir().unwrap();
            let store = Store::open(root.path().join("library")).unwrap();
            let staging = tempfile::tempdir().unwrap();
            let group_id = album(&store, "本相簿");
            let other_group = album(&store, "其他相簿");
            let managed = photo(root.path(), "managed", "同名.jpg", [10, 20, 30]);
            let local = photo(root.path(), "local", "同名.jpg", [20, 10, 40]);
            let outside = photo(root.path(), "other", "其他.jpg", [100, 0, 0]);
            let archived = photo(root.path(), "archived", "已废弃.jpg", [0, 100, 0]);
            let imported =
                photos::import(&store, vec![managed.clone()], "collection", Some(&group_id))
                    .unwrap();
            assert_eq!(imported.imported_ids.len(), 1);
            let local_id =
                photos::import_local(&store, vec![local.clone()], "collection", Some(&group_id))
                    .unwrap()
                    .0
                    .imported_ids
                    .remove(0);
            let archived_id = photos::import_local(
                &store,
                vec![archived.clone()],
                "collection",
                Some(&group_id),
            )
            .unwrap()
            .0
            .imported_ids
            .remove(0);
            let outside_id =
                photos::import(&store, vec![outside], "collection", Some(&other_group))
                    .unwrap()
                    .imported_ids
                    .remove(0);
            groups::set_statuses(
                &mut store.connection.lock().unwrap(),
                &group_id,
                &[archived_id.clone()],
                "discarded",
            )
            .unwrap();
            fs::remove_file(&archived).unwrap();

            let (files, paths) = prepare(&store, staging.path(), &group_id, None).unwrap();
            assert_eq!(paths.len(), 2);
            assert_eq!(
                fs::read(files.0.join("同名.jpg")).unwrap(),
                fs::read(&managed).unwrap()
            );
            assert_eq!(
                fs::read(files.0.join("同名 (2).jpg")).unwrap(),
                fs::read(&local).unwrap()
            );
            drop(files);

            let (files, paths) =
                prepare(&store, staging.path(), &group_id, Some(&[local_id.clone()])).unwrap();
            assert_eq!(paths.len(), 1);
            assert_eq!(
                fs::read(files.0.join("同名.jpg")).unwrap(),
                fs::read(&local).unwrap()
            );
            drop(files);

            for ids in [
                vec![],
                vec![outside_id],
                vec![archived_id],
                vec![local_id.clone(), local_id],
            ] {
                assert!(prepare(&store, staging.path(), &group_id, Some(&ids)).is_err());
            }
            fs::remove_file(&local).unwrap();
            let error = prepare(&store, staging.path(), &group_id, None)
                .err()
                .unwrap();
            assert!(
                error.contains("同名.jpg") && error.contains("原件缺失"),
                "{error}"
            );
            assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
            assert!(Path::new(&managed).is_file());
        }
    }
}

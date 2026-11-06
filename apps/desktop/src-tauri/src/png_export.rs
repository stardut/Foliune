use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, ErrorKind, Write},
    path::{Path, PathBuf},
};

fn file_stem(title: &str, default_title: &str) -> String {
    let title = title.trim();
    let title = match title.rsplit_once('.') {
        Some((stem, extension)) if extension.eq_ignore_ascii_case("png") => stem,
        _ => title,
    };
    let mut stem = String::new();
    for character in title.chars() {
        let character = if character.is_control() || "<>:\"/\\|?*".contains(character) {
            '_'
        } else {
            character
        };
        if stem.len() + character.len_utf8() > 220 {
            break;
        }
        stem.push(character);
    }
    let stem = stem.trim_matches([' ', '.']);
    if stem.is_empty() {
        return default_title.into();
    }
    // Windows reserves device names even when followed by an extension.
    let device = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device
            .strip_prefix("COM")
            .or_else(|| device.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
    {
        return format!("_{stem}");
    }
    stem.into()
}

pub(crate) fn write_png(
    directory: &Path,
    title: &str,
    default_title: &str,
    write: impl FnOnce(&mut BufWriter<&mut File>) -> Result<(), String>,
) -> Result<PathBuf, String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("导出目录无效，请重新选择目录".into());
    }
    let stem = file_stem(title, default_title);
    let mut number = 1u64;
    let (path, mut file) = loop {
        let name = if number == 1 {
            format!("{stem}.png")
        } else {
            format!("{stem} ({number}).png")
        };
        let path = directory.join(name);
        // An exclusive create also protects existing names on removable drives.
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => break (path, file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) if error.kind() == ErrorKind::PermissionDenied && path.is_dir() => {}
            Err(error) => return Err(format!("无法在所选目录创建 PNG：{error}")),
        }
        number += 1;
    };
    let result = (|| {
        let mut writer = BufWriter::new(&mut file);
        write(&mut writer)?;
        writer.flush().map_err(|error| error.to_string())?;
        drop(writer);
        file.sync_all().map_err(|error| error.to_string())
    })();
    drop(file);
    if let Err(error) = result {
        fs::remove_file(&path).map_err(|cleanup| {
            format!(
                "写入 PNG 失败：{error}。无法清理未完成的文件 {}：{cleanup}",
                path.display()
            )
        })?;
        return Err(format!("写入 PNG 失败：{error}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names_stay_in_the_chosen_directory() {
        let directory = tempfile::tempdir().unwrap();
        let write = |title| write_png(directory.path(), title, "拼图", |_| Ok(()));
        assert_eq!(
            write("../子目录\\成片.PNG").unwrap(),
            directory.path().join("_子目录_成片.png")
        );
        assert_eq!(
            write("COM1.png").unwrap(),
            directory.path().join("_COM1.png")
        );
        assert_eq!(write("...").unwrap(), directory.path().join("拼图.png"));
        let long = write(&"长".repeat(120)).unwrap();
        assert_eq!(long.parent(), Some(directory.path()));
        assert_eq!(long.extension().unwrap(), "png");
        assert!(long.file_name().unwrap().to_str().unwrap().len() <= 224);
    }

    #[test]
    fn a_failed_write_cleans_up_only_the_new_file() {
        let directory = tempfile::tempdir().unwrap();
        let existing = directory.path().join("拼图.png");
        fs::write(&existing, b"untouched").unwrap();
        let result = write_png(directory.path(), "拼图", "拼图", |writer| {
            writer.write_all(b"unfinished").unwrap();
            writer.flush().unwrap();
            Err("test write error".into())
        });
        assert!(result.unwrap_err().contains("test write error"));
        assert_eq!(fs::read(&existing).unwrap(), b"untouched");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn concurrent_exports_claim_distinct_names() {
        let directory = tempfile::tempdir().unwrap();
        let occupied = directory.path().join("拼图.png");
        fs::create_dir(&occupied).unwrap();
        std::thread::scope(|scope| {
            let write = |bytes| {
                write_png(directory.path(), "拼图", "拼图", |writer| {
                    writer.write_all(bytes).map_err(|error| error.to_string())
                })
                .unwrap()
            };
            let first = scope.spawn(move || write(b"first"));
            let second = scope.spawn(move || write(b"second"));
            let first = first.join().unwrap();
            let second = second.join().unwrap();
            assert_ne!(first, second);
            assert_eq!(fs::read(first).unwrap(), b"first");
            assert_eq!(fs::read(second).unwrap(), b"second");
        });
        assert!(occupied.is_dir());
        assert!(directory.path().join("拼图 (2).png").is_file());
        assert!(directory.path().join("拼图 (3).png").is_file());
    }
}

use crate::db::{library_root, Store};
use exif::{In, Tag, Value};
use image::ImageFormat;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::{
    fs::File,
    io::{self, BufRead, BufReader, Seek},
    path::PathBuf,
};
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMetadata {
    camera: Option<String>,
    lens: Option<String>,
    focal_length_mm: Option<f64>,
    #[serde(rename = "focalLength35mm")]
    focal_length_35mm: Option<u32>,
    aperture: Option<f64>,
    exposure_seconds: Option<f64>,
    iso: Option<u32>,
    exposure_compensation_ev: Option<f64>,
    exposure_mode: Option<&'static str>,
    metering_mode: Option<&'static str>,
    white_balance: Option<&'static str>,
    flash_fired: Option<bool>,
    exif_read_failed: bool,
    file_size_bytes: u64,
    file_format: &'static str,
}

pub(crate) fn read_exif(reader: &mut (impl BufRead + Seek)) -> Result<exif::Exif, exif::Error> {
    exif::Reader::new().read_from_container(reader)
}

fn equipment_name(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) => {
            let same_brand = make
                .split_whitespace()
                .next()
                .zip(model.split_whitespace().next())
                .is_some_and(|(make, model)| make.eq_ignore_ascii_case(model));
            if same_brand {
                Some(model)
            } else {
                Some(format!("{make} {model}"))
            }
        }
        (make, model) => model.or(make),
    }
}

fn source(
    store: &Store,
    photo_id: &str,
) -> Result<(PathBuf, String, crate::work_directory::Original), String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [photo_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("照片不存在")?;
    let original = crate::work_directory::original(&conn, photo_id, &path)?;
    Ok((library_root(&conn)?, path, original))
}

fn original_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "照片原件缺失，请重新定位照片".into()
    } else {
        format!("读取照片原件失败：{error}")
    }
}

fn read_original(file: File) -> Result<PhotoMetadata, String> {
    let info = file.metadata().map_err(original_error)?;
    let mut reader = BufReader::new(file);
    let file_format = match image::guess_format(reader.fill_buf().map_err(original_error)?) {
        Ok(ImageFormat::Jpeg) => "JPEG",
        Ok(ImageFormat::Png) => "PNG",
        Ok(ImageFormat::WebP) => "WebP",
        _ => return Err("照片原件格式无法识别".into()),
    };
    let (exif, exif_read_failed) = match read_exif(&mut reader) {
        Ok(data) => (Some(data), false),
        Err(exif::Error::NotFound(_)) => (None, false),
        Err(exif::Error::Io(error)) => return Err(original_error(error)),
        Err(_) => (None, true),
    };
    let field = |tag| Some(&exif.as_ref()?.get_field(tag, In::PRIMARY)?.value);
    let name = |tag| match field(tag)? {
        Value::Ascii(values) => {
            let value = String::from_utf8_lossy(values.first()?);
            let value = value.trim_matches(|ch: char| ch.is_whitespace() || ch.is_control());
            (!value.is_empty()).then(|| value.to_owned())
        }
        _ => None,
    };
    let uint = |tag| field(tag)?.get_uint(0);
    let positive_uint = |tag| uint(tag).filter(|value| *value > 0);
    let rational = |tag| {
        let value = match field(tag)? {
            Value::Rational(values) => values.first()?.to_f64(),
            Value::SRational(values) => values.first()?.to_f64(),
            _ => return None,
        };
        value.is_finite().then_some(value)
    };
    let positive_rational = |tag| rational(tag).filter(|value| *value > 0.0);
    let iso = positive_uint(Tag::PhotographicSensitivity)
        .filter(|value| *value != u32::from(u16::MAX))
        .or_else(|| positive_uint(Tag::ISOSpeed))
        .or_else(|| positive_uint(Tag::RecommendedExposureIndex))
        .or_else(|| positive_uint(Tag::StandardOutputSensitivity));
    let exposure_mode = match uint(Tag::ExposureMode) {
        Some(0) => Some("auto"),
        Some(1) => Some("manual"),
        Some(2) => Some("autoBracket"),
        _ => None,
    };
    let metering_mode = match uint(Tag::MeteringMode) {
        Some(1) => Some("average"),
        Some(2) => Some("centerWeightedAverage"),
        Some(3) => Some("spot"),
        Some(4) => Some("multiSpot"),
        Some(5) => Some("pattern"),
        Some(6) => Some("partial"),
        _ => None,
    };
    let white_balance = match uint(Tag::WhiteBalance) {
        Some(0) => Some("auto"),
        Some(1) => Some("manual"),
        _ => None,
    };
    // Exif Flash 的 bit 0 表示闪光是否触发，bit 5 表示没有闪光功能。
    let flash_fired = uint(Tag::Flash)
        .filter(|bits| bits & 0x20 == 0 && bits & !0x7f == 0)
        .map(|bits| bits & 1 != 0);

    Ok(PhotoMetadata {
        camera: equipment_name(name(Tag::Make), name(Tag::Model)),
        lens: name(Tag::LensModel).or_else(|| name(Tag::LensMake)),
        focal_length_mm: positive_rational(Tag::FocalLength),
        focal_length_35mm: positive_uint(Tag::FocalLengthIn35mmFilm),
        aperture: positive_rational(Tag::FNumber),
        exposure_seconds: positive_rational(Tag::ExposureTime),
        iso,
        exposure_compensation_ev: rational(Tag::ExposureBiasValue),
        exposure_mode,
        metering_mode,
        white_balance,
        flash_fired,
        exif_read_failed,
        file_size_bytes: info.len(),
        file_format,
    })
}

fn read(
    store: &Store,
    photo_id: &str,
    expected_original_path: &str,
) -> Result<PhotoMetadata, String> {
    const STALE_SOURCE: &str = "图库或照片原件已更新，请重新打开照片信息";
    let (root, path, original) = source(store, photo_id)?;
    if path != expected_original_path {
        return Err(STALE_SOURCE.into());
    }
    let details = read_original(original.open()?)?;
    if source(store, photo_id)? != (root, path, original) {
        return Err(STALE_SOURCE.into());
    }
    Ok(details)
}

#[tauri::command]
pub async fn read_photo_metadata(
    app: tauri::AppHandle,
    photo_id: String,
    expected_original_path: String,
) -> Result<PhotoMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(&app.state::<Store>(), &photo_id, &expected_original_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::snapshot, photos};
    use exif::{experimental::Writer, Field};
    use image::{Rgb, RgbImage};
    use serde_json::{json, to_value};
    use std::path::Path;
    use std::{fs, io::Cursor};

    fn write_exif_jpeg(path: &Path, tiff: &[u8]) -> Vec<u8> {
        RgbImage::from_pixel(8, 10, Rgb([32, 80, 120]))
            .save_with_format(path, ImageFormat::Jpeg)
            .unwrap();
        let jpeg = fs::read(path).unwrap();
        let mut original = jpeg[..2].to_vec();
        original.extend_from_slice(&[0xff, 0xe1]);
        original.extend_from_slice(&((tiff.len() + 8) as u16).to_be_bytes());
        original.extend_from_slice(b"Exif\0\0");
        original.extend_from_slice(tiff);
        original.extend_from_slice(&jpeg[2..]);
        fs::write(path, &original).unwrap();
        original
    }

    #[test]
    fn reads_managed_exif_and_file_details_without_overriding_library_fields() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("library")).unwrap();
        let source = temp.path().join("original.png");
        let tags = [
            (Tag::Make, Value::Ascii(vec![b"NIKON CORPORATION".to_vec()])),
            (Tag::Model, Value::Ascii(vec![b"NIKON Z 8".to_vec()])),
            (Tag::LensMake, Value::Ascii(vec![b"NIKON".to_vec()])),
            (
                Tag::LensModel,
                Value::Ascii(vec![b"NIKKOR Z 35mm".to_vec()]),
            ),
            (Tag::FocalLength, Value::Rational(vec![(35, 1).into()])),
            (Tag::FocalLengthIn35mmFilm, Value::Short(vec![53])),
            (Tag::FNumber, Value::Rational(vec![(28, 10).into()])),
            (Tag::ExposureTime, Value::Rational(vec![(1, 250).into()])),
            (Tag::PhotographicSensitivity, Value::Short(vec![65535])),
            (Tag::ISOSpeed, Value::Long(vec![102400])),
            (
                Tag::ExposureBiasValue,
                Value::SRational(vec![(-1, 3).into()]),
            ),
            (Tag::ExposureMode, Value::Short(vec![2])),
            (Tag::MeteringMode, Value::Short(vec![5])),
            (Tag::WhiteBalance, Value::Short(vec![0])),
            (Tag::Flash, Value::Short(vec![0])),
            (
                Tag::DateTimeOriginal,
                Value::Ascii(vec![b"2020:07:16 08:30:00".to_vec()]),
            ),
        ];
        let fields = tags.map(|(tag, value)| Field {
            tag,
            ifd_num: In::PRIMARY,
            value,
        });
        let mut writer = Writer::new();
        for field in &fields {
            writer.push_field(field);
        }
        let mut tiff = Cursor::new(Vec::new());
        writer.write(&mut tiff, true).unwrap();
        let original = write_exif_jpeg(&source, tiff.get_ref());

        let imported = photos::import(
            &store,
            vec![source.to_string_lossy().into_owned()],
            "work",
            None,
        )
        .unwrap();
        assert!(imported.failures.is_empty());
        let photo = &imported.snapshot.photos[0];
        assert_eq!(photo.captured_at.as_deref(), Some("2020-07-16T08:30:00"));
        photos::update(
            &mut store.connection.lock().unwrap(),
            &photo.id,
            json!({"capturedAt": null, "location": "青岛"}),
        )
        .unwrap();
        fs::remove_file(source).unwrap();

        let details = read(&store, &photo.id, &photo.original_path).unwrap();
        assert_eq!(
            to_value(details).unwrap(),
            json!({
                "camera": "NIKON Z 8",
                "lens": "NIKKOR Z 35mm",
                "focalLengthMm": 35.0,
                "focalLength35mm": 53,
                "aperture": 2.8,
                "exposureSeconds": 0.004,
                "iso": 102400,
                "exposureCompensationEv": -1.0 / 3.0,
                "exposureMode": "autoBracket",
                "meteringMode": "pattern",
                "whiteBalance": "auto",
                "flashFired": false,
                "exifReadFailed": false,
                "fileSizeBytes": original.len(),
                "fileFormat": "JPEG",
            })
        );
        assert_eq!(fs::read(&photo.original_path).unwrap(), original);
        let current = snapshot(&store.connection.lock().unwrap()).unwrap();
        assert_eq!(current.photos[0].captured_at, None);
        assert_eq!(current.photos[0].location, "青岛");
    }

    #[test]
    fn reads_exif_free_replacement_only_when_the_revision_matches() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("library")).unwrap();
        let old_path = temp.path().join("old.png");
        let new_path = temp.path().join("new.webp");
        let image = RgbImage::from_pixel(8, 10, Rgb([32, 80, 120]));
        image.save(&old_path).unwrap();
        image.save(&new_path).unwrap();
        let imported = photos::import(
            &store,
            vec![old_path.to_string_lossy().into_owned()],
            "work",
            None,
        )
        .unwrap();
        let photo = &imported.snapshot.photos[0];
        let replacement = photos::relink(&store, &photo.id, &new_path).unwrap();
        let revised = &replacement.photos[0];
        assert!(read(&store, &photo.id, &photo.original_path).is_err());
        assert!(read(&store, "unknown-id", &revised.original_path).is_err());
        assert!(read(&store, &photo.id, new_path.to_str().unwrap()).is_err());
        let conn = store.connection.lock().unwrap();
        assert!(
            crate::work_directory::original(&conn, &photo.id, new_path.to_str().unwrap())
                .unwrap()
                .open()
                .is_err()
        );
        drop(conn);
        let details = read(&store, &photo.id, &revised.original_path).unwrap();
        assert_eq!(details.camera, None);
        assert_eq!(details.iso, None);
        assert!(!details.exif_read_failed);
        assert_eq!(details.file_format, "WebP");
        assert_eq!(
            details.file_size_bytes,
            fs::metadata(new_path).unwrap().len()
        );

        fs::remove_file(&revised.original_path).unwrap();
        assert_eq!(
            read(&store, &photo.id, &revised.original_path).unwrap_err(),
            "照片原件缺失，请重新定位照片"
        );
    }

    #[test]
    fn damaged_exif_keeps_available_file_information() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path().join("library")).unwrap();
        let source = temp.path().join("damaged-exif.jpg");
        let original = write_exif_jpeg(&source, b"invalid TIFF");
        let imported = photos::import(
            &store,
            vec![source.to_string_lossy().into_owned()],
            "work",
            None,
        )
        .unwrap();
        assert!(imported.failures.is_empty());
        let photo = &imported.snapshot.photos[0];
        let details = read(&store, &photo.id, &photo.original_path).unwrap();
        assert!(details.exif_read_failed);
        assert_eq!(details.camera, None);
        assert_eq!(details.file_format, "JPEG");
        assert_eq!(details.file_size_bytes, original.len() as u64);
    }
}

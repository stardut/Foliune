use crate::photos::THUMBNAIL_MAX_EDGE;
use std::{
    ffi::{c_int, c_void},
    fs,
    io::{BufReader, Read},
    path::Path,
    ptr::NonNull,
    slice,
};
use zune_jpeg::{zune_core::options::DecoderOptions, JpegDecoder};

extern "C" {
    fn foliune_prepare_jpeg(
        bytes: *const u8,
        len: usize,
        width: u32,
        height: u32,
        orientation: u32,
        max_edge: u32,
        output: *mut *const c_void,
    ) -> c_int;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFRelease(data: *const c_void);
}

pub(super) struct PreparedJpeg {
    pub dimensions: (u32, u32),
    encoded: NonNull<c_void>,
}

impl PreparedJpeg {
    pub fn save(&self, path: &Path) -> Result<(), String> {
        // SAFETY: the bridge returns a retained, nonempty CFData on success.
        // Its backing bytes stay valid until this PreparedJpeg is dropped.
        let bytes = unsafe {
            let data = self.encoded.as_ptr();
            slice::from_raw_parts(CFDataGetBytePtr(data), CFDataGetLength(data) as usize)
        };
        fs::write(path, bytes).map_err(|e| format!("生成缩略图失败：{e}"))
    }
}

impl Drop for PreparedJpeg {
    fn drop(&mut self) {
        // SAFETY: each PreparedJpeg owns exactly one CFData reference.
        unsafe { CFRelease(self.encoded.as_ptr()) };
    }
}

pub(super) fn prepare(
    mut reader: BufReader<fs::File>,
    orientation: u32,
) -> Result<PreparedJpeg, String> {
    let too_large = "照片解码失败：JPEG 超出内存限制";
    let len = reader
        .get_ref()
        .metadata()
        .map_err(|e| e.to_string())?
        .len();
    // Bound the compressed input separately from the existing decoded-image limit.
    image::Limits::default()
        .reserve(len)
        .map_err(|_| too_large)?;
    let len = usize::try_from(len).map_err(|_| too_large)?;
    let mut bytes = Vec::new();
    bytes.try_reserve_exact(len).map_err(|_| too_large)?;
    bytes.resize(len, 0);
    reader.read_exact(&mut bytes).map_err(|e| e.to_string())?;

    let (width, height) = checked_dimensions(&bytes)?;
    let dimensions = if (5..=8).contains(&orientation) {
        (height, width)
    } else {
        (width, height)
    };
    let mut output = std::ptr::null();
    // SAFETY: Image I/O reads the borrowed bytes synchronously, and the bridge
    // releases all input references before returning. The output pointer is writable.
    let result = unsafe {
        foliune_prepare_jpeg(
            bytes.as_ptr(),
            bytes.len(),
            width,
            height,
            orientation,
            THUMBNAIL_MAX_EDGE,
            &mut output,
        )
    };
    match result {
        0 => NonNull::new(output.cast_mut())
            .map(|encoded| PreparedJpeg {
                dimensions,
                encoded,
            })
            .ok_or_else(|| "生成缩略图失败：Image I/O 未返回 JPEG".into()),
        1 => Err("照片解码失败：Image I/O 无法完整解码 JPEG".into()),
        _ => Err("生成缩略图失败：Image I/O 无法生成 JPEG".into()),
    }
}

fn checked_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    // Match the JPEG header and decoded-payload checks in image's current adapter.
    // Image I/O manages its own backing stores, stride and progressive scratch space.
    let options = DecoderOptions::default()
        .set_strict_mode(false)
        .set_max_width(usize::MAX)
        .set_max_height(usize::MAX);
    let mut decoder = JpegDecoder::new_with_options(bytes, options);
    decoder
        .decode_headers()
        .map_err(|e| format!("照片解码失败：{e}"))?;
    let info = decoder.info().ok_or("照片解码失败：JPEG 缺少主图尺寸")?;
    let (width, height) = (u32::from(info.width), u32::from(info.height));
    let color = if info.components == 1 {
        image::ColorType::L8
    } else {
        image::ColorType::Rgb8
    };
    image::Limits::default()
        .reserve_buffer(width, height, color)
        .map_err(|e| format!("照片解码失败：{e}"))?;
    if info.sof.is_progressive() && !has_first_scan_boundary(bytes) {
        return Err("照片解码失败：渐进 JPEG 缺少首个扫描结束标记".into());
    }
    Ok((width, height))
}

fn has_first_scan_boundary(bytes: &[u8]) -> bool {
    // Follow top-level segment lengths to skip EXIF's embedded JPEG and other APP data.
    let mut rest = &bytes[2..];
    while let Some(prefix) = rest.iter().position(|&byte| byte == 0xff) {
        rest = &rest[prefix + 1..];
        let Some(tag_index) = rest.iter().position(|&byte| byte != 0xff && byte != 0) else {
            return false;
        };
        let tag = rest[tag_index];
        rest = &rest[tag_index + 1..];
        let [high, low, ..] = rest else { return false };
        let length = usize::from(u16::from_be_bytes([*high, *low]));
        if length < 2 || length > rest.len() {
            return false;
        }
        rest = &rest[length..];
        if tag == 0xda {
            // A stuffed FF or restart marker stays inside the scan. A marker boundary
            // catches early truncation without claiming full JPEG integrity.
            return rest
                .windows(2)
                .any(|pair| pair[0] == 0xff && matches!(pair[1], 0xc0..=0xcf | 0xd9..=0xfe));
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use exif::{In, Tag};
    use image::{Rgb, RgbImage};

    #[test]
    fn all_exif_directions_preserve_corners_and_tag_srgb_without_upscaling() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("original.jpg");
        let path = temp.path().join("thumbnail.jpg");
        let colors = [[210, 40, 30], [20, 200, 45], [25, 50, 215], [240, 220, 25]];
        RgbImage::from_fn(48, 32, |x, y| {
            Rgb(colors[usize::from(x >= 24) + 2 * usize::from(y >= 16)])
        })
        .save(&source)
        .unwrap();
        // Corner order is top-left, top-right, bottom-left, bottom-right.
        let expected = [
            [0, 1, 2, 3],
            [1, 0, 3, 2],
            [3, 2, 1, 0],
            [2, 3, 0, 1],
            [0, 2, 1, 3],
            [2, 0, 3, 1],
            [3, 1, 2, 0],
            [1, 3, 0, 2],
        ];
        for (index, corners) in expected.into_iter().enumerate() {
            let orientation = (index + 1) as u32;
            let dimensions = if orientation < 5 { (48, 32) } else { (32, 48) };
            let thumbnail = prepare(
                BufReader::new(fs::File::open(&source).unwrap()),
                orientation,
            )
            .unwrap();
            assert_eq!(thumbnail.dimensions, dimensions);
            thumbnail.save(&path).unwrap();
            let output = image::open(&path).unwrap().to_rgb8();
            assert_eq!(output.dimensions(), dimensions);
            let (w, h) = dimensions;
            for ((x, y), color) in [(5, 5), (w - 6, 5), (5, h - 6), (w - 6, h - 6)]
                .into_iter()
                .zip(corners)
            {
                let pixel = output.get_pixel(x, y).0;
                assert!(
                    pixel
                        .into_iter()
                        .zip(colors[color])
                        .all(|(a, b)| a.abs_diff(b) <= 8),
                    "orientation {orientation}, pixel ({x}, {y}): {pixel:?}"
                );
            }
            let exif = crate::photo_metadata::read_exif(&mut BufReader::new(
                fs::File::open(&path).unwrap(),
            ))
            .unwrap();
            assert_eq!(
                exif.get_field(Tag::ColorSpace, In::PRIMARY)
                    .unwrap()
                    .value
                    .get_uint(0),
                Some(1)
            );
            assert!(exif.get_field(Tag::Orientation, In::PRIMARY).is_none());
        }
    }

    #[test]
    fn a_thin_jpeg_keeps_one_pixel_after_scaling_and_rotating() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("original.jpg");
        let path = temp.path().join("thumbnail.jpg");
        RgbImage::from_pixel(2049, 1, Rgb([100, 50, 80]))
            .save(&source)
            .unwrap();
        let thumbnail = prepare(BufReader::new(fs::File::open(&source).unwrap()), 6).unwrap();
        assert_eq!(thumbnail.dimensions, (1, 2049));
        thumbnail.save(&path).unwrap();
        assert_eq!(
            image::image_dimensions(&path).unwrap(),
            (1, THUMBNAIL_MAX_EDGE)
        );
    }

    #[test]
    fn a_progressive_scan_must_reach_a_top_level_marker() {
        let mut bytes = vec![
            0xff, 0xd8, // SOI
            0xff, 0xe1, 0x00, 0x08, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9, // APP1 data
            0xff, 0xda, 0x00, 0x02, // first scan header (its contents are already validated)
            0xff, 0x00, 0x01, 0xff, 0xd0, 0x02, // scan payload, stuffing and restart
        ];
        assert!(!has_first_scan_boundary(&bytes));
        bytes.extend([0xff, 0xc4]);
        assert!(has_first_scan_boundary(&bytes));
    }

    #[test]
    fn the_existing_decoded_payload_limit_is_checked_from_the_jpeg_header() {
        let mut jpeg = Vec::new();
        RgbImage::from_pixel(32, 24, Rgb([100, 50, 80]))
            .write_to(
                &mut std::io::Cursor::new(&mut jpeg),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        assert_eq!(checked_dimensions(&jpeg).unwrap(), (32, 24));
        let sof = jpeg
            .windows(2)
            .position(|pair| pair == [0xff, 0xc0])
            .unwrap();
        jpeg[sof + 5..sof + 9].fill(0xff);
        assert!(checked_dimensions(&jpeg).unwrap_err().contains("Memory"));
    }
}

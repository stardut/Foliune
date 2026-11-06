use crate::{book_layout, books, db::Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::Connection;
use std::{
    fs,
    io::{BufWriter, Write},
    path::Path,
};
use tauri::Manager;

pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn document<W: Write>(
    conn: &Connection,
    book_id: &str,
    version_id: &str,
    output: &mut W,
) -> Result<(), String> {
    let detail = books::get(conn, book_id)?;
    if detail.book.current_version_id != version_id {
        return Err("画册内容已更改，请重新打开后导出".into());
    }
    let [version] = detail.versions;
    book_layout::validate(conn, &version.input)?;
    writeln!(output, "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>{}</style></head><body><header><h1>{}</h1><p>{} · {} 页</p><button onclick=\"document.body.classList.toggle('spread')\">切换单页 / 双页</button></header><main>", escape(&detail.book.title), STYLE, escape(&detail.book.title), escape(&version.input.label), version.input.pages.len()).map_err(|e|e.to_string())?;
    for (index, page) in version.input.pages.iter().enumerate() {
        writeln!(output,"<section class=\"book-page\" id=\"page-{}\" style=\"aspect-ratio:{}/{}\" aria-label=\"第 {} 页\">",index+1,version.input.page_width,version.input.page_height,index+1).map_err(|e|e.to_string())?;
        for item in &page.items {
            let (path, name): (String, String) = conn
                .query_row(
                    "SELECT original_path,title FROM photos WHERE id=?1",
                    [&item.photo_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            let bytes = crate::work_directory::original(conn, &item.photo_id, &path)?
                .read()
                .map_err(|e| format!("原图缺失或无法读取，不能导出：{name}（{e}）"))?;
            let mime = match image::guess_format(&bytes)
                .map_err(|e| format!("原图格式无效：{name}（{e}）"))?
            {
                image::ImageFormat::Jpeg => "image/jpeg",
                image::ImageFormat::Png => "image/png",
                image::ImageFormat::WebP => "image/webp",
                _ => return Err(format!("原图格式不支持：{name}")),
            };
            writeln!(output,"<img alt=\"{}\" src=\"data:{};base64,{}\" style=\"left:{}%;top:{}%;width:{}%;height:{}%;object-fit:{};object-position:{}% {}%\">",escape(&name),mime,STANDARD.encode(bytes),item.x,item.y,item.width,item.height,item.fit,item.crop_x,item.crop_y).map_err(|e|e.to_string())?;
        }
        writeln!(
            output,
            "<h2>{}</h2><p class=\"caption\">{}</p><span class=\"page-number\">{}</span></section>",
            escape(&page.title),
            escape(&page.caption),
            index + 1
        )
        .map_err(|e| e.to_string())?;
    }
    write!(output,"</main><script>document.addEventListener('keydown',e=>{{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const p=[...document.querySelectorAll('.book-page')];const i=p.findIndex(x=>x.getBoundingClientRect().bottom>innerHeight*.35);p[Math.max(0,Math.min(p.length-1,i+(e.key==='ArrowRight'?1:-1)))].scrollIntoView({{behavior:'smooth',block:'center'}});e.preventDefault()}})</script></body></html>").map_err(|e|e.to_string())
}

pub fn export(
    conn: &Connection,
    book_id: &str,
    version_id: &str,
    path: &Path,
) -> Result<(), String> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.eq_ignore_ascii_case("html"))
        != Some(true)
    {
        return Err("请选择 .html 文件路径".into());
    }
    let parent = path.parent().ok_or("导出目录无效")?;
    let temp = parent.join(format!(".foliune-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        document(conn, book_id, version_id, &mut writer)?;
        writer.flush().map_err(|e| e.to_string())?;
        writer.get_ref().sync_all().map_err(|e| e.to_string())?;
        drop(writer);
        fs::rename(&temp, path).map_err(|e| format!("保存导出文件失败：{e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[tauri::command]
pub async fn books_export(
    app: tauri::AppHandle,
    book_id: String,
    version_id: String,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        export(&conn, &book_id, &version_id, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

const STYLE: &str = "*{box-sizing:border-box}body{margin:0;background:#e9e8e3;color:#242422;font:15px system-ui,sans-serif}header{text-align:center;padding:40px 20px}h1{font-family:Georgia,serif;font-weight:400}button{padding:10px 18px;background:white;border:1px solid #bbb;border-radius:5px;cursor:pointer}main{max-width:1100px;margin:auto;padding:0 24px 60px;display:grid;gap:30px}.spread main{max-width:1800px;grid-template-columns:1fr 1fr;gap:12px}.book-page{position:relative;container-type:inline-size;width:100%;background:#fff;overflow:hidden;box-shadow:0 4px 24px #0001}.book-page img{position:absolute;display:block}.book-page h2{position:absolute;left:5%;right:5%;top:1%;margin:0;font-size:1.8cqw;font-weight:400;white-space:pre-wrap;text-shadow:0 1px 4px #fffc}.caption{position:absolute;left:5%;right:5%;bottom:3%;margin:0;font-size:1.2cqw;white-space:pre-wrap;text-shadow:0 1px 4px #fffc}.page-number{position:absolute;right:2%;bottom:1%;font-size:10px;color:#888}@media(max-width:650px){.spread main{grid-template-columns:1fr}}@media print{body{background:white}header{display:none}main,.spread main{display:block;padding:0}.book-page{break-after:page;box-shadow:none}}";

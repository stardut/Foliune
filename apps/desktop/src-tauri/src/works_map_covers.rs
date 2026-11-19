use crate::{db, locale::tr};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

pub(crate) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS works_map_region_covers (
           region_id TEXT PRIMARY KEY NOT NULL,
           photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE
         );",
    )
    .map_err(|error| error.to_string())
}

// Use the same build-generated atlas directory as the shooting-region CLI.
fn region_ids() -> Result<HashSet<String>, String> {
    let labels: Vec<[String; 4]> = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/shooting-region-labels.json"
    )))
    .map_err(|error| error.to_string())?;
    Ok(labels.into_iter().map(|[id, ..]| id).collect())
}

pub(crate) fn read(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut statement = conn
        .prepare("SELECT region_id,photo_id FROM works_map_region_covers")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<_, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn save(
    conn: &mut Connection,
    region_id: &str,
    photo_id: Option<&str>,
) -> Result<(), String> {
    if !region_ids()?.contains(region_id) {
        return Err(tr("地图封面的地区无效", "Invalid map cover region").into());
    }
    db::write(conn, |conn| {
        if let Some(photo_id) = photo_id {
            let valid: bool = conn
                .query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM photos p JOIN memberships m ON m.photo_id=p.id
                       JOIN groups g ON g.id=m.group_id
                       WHERE p.id=?1 AND p.library='work' AND p.hidden_after_album_delete=0
                         AND m.status='active' AND g.library='work'
                     )",
                    [photo_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if !valid {
                return Err(tr(
                    "请选择作品相簿中的有效照片作为地图封面",
                    "Choose an active photo from a Works album for the map cover",
                )
                .into());
            }
            conn.execute(
                "INSERT INTO works_map_region_covers(region_id,photo_id) VALUES(?1,?2)
                 ON CONFLICT(region_id) DO UPDATE SET photo_id=excluded.photo_id",
                params![region_id, photo_id],
            )
            .map_err(|error| error.to_string())?;
        } else {
            conn.execute(
                "DELETE FROM works_map_region_covers WHERE region_id=?1",
                [region_id],
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    })
}

pub(crate) fn validate_archive(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT c.region_id,p.library FROM works_map_region_covers c
             LEFT JOIN photos p ON p.id=c.photo_id",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let region: String = row.get(0).map_err(|error| error.to_string())?;
        let library: Option<String> = row.get(1).map_err(|error| error.to_string())?;
        // Discarding a membership or hiding its photo is valid. The map ignores
        // an inactive cover; this preference never keeps a photo alive.
        // Historical region IDs may outlive the bundled atlas directory.
        if !crate::photos::valid_location_region_id(&region) || library.as_deref() != Some("work") {
            return Err(tr(
                "地图封面的地区或照片引用无效",
                "A map cover region or photo reference is invalid",
            )
            .into());
        }
    }
    Ok(())
}

pub(crate) fn merge_archive(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "INSERT INTO main.works_map_region_covers(region_id,photo_id)
         SELECT c.region_id,c.photo_id FROM restore_archive.works_map_region_covers c
         JOIN main.photos p ON p.id=c.photo_id AND p.library='work' AND p.hidden_after_album_delete=0
         WHERE NOT EXISTS (
           SELECT 1 FROM main.works_map_region_covers current WHERE current.region_id=c.region_id
         ) AND EXISTS (
           SELECT 1 FROM main.memberships m JOIN main.groups g ON g.id=m.group_id
           WHERE m.photo_id=c.photo_id AND m.status='active' AND g.library='work'
         );",
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "works_map_covers_tests.rs"]
mod tests;

use super::{
    source::{
        fingerprint, stat_signature, BoundAvailability, BoundSource, RootDirectory,
        BOUND_SOURCE_COLUMNS,
    },
    LOCATOR_PREFIX,
};
use crate::db::{self, Store};
use rusqlite::{params, Connection, OptionalExtension};
use same_file::Handle;
use std::{
    fs::File,
    path::Path,
    sync::mpsc::Receiver,
    time::{Duration, Instant},
};

const AVAILABILITY_INTERVAL: Duration = Duration::from_millis(500);

pub(super) fn init_availability(conn: &Connection) -> Result<(), String> {
    // This cache belongs to the open connection. Backups carry the verified signature only.
    conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS work_directory_unavailable (
            photo_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, root_path TEXT NOT NULL,
            folder TEXT NOT NULL, file_name TEXT NOT NULL, sha256 TEXT NOT NULL,
            indexed_signature TEXT, offline INTEGER NOT NULL, rejected_signature TEXT
        );",
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn copy_availability(source: &Connection, target: &Connection) -> Result<(), String> {
    init_availability(target)?;
    let mut source = source
        .prepare(
            "SELECT photo_id,root_id,root_path,folder,file_name,sha256,
        indexed_signature,offline,rejected_signature FROM temp.work_directory_unavailable",
        )
        .map_err(|error| error.to_string())?;
    let mut insert = target
        .prepare("INSERT INTO temp.work_directory_unavailable VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)")
        .map_err(|error| error.to_string())?;
    let mut rows = source.query([]).map_err(|error| error.to_string())?;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let values = (0..9)
            .map(|column| row.get::<_, rusqlite::types::Value>(column))
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        insert
            .execute(rusqlite::params_from_iter(values))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Unavailable {
    offline: bool,
    rejected_signature: Option<String>,
}

impl Unavailable {
    fn availability(&self) -> BoundAvailability {
        if self.offline {
            BoundAvailability::Offline
        } else {
            BoundAvailability::Missing
        }
    }

    fn missing() -> Self {
        Self {
            offline: false,
            rejected_signature: None,
        }
    }
}

pub(super) fn cached_availability(
    conn: &Connection,
    photo_id: &str,
    source: &BoundSource,
) -> Result<BoundAvailability, String> {
    let offline: Option<bool> = conn
        .prepare_cached(
            "SELECT offline FROM temp.work_directory_unavailable
             WHERE photo_id=?1 AND root_id=?2 AND root_path=?3 AND folder=?4
               AND file_name=?5 AND sha256=?6 AND indexed_signature IS ?7",
        )
        .and_then(|mut statement| {
            statement.query_row(
                params![
                    photo_id,
                    source.root.id,
                    source.root.path.to_str(),
                    source.folder,
                    source.file_name,
                    source.sha256,
                    source.stat_signature
                ],
                |row| row.get(0),
            )
        })
        .optional()
        .map_err(|error| error.to_string())?;
    // An indexed photo can show its cached image while its current source is checked.
    Ok(match offline {
        Some(true) => BoundAvailability::Offline,
        Some(false) => BoundAvailability::Missing,
        None => BoundAvailability::Available,
    })
}

struct IndexedPhoto {
    id: String,
    source: BoundSource,
    unavailable: Option<Unavailable>,
}

fn indexed_photos(conn: &Connection) -> Result<Vec<IndexedPhoto>, String> {
    let mut statement = conn.prepare_cached(&format!(
        "SELECT {BOUND_SOURCE_COLUMNS},p.photo_id,u.offline,u.rejected_signature
         FROM work_directory_photos p JOIN work_directory_roots r ON r.id=p.root_id
         JOIN photos f ON f.id=p.photo_id AND f.original_path=?1 || p.photo_id
         LEFT JOIN temp.work_directory_unavailable u ON u.photo_id=p.photo_id
           AND u.root_id=r.id AND u.root_path=r.path AND u.folder=p.folder
           AND u.file_name=p.file_name AND u.sha256=p.sha256 AND u.indexed_signature IS p.stat_signature
         WHERE r.authorized=1 ORDER BY r.id,p.folder,p.file_name"
    )).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([LOCATOR_PREFIX], |row| {
            let offline: Option<bool> = row.get(8)?;
            let rejected_signature = row.get(9)?;
            Ok(IndexedPhoto {
                id: row.get(7)?,
                source: BoundSource::from_row(row)?,
                unavailable: offline.map(|offline| Unavailable {
                    offline,
                    rejected_signature,
                }),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

enum Inspection {
    Known(Observation),
    NeedsHash(String),
}

enum Observation {
    Available { new_signature: Option<String> },
    Unavailable(Unavailable),
}

impl Observation {
    fn changes(&self, photo: &IndexedPhoto) -> bool {
        match self {
            Self::Available { new_signature } => {
                new_signature.is_some() || photo.unavailable.is_some()
            }
            Self::Unavailable(unavailable) => Some(unavailable) != photo.unavailable.as_ref(),
        }
    }
}

impl IndexedPhoto {
    fn inspect(&self, directory: Option<&RootDirectory>) -> Inspection {
        let Some(directory) = directory else {
            return Inspection::Known(Observation::Unavailable(Unavailable {
                offline: true,
                rejected_signature: None,
            }));
        };
        let Some(signature) = directory
            .photo(&self.source.folder, &self.source.file_name)
            .ok()
            .and_then(|file| stat_signature(&file))
        else {
            return Inspection::Known(Observation::Unavailable(Unavailable::missing()));
        };
        if self
            .source
            .expected_size()
            .is_some_and(|size| super::source::expected_size(Some(&signature)) != Some(size))
        {
            return Inspection::Known(Observation::Unavailable(Unavailable::missing()));
        }
        if self.source.stat_signature.as_ref() == Some(&signature) {
            return Inspection::Known(Observation::Available {
                new_signature: None,
            });
        }
        // The Unix signature includes device and inode as well as timestamps.
        if cfg!(unix)
            && self
                .unavailable
                .as_ref()
                .and_then(|result| result.rejected_signature.as_ref())
                == Some(&signature)
        {
            return Inspection::Known(Observation::Unavailable(Unavailable {
                offline: false,
                rejected_signature: Some(signature),
            }));
        }
        Inspection::NeedsHash(signature)
    }

    fn hash(
        &self,
        signature: String,
        digest: impl FnOnce(&mut File) -> Result<String, String>,
    ) -> Option<Observation> {
        let open_current = || {
            RootDirectory::open(&self.source.root.path)
                .ok()?
                .photo(&self.source.folder, &self.source.file_name)
                .ok()
        };
        let mut checked = Handle::from_file(open_current()?).ok()?;
        if stat_signature(checked.as_file()).as_ref() != Some(&signature) {
            return None;
        }
        let result = digest(checked.as_file_mut());
        let current = Handle::from_file(open_current()?).ok()?;
        if checked != current
            || stat_signature(checked.as_file()).as_ref() != Some(&signature)
            || stat_signature(current.as_file()).as_ref() != Some(&signature)
        {
            return None;
        }
        Some(match result {
            Ok(actual) if actual == self.source.sha256 => Observation::Available {
                new_signature: Some(signature),
            },
            Ok(_) => Observation::Unavailable(Unavailable {
                offline: false,
                rejected_signature: Some(signature),
            }),
            Err(_) => Observation::Unavailable(Unavailable::missing()),
        })
    }

    fn record(&self, conn: &Connection, observed: Observation) -> Result<bool, String> {
        let (new_signature, unavailable) = match observed {
            Observation::Available { new_signature } => (new_signature, None),
            Observation::Unavailable(unavailable) => (None, Some(unavailable)),
        };
        // Compare the complete source and the previous signature before publishing any result.
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let current = tx
            .prepare_cached(&format!(
                "SELECT {BOUND_SOURCE_COLUMNS}
             FROM work_directory_photos p JOIN work_directory_roots r ON r.id=p.root_id
             JOIN photos f ON f.id=p.photo_id AND f.original_path=?1 || p.photo_id
             WHERE p.photo_id=?2"
            ))
            .and_then(|mut statement| {
                statement.query_row(params![LOCATOR_PREFIX, self.id], BoundSource::from_row)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if current.as_ref() != Some(&self.source) {
            return Ok(false);
        }
        if let Some(signature) = new_signature {
            tx.execute(
                "UPDATE work_directory_photos SET stat_signature=?1 WHERE photo_id=?2",
                params![signature, self.id],
            )
            .map_err(|error| error.to_string())?;
        }
        if let Some(unavailable) = &unavailable {
            tx.execute(
                "INSERT OR REPLACE INTO temp.work_directory_unavailable
                 (photo_id,root_id,root_path,folder,file_name,sha256,indexed_signature,offline,rejected_signature)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![self.id, self.source.root.id, self.source.root.path.to_str(),
                    self.source.folder, self.source.file_name, self.source.sha256,
                    self.source.stat_signature, unavailable.offline, unavailable.rejected_signature],
            ).map_err(|error| error.to_string())?;
        } else if self.unavailable.is_some() {
            tx.execute(
                "DELETE FROM temp.work_directory_unavailable WHERE photo_id=?1",
                [&self.id],
            )
            .map_err(|error| error.to_string())?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        Ok(self.unavailable.as_ref().map(Unavailable::availability)
            != unavailable.as_ref().map(Unavailable::availability))
    }
}

pub(super) fn verify_all(
    store: &Store,
    mut notify: impl FnMut(&Path),
    mut digest: impl FnMut(&mut File) -> Result<String, String>,
) -> Result<(), String> {
    let (library, photos) = {
        let conn = store.connection.lock().map_err(|error| error.to_string())?;
        (db::library_root(&conn)?, indexed_photos(&conn)?)
    };
    let record = |photo: &IndexedPhoto, observed: Observation| {
        if !observed.changes(photo) {
            return Ok(false);
        }
        let conn = store.connection.lock().map_err(|error| error.to_string())?;
        if db::library_root(&conn)? != library {
            return Ok(false);
        }
        photo.record(&conn, observed)
    };
    let mut pending = Vec::new();
    let mut changed = false;
    let mut directories = photos.into_iter().peekable();
    while let Some(first) = directories.peek() {
        let root = first.source.root.clone();
        let directory = RootDirectory::open(&root.path).ok();
        while let Some(mut photo) = directories.next_if(|photo| photo.source.root == root) {
            match photo.inspect(directory.as_ref()) {
                Inspection::Known(observed) => changed |= record(&photo, observed)?,
                Inspection::NeedsHash(signature) => {
                    if photo
                        .unavailable
                        .as_ref()
                        .is_some_and(|state| state.offline)
                        && record(
                            &photo,
                            Observation::Available {
                                new_signature: None,
                            },
                        )?
                    {
                        // The source is reachable again. On-demand reads still verify its hash.
                        photo.unavailable = None;
                        changed = true;
                    }
                    pending.push((photo, signature));
                }
            }
        }
    }
    if changed {
        notify(&library);
    }

    // Publish cheap availability changes before potentially reading a large batch of originals.
    changed = false;
    let mut last_refresh = Instant::now();
    for (photo, signature) in pending {
        if let Some(observed) = photo.hash(signature, &mut digest) {
            changed |= record(&photo, observed)?;
        }
        if changed && last_refresh.elapsed() >= AVAILABILITY_INTERVAL {
            notify(&library);
            changed = false;
            last_refresh = Instant::now();
        }
    }
    if changed {
        notify(&library);
    }
    Ok(())
}

#[cfg(test)]
#[path = "verification_tests.rs"]
mod tests;

pub(super) fn run(store: &Store, pending: Receiver<()>, mut notify: impl FnMut(&Path)) {
    while pending.recv().is_ok() {
        if let Err(error) = verify_all(store, &mut notify, fingerprint) {
            eprintln!("无法校验作品目录原件：{error}");
        }
    }
}

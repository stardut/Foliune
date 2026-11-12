use super::RestoreResult;
use crate::db::{self, Store};
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn validate_data(conn: &Connection) -> Result<(), String> {
    let has_rows = |sql| {
        conn.prepare(sql)
            .and_then(|mut statement| statement.exists([]))
            .map_err(|error| error.to_string())
    };
    if has_rows("PRAGMA foreign_key_check")? {
        return Err("图库数据库引用不完整".into());
    }
    if has_rows(
        "SELECT 1 FROM memberships m
         LEFT JOIN photos p ON p.id=m.photo_id LEFT JOIN groups g ON g.id=m.group_id
         WHERE p.id IS NULL OR g.id IS NULL OR p.hidden_after_album_delete<>0 OR p.library<>g.library
           OR m.status NOT IN ('active','discarded') OR m.position<0
         UNION ALL SELECT 1 FROM groups g JOIN memberships m ON m.group_id=g.id AND m.status='active'
         WHERE g.capacity IS NOT NULL GROUP BY g.id HAVING count(*)>g.capacity",
    )? {
        return Err("相簿的照片关系或容量无效".into());
    }
    if has_rows(
        "SELECT 1 FROM album_covers c
         LEFT JOIN memberships m ON m.group_id=c.group_id AND m.photo_id=c.photo_id
         WHERE m.group_id IS NULL OR typeof(c.offset_x) NOT IN ('real','integer')
           OR typeof(c.offset_y) NOT IN ('real','integer') OR typeof(c.zoom) NOT IN ('real','integer')
           OR c.offset_x NOT BETWEEN 0 AND 1 OR c.offset_y NOT BETWEEN 0 AND 1 OR c.zoom NOT BETWEEN 1 AND 3",
    )? {
        return Err("相簿封面的照片关系或取景范围无效".into());
    }
    crate::books::validate_archive(conn)?;
    crate::model_profiles::validate_all(conn)?;
    crate::social::validate_all(conn)?;
    crate::planning::validate_all(conn)
}

pub(super) fn merge(store: &Store, root: &Path, archive: &Path) -> Result<RestoreResult, String> {
    // Other app operations use this lock. A dedicated connection keeps the attached
    // archive and temporary tables out of the persistent application connection.
    let live = store.connection.lock().map_err(|error| error.to_string())?;
    let mut conn = Connection::open_with_flags(
        root.join("library.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")
        .map_err(|error| error.to_string())?;
    conn.execute("ATTACH DATABASE ?1 AS restore_archive", [archive.to_str()])
        .map_err(|error| error.to_string())?;

    let mut created = Vec::new();
    let result = (|| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let photo_count = copy_photos(&tx, root, &mut created)?;
        let skipped_membership_count = merge_albums(&tx)?;
        let skipped_document_count = merge_documents(&tx)?;
        let unresolved_work_photo_count = merge_work_directory(&tx)?;
        validate_data(&tx).map_err(|error| format!("合并后的图库未通过校验：{error}"))?;
        crate::work_directory::copy_availability(&live, &tx)?;
        let snapshot = db::snapshot(&tx)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(RestoreResult {
            snapshot,
            photo_count,
            skipped_membership_count,
            skipped_document_count,
            unresolved_work_photo_count,
        })
    })();

    if let Err(error) = result {
        let mut errors = vec![error];
        for path in created {
            if let Err(cleanup) = fs::remove_file(path) {
                errors.push(format!("回滚恢复文件失败：{cleanup}"));
            }
        }
        return Err(errors.join("；"));
    }
    result
}

fn copy_photos(
    conn: &Connection,
    root: &Path,
    created: &mut Vec<PathBuf>,
) -> Result<usize, String> {
    conn.execute_batch(
        "CREATE TEMP TABLE restore_photos (
           id TEXT PRIMARY KEY, original_path TEXT NOT NULL, thumbnail_path TEXT NOT NULL
         );",
    )
    .map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT a.id,a.original_path,a.thumbnail_path,a.hidden_after_album_delete
             FROM restore_archive.photos a WHERE NOT EXISTS (SELECT 1 FROM main.photos p WHERE p.id=a.id)",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut insert = conn
        .prepare("INSERT INTO restore_photos(id,original_path,thumbnail_path) VALUES(?1,?2,?3)")
        .map_err(|error| error.to_string())?;
    let mut count = 0;
    for row in rows {
        let (id, original, thumbnail, hidden) = row.map_err(|error| error.to_string())?;
        let original = if crate::local_photo::is_locator(&original)
            || crate::work_directory::is_locator(&original)
        {
            original
        } else {
            copy_file(&original, &root.join("originals"), created)?
        };
        let thumbnail = copy_file(&thumbnail, &root.join("thumbnails"), created)?;
        insert
            .execute(params![id, original, thumbnail])
            .map_err(|error| error.to_string())?;
        count += usize::from(!hidden);
    }
    // Analyses of existing photos may have been invalidated by a local original replacement.
    conn.execute_batch(
        "INSERT INTO main.photos (
           id,library,title,original_name,original_path,thumbnail_path,width,height,tags,annotation,source,
           captured_at,location,project,imported_at,regions,hidden_after_album_delete
         )
         SELECT a.id,a.library,a.title,a.original_name,p.original_path,p.thumbnail_path,a.width,a.height,
           a.tags,a.annotation,a.source,a.captured_at,a.location,a.project,a.imported_at,a.regions,a.hidden_after_album_delete
         FROM restore_archive.photos a JOIN restore_photos p ON p.id=a.id;

         INSERT INTO main.photo_analyses(photo_id,provider,model,text,analyzed_at)
         SELECT a.photo_id,a.provider,a.model,a.text,a.analyzed_at
         FROM restore_archive.photo_analyses a JOIN restore_photos p ON p.id=a.photo_id;

         INSERT INTO main.ai_connection(id,provider,model,vision)
         SELECT a.id,a.provider,a.model,a.vision FROM restore_archive.ai_connection a
         WHERE NOT EXISTS (SELECT 1 FROM main.ai_connection);",
    )
    .map_err(|error| error.to_string())?;
    Ok(count)
}

fn copy_file(source: &str, directory: &Path, created: &mut Vec<PathBuf>) -> Result<String, String> {
    if !fs::symlink_metadata(directory)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_dir()
        || directory
            .canonicalize()
            .map_err(|error| error.to_string())?
            != directory
    {
        return Err("图库文件目录无效".into());
    }
    let mut destination = directory.join(uuid::Uuid::new_v4().to_string());
    if let Some(extension) = Path::new(source).extension() {
        destination.set_extension(extension);
    }
    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut output = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&destination)
        .map_err(|error| format!("创建恢复文件失败：{error}"))?;
    created.push(destination.clone());
    std::io::copy(&mut input, &mut output).map_err(|error| format!("写入恢复文件失败：{error}"))?;
    output.sync_all().map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

fn merge_albums(conn: &Connection) -> Result<usize, String> {
    conn.execute_batch(
        "CREATE TEMP TABLE restore_albums (id TEXT PRIMARY KEY);
         INSERT INTO restore_albums(id)
         SELECT a.id FROM restore_archive.groups a
         WHERE NOT EXISTS (SELECT 1 FROM main.groups g WHERE g.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM main.work_directory_jobs j WHERE j.album_id=a.id);

         INSERT INTO main.groups(id,library,name,description,capacity,created_at)
         SELECT a.id,a.library,a.name,a.description,a.capacity,a.created_at
         FROM restore_archive.groups a JOIN restore_albums n ON n.id=a.id;

         WITH eligible AS (
           SELECT a.*, count(CASE WHEN a.status='active' THEN 1 END) OVER (
             PARTITION BY a.group_id ORDER BY a.position,a.photo_id
           ) AS active_rank
           FROM restore_archive.memberships a
           JOIN main.photos p ON p.id=a.photo_id AND p.hidden_after_album_delete=0
           JOIN main.groups g ON g.id=a.group_id AND g.library=p.library
           WHERE NOT EXISTS (
             SELECT 1 FROM main.memberships m WHERE m.group_id=a.group_id AND m.photo_id=a.photo_id
           )
         ), current AS (
           SELECT group_id,max(position) AS last_position,
             count(CASE WHEN status='active' THEN 1 END) AS active_count
           FROM main.memberships GROUP BY group_id
         ), queued AS (
           SELECT album_id,sum(json_array_length(candidate,'$.fileNames')) AS photo_count
           FROM main.work_directory_jobs GROUP BY album_id
         ), additions AS (
           SELECT e.*,coalesce(c.last_position + row_number() OVER (
             PARTITION BY e.group_id ORDER BY e.position,e.photo_id
           ),e.position) AS next_position
           FROM eligible e JOIN main.groups g ON g.id=e.group_id
           LEFT JOIN current c ON c.group_id=e.group_id
           LEFT JOIN queued q ON q.album_id=e.group_id
           WHERE e.status='discarded' OR g.capacity IS NULL
             OR coalesce(c.active_count,0)+coalesce(q.photo_count,0)+e.active_rank<=g.capacity
         )
         INSERT INTO main.memberships(group_id,photo_id,status,position)
         SELECT group_id,photo_id,status,next_position FROM additions;

         INSERT INTO main.album_covers(group_id,photo_id,offset_x,offset_y,zoom)
         SELECT c.group_id,c.photo_id,c.offset_x,c.offset_y,c.zoom
         FROM restore_archive.album_covers c JOIN restore_albums n ON n.id=c.group_id
         JOIN main.memberships m ON m.group_id=c.group_id AND m.photo_id=c.photo_id;",
    )
    .map_err(|error| format!("恢复相簿关系失败：{error}"))?;
    conn.query_row(
        "SELECT count(*) FROM restore_archive.memberships a WHERE NOT EXISTS (
           SELECT 1 FROM main.memberships m WHERE m.group_id=a.group_id AND m.photo_id=a.photo_id
         )",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn merge_documents(conn: &Connection) -> Result<usize, String> {
    // Ordered children and versions belong to their parent document. Inserting
    // children first lets the queries use the parent's original presence.
    conn.execute_batch(
        "PRAGMA defer_foreign_keys=ON;
         CREATE TEMP TABLE restore_skipped_documents (
           kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(kind,id)
         );
         INSERT INTO restore_skipped_documents(kind,id)
         SELECT 'book',b.id FROM restore_archive.books b
         JOIN restore_archive.book_versions v ON v.id=b.current_version_id
         WHERE NOT EXISTS (SELECT 1 FROM main.books old WHERE old.id=b.id)
           AND EXISTS (
             SELECT 1 FROM json_each(v.data,'$.chapters') c, json_each(c.value,'$.photoIds') i
             JOIN main.photos p ON p.id=i.value AND p.hidden_after_album_delete=1
           )
         UNION ALL
         SELECT 'model',a.id FROM restore_archive.model_profiles a
         WHERE NOT EXISTS (SELECT 1 FROM main.model_profiles old WHERE old.id=a.id)
           AND EXISTS (
             SELECT 1 FROM restore_archive.model_photos r JOIN main.photos p ON p.id=r.photo_id
             WHERE r.model_id=a.id AND p.hidden_after_album_delete=1
           )
         UNION ALL
         SELECT 'social',a.id FROM restore_archive.social_drafts a
         WHERE NOT EXISTS (SELECT 1 FROM main.social_drafts old WHERE old.id=a.id)
           AND EXISTS (
             SELECT 1 FROM restore_archive.social_photos r JOIN main.photos p ON p.id=r.photo_id
             WHERE r.draft_id=a.id AND p.hidden_after_album_delete=1
           )
         UNION ALL
         SELECT 'plan',a.id FROM restore_archive.shoot_plans a
         WHERE NOT EXISTS (SELECT 1 FROM main.shoot_plans old WHERE old.id=a.id)
           AND EXISTS (
             SELECT 1 FROM restore_archive.shoot_plan_photos r JOIN main.photos p ON p.id=r.photo_id
             WHERE r.plan_id=a.id AND p.hidden_after_album_delete=1
           );

         INSERT INTO main.book_versions(id,book_id,created_at,kind,data)
         SELECT a.id,a.book_id,a.created_at,a.kind,a.data FROM restore_archive.book_versions a
         WHERE NOT EXISTS (SELECT 1 FROM main.books b WHERE b.id=a.book_id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='book' AND id=a.book_id);
         INSERT INTO main.books(id,title,current_version_id,created_at,updated_at)
         SELECT a.id,a.title,a.current_version_id,a.created_at,a.updated_at FROM restore_archive.books a
         WHERE NOT EXISTS (SELECT 1 FROM main.books b WHERE b.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='book' AND id=a.id);

         INSERT INTO main.model_photos(model_id,photo_id,position)
         SELECT a.model_id,a.photo_id,a.position FROM restore_archive.model_photos a
         WHERE NOT EXISTS (SELECT 1 FROM main.model_profiles m WHERE m.id=a.model_id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='model' AND id=a.model_id);
         INSERT INTO main.model_profiles (
           id,name,contact,city,tags,tag_options,notes,gender,birthday,height_cm,weight_kg,bust_cm,waist_cm,hips_cm,
           cover_photo_id,created_at,updated_at
         )
         SELECT a.id,a.name,a.contact,a.city,a.tags,a.tag_options,a.notes,a.gender,a.birthday,a.height_cm,
           a.weight_kg,a.bust_cm,a.waist_cm,a.hips_cm,a.cover_photo_id,a.created_at,a.updated_at
         FROM restore_archive.model_profiles a WHERE NOT EXISTS (SELECT 1 FROM main.model_profiles m WHERE m.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='model' AND id=a.id);

         INSERT INTO main.social_photos(draft_id,photo_id,position)
         SELECT a.draft_id,a.photo_id,a.position FROM restore_archive.social_photos a
         WHERE NOT EXISTS (SELECT 1 FROM main.social_drafts d WHERE d.id=a.draft_id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='social' AND id=a.draft_id);
         INSERT INTO main.social_drafts(id,name,platform,display_name,title,body,created_at,updated_at)
         SELECT a.id,a.name,a.platform,a.display_name,a.title,a.body,a.created_at,a.updated_at
         FROM restore_archive.social_drafts a WHERE NOT EXISTS (SELECT 1 FROM main.social_drafts d WHERE d.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='social' AND id=a.id);

         INSERT INTO main.shoot_plan_photos(plan_id,photo_id,position)
         SELECT a.plan_id,a.photo_id,a.position FROM restore_archive.shoot_plan_photos a
         WHERE NOT EXISTS (SELECT 1 FROM main.shoot_plans s WHERE s.id=a.plan_id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='plan' AND id=a.plan_id);
         INSERT INTO main.shoot_plans (
           id,title,concept,shoot_date,location,team,styling,lighting,shot_list,notes,created_at,updated_at,document_json
         )
         SELECT a.id,a.title,a.concept,a.shoot_date,a.location,a.team,a.styling,a.lighting,a.shot_list,a.notes,
           a.created_at,a.updated_at,a.document_json
         FROM restore_archive.shoot_plans a WHERE NOT EXISTS (SELECT 1 FROM main.shoot_plans s WHERE s.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM restore_skipped_documents WHERE kind='plan' AND id=a.id);",
    )
    .map_err(|error| format!("恢复画册、模特、排版或策划失败：{error}"))?;
    conn.query_row(
        "SELECT count(*) FROM restore_skipped_documents",
        [],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

fn merge_work_directory(conn: &Connection) -> Result<usize, String> {
    conn.execute_batch(
        "CREATE TEMP TABLE restore_roots (
           archive_id TEXT PRIMARY KEY, current_id TEXT NOT NULL UNIQUE, is_new INTEGER NOT NULL
         );
         INSERT INTO restore_roots(archive_id,current_id,is_new)
         SELECT a.id,coalesce(p.id,a.id),p.id IS NULL
         FROM restore_archive.work_directory_roots a
         LEFT JOIN main.work_directory_roots p ON p.path=a.path
         WHERE p.id IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM main.work_directory_roots prior WHERE prior.id=a.id
         );

         INSERT INTO main.work_directory_roots(id,path,active,authorized)
         SELECT a.id,a.path,CASE WHEN EXISTS (SELECT 1 FROM main.work_directory_roots WHERE active=1)
           THEN 0 ELSE a.active END,0 FROM restore_archive.work_directory_roots a
         JOIN restore_roots r ON r.archive_id=a.id AND r.is_new=1;

         INSERT INTO main.work_directory_folders(root_id,folder,album_id)
         SELECT r.current_id,a.folder,
           CASE WHEN g.library='work' AND NOT EXISTS (
             SELECT 1 FROM main.work_directory_folders f WHERE f.album_id=a.album_id
           ) THEN a.album_id END
         FROM restore_archive.work_directory_folders a JOIN restore_roots r ON r.archive_id=a.root_id
         LEFT JOIN main.groups g ON g.id=a.album_id
         WHERE NOT EXISTS (
           SELECT 1 FROM main.work_directory_folders f WHERE f.root_id=r.current_id AND f.folder=a.folder
         ) AND NOT EXISTS (
           SELECT 1 FROM main.work_directory_jobs j WHERE j.root_id=r.current_id AND j.folder=a.folder
         );",
    ).map_err(|error| format!("恢复作品目录关系失败：{error}"))?;

    // A changed root path cannot inherit access through its stable ID.
    // Keep current file indexes and ignores for roots with matching paths.
    let unresolved_count = conn
        .execute(
            "UPDATE main.photos SET original_path=?1 WHERE id IN (
           SELECT a.photo_id FROM restore_archive.work_directory_photos a
           LEFT JOIN restore_roots r ON r.archive_id=a.root_id
           JOIN restore_photos n ON n.id=a.photo_id
           WHERE r.current_id IS NULL OR EXISTS (
             SELECT 1 FROM main.work_directory_photos p
             WHERE p.root_id=r.current_id AND p.folder=a.folder AND p.file_name=a.file_name
           ) OR EXISTS (
             SELECT 1 FROM main.work_directory_ignored_files i
             WHERE i.root_id=r.current_id AND i.folder=a.folder AND i.file_name=a.file_name
           ) OR EXISTS (
             SELECT 1 FROM main.work_directory_jobs j WHERE j.root_id=r.current_id AND j.folder=a.folder
           )
         )",
            [crate::local_photo::PREFIX],
        )
        .map_err(|error| format!("保留冲突的作品照片索引失败：{error}"))?;
    conn.execute_batch(
        "INSERT INTO main.work_directory_photos(photo_id,root_id,folder,file_name,sha256,stat_signature)
         SELECT a.photo_id,r.current_id,a.folder,a.file_name,a.sha256,NULL
         FROM restore_archive.work_directory_photos a JOIN restore_roots r ON r.archive_id=a.root_id
         JOIN restore_photos n ON n.id=a.photo_id
         JOIN main.photos p ON p.id=n.id AND p.original_path=n.original_path;

         INSERT INTO main.work_directory_ignored_files(root_id,folder,file_name)
         SELECT r.current_id,a.folder,a.file_name
         FROM restore_archive.work_directory_ignored_files a
         JOIN restore_roots r ON r.archive_id=a.root_id AND r.is_new=1
         WHERE NOT EXISTS (
           SELECT 1 FROM main.work_directory_photos p
           WHERE p.root_id=r.current_id AND p.folder=a.folder AND p.file_name=a.file_name
         );",
    )
    .map_err(|error| format!("恢复作品目录关系失败：{error}"))?;
    Ok(unresolved_count)
}

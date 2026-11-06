mod ai;
mod ai_settings;
mod airdrop;
mod backup;
mod book_export;
mod book_layout;
mod books;
mod collage;
mod content_refs;
mod credentials;
mod curation;
mod db;
mod groups;
mod libraries;
mod link_import;
mod local_photo;
mod model_profiles;
mod models;
mod music;
mod photo_metadata;
mod photos;
mod planning;
mod planning_export;
mod png_export;
mod social;
mod work_directory;

use db::Store;
use models::{GroupInput, Snapshot};
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[tauri::command]
async fn load_snapshot(app: AppHandle) -> Result<Snapshot, String> {
    db::with_connection(app, |conn| db::snapshot(conn)).await
}

#[tauri::command]
async fn import_photos(
    app: AppHandle,
    paths: Vec<String>,
    library: String,
    group_id: Option<String>,
) -> Result<photos::ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        photos::import_local(&store, paths, &library, group_id.as_deref()).map(|(result, _)| result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_group(app: AppHandle, input: GroupInput) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| groups::create(conn, input)).await
}

#[tauri::command]
async fn update_group(app: AppHandle, id: String, patch: Value) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| groups::update(conn, &id, patch)).await
}

#[tauri::command]
async fn delete_group(app: AppHandle, id: String) -> Result<Snapshot, String> {
    work_directory::runtime::delete_group(app, id).await
}

#[tauri::command]
async fn update_photo(app: AppHandle, id: String, patch: Value) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| photos::update(conn, &id, patch)).await
}

#[tauri::command]
async fn add_photos_to_group(
    app: AppHandle,
    group_id: String,
    photo_ids: Vec<String>,
) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| groups::add(conn, &group_id, &photo_ids)).await
}

#[tauri::command]
async fn set_membership_statuses(
    app: AppHandle,
    group_id: String,
    photo_ids: Vec<String>,
    status: String,
) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| {
        groups::set_statuses(conn, &group_id, &photo_ids, &status)
    })
    .await
}

#[tauri::command]
async fn relink_photo(app: AppHandle, photo_id: String, path: String) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        photos::relink(&store, &photo_id, std::path::Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("work-photo", work_directory::serve)
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let store = Store::open(root).map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(curation::CurationStore::default());
            app.manage(link_import::LinkImportStore::default());
            app.manage(music::MusicCache::default());
            work_directory::start_monitor(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            import_photos,
            create_group,
            update_group,
            delete_group,
            update_photo,
            photo_metadata::read_photo_metadata,
            add_photos_to_group,
            set_membership_statuses,
            airdrop::share_album_airdrop,
            relink_photo,
            curation::prepare_import,
            link_import::prepare_link_import,
            link_import::cancel_link_import,
            curation::prepare_group_curation,
            curation::commit_curation,
            curation::cancel_curation,
            collage::export_collage_png,
            model_profiles::models_list,
            model_profiles::models_save,
            model_profiles::models_delete,
            planning::plans_list,
            planning::plans_save,
            planning::plans_delete,
            planning_export::plans_export_png,
            social::social_list,
            social::social_save,
            social::social_delete,
            books::books_list,
            books::books_get,
            books::books_create,
            books::books_save_version,
            books::books_rename,
            books::books_delete,
            books::books_append_photos,
            book_export::books_export,
            ai::ai_settings,
            ai::ai_save_settings,
            ai::ai_remove_settings,
            ai::ai_list_analyses,
            ai::ai_analyze_photo,
            ai::ai_run_text,
            libraries::libraries_list,
            libraries::libraries_switch,
            backup::backup_create,
            backup::backup_restore,
            music::music_import,
            work_directory::runtime::get_work_directory,
            work_directory::runtime::bind_work_directory,
            work_directory::runtime::relink_work_directory,
            work_directory::runtime::unbind_work_directory,
            work_directory::runtime::resolve_work_directory,
            work_directory::runtime::retry_work_directory_job,
            music::music_release
        ])
        .run(tauri::generate_context!())
        .expect("Foliune 桌面运行失败");
}

#[cfg(test)]
mod backup_tests;
#[cfg(test)]
mod book_tests;
#[cfg(test)]
mod curation_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod editorial_tests;

#[cfg(test)]
mod collage_tests;

#[cfg(test)]
mod planning_tests;

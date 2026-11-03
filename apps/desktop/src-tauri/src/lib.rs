mod ai;
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
mod model_profiles;
mod models;
mod music;
mod photos;
mod planning;
mod planning_export;
mod social;

use db::Store;
use models::{GroupInput, Snapshot};
use serde_json::Value;
use tauri::{Manager, State};

#[tauri::command]
fn load_snapshot(store: State<'_, Store>) -> Result<Snapshot, String> {
    db::snapshot(&*store.connection.lock().map_err(|e| e.to_string())?)
}

#[tauri::command]
async fn import_photos(
    app: tauri::AppHandle,
    paths: Vec<String>,
    library: String,
    group_id: Option<String>,
) -> Result<photos::ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        photos::import(&store, paths, &library, group_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn create_group(store: State<'_, Store>, input: GroupInput) -> Result<Snapshot, String> {
    groups::create(&*store.connection.lock().map_err(|e| e.to_string())?, input)
}

#[tauri::command]
fn update_group(store: State<'_, Store>, id: String, patch: Value) -> Result<Snapshot, String> {
    groups::update(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        &id,
        patch,
    )
}

#[tauri::command]
fn delete_group(store: State<'_, Store>, id: String) -> Result<Snapshot, String> {
    groups::delete(&*store.connection.lock().map_err(|e| e.to_string())?, &id)
}

#[tauri::command]
fn update_photo(store: State<'_, Store>, id: String, patch: Value) -> Result<Snapshot, String> {
    photos::update(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        &id,
        patch,
    )
}

#[tauri::command]
fn add_photos_to_group(
    store: State<'_, Store>,
    group_id: String,
    photo_ids: Vec<String>,
) -> Result<Snapshot, String> {
    groups::add(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        &group_id,
        &photo_ids,
    )
}

#[tauri::command]
fn set_membership_statuses(
    store: State<'_, Store>,
    group_id: String,
    photo_ids: Vec<String>,
    status: String,
) -> Result<Snapshot, String> {
    groups::set_statuses(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        &group_id,
        &photo_ids,
        &status,
    )
}

#[tauri::command]
async fn relink_photo(
    app: tauri::AppHandle,
    photo_id: String,
    path: String,
) -> Result<Snapshot, String> {
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
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let store = Store::open(root).map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(curation::CurationStore::default());
            app.manage(music::MusicCache::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            import_photos,
            create_group,
            update_group,
            delete_group,
            update_photo,
            add_photos_to_group,
            set_membership_statuses,
            relink_photo,
            curation::prepare_import,
            curation::prepare_group_curation,
            curation::commit_curation,
            curation::cancel_curation,
            collage::prepare_collage,
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
            books::books_reflow,
            books::books_select_version,
            books::books_rename,
            books::books_delete,
            books::books_append_photos,
            book_export::books_export,
            ai::ai_settings,
            ai::ai_save_settings,
            ai::ai_list_analyses,
            ai::ai_analyze_photo,
            ai::ai_run_text,
            libraries::libraries_list,
            libraries::libraries_switch,
            backup::backup_create,
            backup::backup_restore,
            music::music_import,
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

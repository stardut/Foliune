//! Command-line adapter for editing the desktop library.
mod arguments;
mod catalog;
mod documents;

use arguments::{AlbumAction, Arguments, Command, DocumentAction, Kind, PhotoAction};
use clap::{error::ErrorKind, Parser};
use documents::DocumentKind;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::ExitCode,
};

use crate::db;

pub(super) const NOT_FOUND: &str = "记录不存在";

#[derive(Serialize)]
struct Failure {
    code: &'static str,
    message: String,
}

impl Failure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn operation(message: String) -> Self {
        let code = match message.as_str() {
            NOT_FOUND => "NOT_FOUND",
            db::REVISION_CONFLICT => "REVISION_CONFLICT",
            "database is locked" | "database table is locked" => "LIBRARY_BUSY",
            _ => "OPERATION_FAILED",
        };
        Self::new(code, message)
    }
}

pub fn run() -> ExitCode {
    let args: Vec<_> = std::env::args_os().collect();
    let arguments = match Arguments::try_parse_from(&args) {
        Ok(arguments) => arguments,
        Err(error) => {
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                let _ = error.print();
                return ExitCode::SUCCESS;
            }
            if args.iter().any(|arg| arg == "--json") {
                report_failure(Failure::new("USAGE_ERROR", error.to_string()), true);
            } else {
                let _ = error.print();
            }
            return ExitCode::from(2);
        }
    };
    let json = arguments.json;
    let result = execute(arguments).and_then(|value| {
        let mut stdout = io::stdout().lock();
        render(&mut stdout, &value, json)
            .map_err(|error| Failure::new("OUTPUT_ERROR", error.to_string()))
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            report_failure(error, json);
            ExitCode::FAILURE
        }
    }
}

fn report_failure(error: Failure, json: bool) {
    let mut stderr = io::stderr().lock();
    if json {
        let _ = serde_json::to_writer(&mut stderr, &error);
        let _ = writeln!(stderr);
    } else {
        let _ = writeln!(stderr, "{}: {}", error.code, error.message);
    }
}

fn render(output: &mut impl Write, value: &Value, json: bool) -> io::Result<()> {
    if json {
        serde_json::to_writer(&mut *output, value)?;
    } else if let Some(items) = value.get("items").and_then(Value::as_array) {
        writeln!(output, "共 {} 条", value["total"])?;
        for item in items {
            let id = item["id"].as_str().unwrap_or_default();
            let label = ["title", "name", "displayName"]
                .iter()
                .find_map(|key| item[*key].as_str())
                .unwrap_or_default();
            writeln!(output, "{id}\t{}", label.replace(['\t', '\n', '\r'], " "))?;
        }
        return Ok(());
    } else if let Some(path) = value.get("path").and_then(Value::as_str) {
        write!(output, "{path}")?;
    } else {
        serde_json::to_writer_pretty(&mut *output, value)?;
    }
    writeln!(output)
}

fn input(path: &Path) -> Result<Value, Failure> {
    let mut reader: Box<dyn Read> = if path == Path::new("-") {
        Box::new(io::stdin().lock())
    } else {
        Box::new(
            fs::File::open(path).map_err(|error| Failure::new("INPUT_ERROR", error.to_string()))?,
        )
    };
    serde_json::from_reader(&mut reader)
        .map_err(|error| Failure::new("INVALID_JSON", error.to_string()))
}

fn value(result: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(result).map_err(|error| error.to_string())
}

fn output_preview(path: &Path, bytes: &[u8]) -> Result<Value, Failure> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| Failure::new("OUTPUT_ERROR", error.to_string()))?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.flush()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(Failure::new("OUTPUT_ERROR", error.to_string()));
    }
    Ok(json!({ "path": path.to_string_lossy(), "format": "jpeg" }))
}

struct Library(PathBuf);

impl Library {
    fn read<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, Failure> {
        let conn = db::open_existing(&self.0, false)
            .map_err(|error| Failure::new("LIBRARY_UNAVAILABLE", error))?;
        let transaction = conn
            .unchecked_transaction()
            .map_err(|error| Failure::operation(error.to_string()))?;
        operation(&transaction).map_err(Failure::operation)
    }

    fn write<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, Failure> {
        let mut conn = db::open_existing(&self.0, true)
            .map_err(|error| Failure::new("LIBRARY_UNAVAILABLE", error))?;
        db::write(&mut conn, operation).map_err(Failure::operation)
    }
}

fn execute(arguments: Arguments) -> Result<Value, Failure> {
    let root = arguments
        .library
        .or_else(|| {
            dirs::data_dir()
                .map(|base| base.join(crate::desktop_context().config().identifier.as_str()))
        })
        .ok_or_else(|| Failure::new("LIBRARY_UNAVAILABLE", "找不到 Foliune 应用数据目录"))?;
    let library = Library(root);
    match arguments.command {
        Command::Plan(action) => document(library, DocumentKind::Plan, action),
        Command::Book(action) => document(library, DocumentKind::Book, action),
        Command::Model(action) => document(library, DocumentKind::Model, action),
        Command::Photo(action) => photo(library, action),
        Command::Album(action) => album(library, action),
    }
}

fn document(
    library: Library,
    kind: DocumentKind,
    action: DocumentAction,
) -> Result<Value, Failure> {
    match action {
        DocumentAction::Search { query, page } => library.read(|conn| {
            documents::search(
                conn,
                kind,
                &query,
                page.limit as usize,
                page.offset as usize,
            )
        }),
        DocumentAction::Show { id } => library.read(|conn| documents::show(conn, kind, &id)),
        DocumentAction::Create { input: file } => {
            let data = input(&file.file)?;
            library.write(|conn| documents::create(conn, kind, data))
        }
        DocumentAction::Update {
            id,
            input: file,
            revision,
        } => {
            let data = input(&file.file)?;
            library.write(|conn| documents::update(conn, kind, &id, &revision.revision, data))
        }
        DocumentAction::Delete { id, revision } => {
            library.write(|conn| documents::delete(conn, kind, &id, &revision.revision))
        }
    }
}

fn photo(library: Library, action: PhotoAction) -> Result<Value, Failure> {
    match action {
        PhotoAction::Search {
            query,
            kind,
            album,
            page,
        } => library.read(|conn| {
            value(catalog::search_photos(
                conn,
                kind.map(Kind::as_str),
                album.as_deref(),
                Some(&query),
                page.limit as usize,
                page.offset as usize,
            )?)
        }),
        PhotoAction::Show { id } => library.read(|conn| value(catalog::show_photo(conn, &id)?)),
        PhotoAction::Preview { id, output } => {
            let bytes = library.read(|conn| catalog::preview_photo(conn, &id))?;
            output_preview(&output, &bytes)
        }
        PhotoAction::Update { id, input: file } => {
            let data = input(&file.file)?;
            library.write(|conn| value(catalog::update_photo(conn, &id, data)?))
        }
    }
}

fn album(library: Library, action: AlbumAction) -> Result<Value, Failure> {
    match action {
        AlbumAction::List { kind, page } => library.read(|conn| {
            value(catalog::list_albums(
                conn,
                kind.map(Kind::as_str),
                page.limit as usize,
                page.offset as usize,
            )?)
        }),
        AlbumAction::Show { id } => library.read(|conn| value(catalog::show_album(conn, &id)?)),
        AlbumAction::Create { input: file } => {
            let data: crate::models::GroupInput = serde_json::from_value(input(&file.file)?)
                .map_err(|error| Failure::new("VALIDATION_ERROR", error.to_string()))?;
            library.write(|conn| value(catalog::create_album(conn, data)?))
        }
        AlbumAction::Update { id, input: file } => {
            let data = input(&file.file)?;
            library.write(|conn| value(catalog::update_album(conn, &id, data)?))
        }
        AlbumAction::Delete { id } => {
            let mut conn = db::open_existing(&library.0, true)
                .map_err(|error| Failure::new("LIBRARY_UNAVAILABLE", error))?;
            db::write(&mut conn, |conn| catalog::delete_album(conn, &id))
                .map_err(Failure::operation)?;
            catalog::remove_album_cache(&conn, &id);
            Ok(json!({ "id": id }))
        }
        AlbumAction::Add(selection) => library
            .write(|conn| value(catalog::add_photos(conn, &selection.id, &selection.photos)?)),
        AlbumAction::Discard(selection) => library.write(|conn| {
            value(catalog::discard_photos(
                conn,
                &selection.id,
                &selection.photos,
            )?)
        }),
        AlbumAction::Restore(selection) => library.write(|conn| {
            value(catalog::restore_photos(
                conn,
                &selection.id,
                &selection.photos,
            )?)
        }),
    }
}

#[cfg(test)]
mod tests;

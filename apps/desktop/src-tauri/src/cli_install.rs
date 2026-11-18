use crate::locale::tr;
use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, Webview};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum Status {
    Unavailable,
    #[cfg(target_os = "macos")]
    Available,
    #[cfg(target_os = "macos")]
    Installed,
    #[cfg(target_os = "macos")]
    Conflict,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum Outcome {
    #[cfg(target_os = "macos")]
    Installed,
    #[cfg(target_os = "macos")]
    Cancelled,
}

fn require_main(window: &Webview) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(tr(
            "请在主窗口操作命令行工具。",
            "Manage the command-line tool from the main window.",
        )
        .into())
    }
}

#[tauri::command]
pub(crate) async fn cli_install_status(app: AppHandle, webview: Webview) -> Result<Status, String> {
    require_main(&webview)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::status(&app))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Status::Unavailable)
    }
}

#[tauri::command]
pub(crate) async fn install_cli(app: AppHandle, webview: Webview) -> Result<Outcome, String> {
    require_main(&webview)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let store = app.state::<crate::db::Store>();
            let _work = store.restart_gate.require_work()?;
            macos::install(&app)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(tr(
            "此版本不支持安装命令行工具。",
            "This version does not support installing the command-line tool.",
        )
        .into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AppHandle, Outcome, Status};
    use crate::locale::{display_format, tr};
    use std::{
        ffi::CString,
        fs, io,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{ffi::OsStrExt, fs::PermissionsExt},
        },
        path::Path,
        process::Command,
        sync::Mutex,
    };

    const APP_CLI: &str = "/Applications/Foliune.app/Contents/MacOS/foliune-cli";
    const SYSTEM_CLI: &str = "/usr/local/bin/foliune-cli";
    static INSTALL: Mutex<()> = Mutex::new(());

    // The administrator branch only traverses root-owned, non-writable directories.
    // Perl's symlink invokes the exact syscall even if the destination is a directory.
    const LINK_SCRIPT: &str = r#"
        use Fcntl qw(:DEFAULT :mode);
        umask 022;
        my ($target) = @ARGV;
        chdir '/usr' or die "Cannot open /usr: $!\n";
        foreach my $directory ('local', 'bin') {
            mkdir($directory, 0755) unless lstat($directory);
            sysopen(my $handle, $directory, O_RDONLY | O_NOFOLLOW | O_DIRECTORY)
                or die "Cannot open $directory: $!\n";
            my @entry = stat($handle);
            die "Unsafe directory: $directory\n" unless @entry &&
                S_ISDIR($entry[2]) && $entry[4] == 0 && ($entry[2] & 0022) == 0;
            chdir($handle) or die "Cannot enter $directory: $!\n";
        }
        symlink($target, 'foliune-cli') or die "Cannot create symbolic link: $!\n";
    "#;

    fn eligible(app: &AppHandle) -> bool {
        if cfg!(debug_assertions)
            || tauri::is_dev()
            || app.config().identifier != "app.foliune.desktop"
        {
            return false;
        }
        let cli = Path::new(APP_CLI);
        let desktop = cli.with_file_name("foliune");
        std::env::current_exe().is_ok_and(|exe| exe == desktop)
            && cli.canonicalize().is_ok_and(|resolved| resolved == cli)
            && fs::metadata(cli)
                .is_ok_and(|file| file.is_file() && file.permissions().mode() & 0o111 != 0)
    }

    fn inspect(target: &Path, link: &Path) -> io::Result<Status> {
        match open_link_directory(link) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Status::Available),
            Err(error) => return Err(error),
        }
        let entry = match fs::symlink_metadata(link) {
            Ok(entry) => entry,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Status::Available),
            Err(error) => return Err(error),
        };
        if entry.file_type().is_symlink() && fs::read_link(link)? == target {
            Ok(Status::Installed)
        } else {
            Ok(Status::Conflict)
        }
    }

    pub(super) fn status(app: &AppHandle) -> Result<Status, String> {
        if !eligible(app) {
            return Ok(Status::Unavailable);
        }
        inspect(Path::new(APP_CLI), Path::new(SYSTEM_CLI)).map_err(error_message)
    }

    pub(super) fn install(app: &AppHandle) -> Result<Outcome, String> {
        let _lock = INSTALL.try_lock().map_err(|_| {
            tr(
                "正在安装命令行工具。",
                "The command-line tool is already being installed.",
            )
        })?;
        if !eligible(app) {
            return Err(tr(
                "请从「应用程序」打开已安装的 Foliune。",
                "Open your installed copy of Foliune from Applications.",
            )
            .into());
        }
        install_link(Path::new(APP_CLI), Path::new(SYSTEM_CLI), authorize)
    }

    fn install_link(
        target: &Path,
        link: &Path,
        elevate: impl FnOnce() -> Result<Outcome, String>,
    ) -> Result<Outcome, String> {
        match inspect(target, link).map_err(error_message)? {
            Status::Installed => return Ok(Outcome::Installed),
            Status::Conflict => {
                return Err(display_format!(
                    "{} 已被占用。",
                    "{} is already in use.",
                    link.display()
                ))
            }
            _ => {}
        }
        let result = match create_link(target, link) {
            Ok(()) => Ok(Outcome::Installed),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::PermissionDenied | io::ErrorKind::NotFound
                ) =>
            {
                elevate()
            }
            Err(error) => Err(error_message(error)),
        };
        // Another install may have finished while the authorization dialog was open.
        match inspect(target, link).map_err(error_message)? {
            Status::Installed => Ok(Outcome::Installed),
            Status::Conflict => Err(display_format!(
                "{} 已被占用。",
                "{} is already in use.",
                link.display()
            )),
            _ if result == Ok(Outcome::Installed) => Err(tr(
                "未找到已安装的命令链接。",
                "Could not find the installed command link.",
            )
            .into()),
            _ => result,
        }
    }

    fn open_link_directory(link: &Path) -> io::Result<fs::File> {
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let parent = link.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let grandparent = parent.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let base = CString::new(grandparent.as_os_str().as_bytes())?;
        let name = CString::new(
            parent
                .file_name()
                .ok_or(io::ErrorKind::InvalidInput)?
                .as_bytes(),
        )?;
        let fd = unsafe { libc::open(base.as_ptr(), flags) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let base = unsafe { fs::File::from_raw_fd(fd) };
        let fd = unsafe { libc::openat(base.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { fs::File::from_raw_fd(fd) })
    }

    fn create_link(target: &Path, link: &Path) -> io::Result<()> {
        let directory = open_link_directory(link)?;
        let target = CString::new(target.as_os_str().as_bytes())?;
        let name = CString::new(
            link.file_name()
                .ok_or(io::ErrorKind::InvalidInput)?
                .as_bytes(),
        )?;
        if unsafe { libc::symlinkat(target.as_ptr(), directory.as_raw_fd(), name.as_ptr()) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    fn authorize() -> Result<Outcome, String> {
        let output = Command::new("/usr/bin/osascript")
            .args([
                "-e", "on run argv",
                "-e", "set helper to quoted form of (item 1 of argv)",
                "-e", "set targetPath to quoted form of (item 2 of argv)",
                "-e", "try",
                "-e", "do shell script (\"/usr/bin/env -i /usr/bin/perl -e \" & helper & \" -- \" & targetPath) with administrator privileges",
                "-e", "on error number -128",
                "-e", "return \"cancelled\"",
                "-e", "end try",
                "-e", "return \"installed\"",
                "-e", "end run",
                "--", LINK_SCRIPT, APP_CLI,
            ])
            .output()
            .map_err(error_message)?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(display_format!(
                "无法安装命令行工具。{}",
                "Could not install the command-line tool. {}",
                detail.trim()
            ));
        }
        match String::from_utf8_lossy(&output.stdout).trim() {
            "installed" => Ok(Outcome::Installed),
            "cancelled" => Ok(Outcome::Cancelled),
            _ => Err(tr(
                "无法确认命令行工具安装结果。",
                "Could not verify command-line tool installation.",
            )
            .into()),
        }
    }

    fn error_message(error: io::Error) -> String {
        display_format!(
            "无法访问命令链接。{error}",
            "Could not access the command link. {error}"
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::symlink;

        #[test]
        fn install_is_idempotent_and_survives_replacing_the_application() {
            let root = tempfile::tempdir().unwrap();
            let bundle = root.path().join("Foliune.app");
            fs::create_dir(&bundle).unwrap();
            let target = bundle.join("foliune-cli");
            let link = root.path().join("foliune-cli");
            fs::write(&target, "old").unwrap();
            let unexpected = || panic!("unexpected administrator authorization");
            assert_eq!(
                install_link(&target, &link, unexpected),
                Ok(Outcome::Installed)
            );
            assert_eq!(
                install_link(&target, &link, unexpected),
                Ok(Outcome::Installed)
            );
            fs::rename(&bundle, root.path().join("old.app")).unwrap();
            fs::create_dir(&bundle).unwrap();
            fs::write(&target, "new").unwrap();
            assert_eq!(fs::read_to_string(&link).unwrap(), "new");
        }

        #[test]
        fn existing_file_directory_and_foreign_symlink_are_preserved() {
            let root = tempfile::tempdir().unwrap();
            let target = root.path().join("target");
            let link = root.path().join("foliune-cli");
            fs::write(&link, "existing").unwrap();
            assert!(install_link(&target, &link, || panic!()).is_err());
            assert_eq!(fs::read_to_string(&link).unwrap(), "existing");
            fs::remove_file(&link).unwrap();
            fs::create_dir(&link).unwrap();
            assert!(install_link(&target, &link, || panic!()).is_err());
            assert_eq!(fs::read_dir(&link).unwrap().count(), 0);
            fs::remove_dir(&link).unwrap();
            symlink("another-tool", &link).unwrap();
            assert!(install_link(&target, &link, || panic!()).is_err());
            assert_eq!(fs::read_link(&link).unwrap(), Path::new("another-tool"));
        }

        #[test]
        fn cancelled_authorization_leaves_no_link_and_false_success_is_rejected() {
            let root = tempfile::tempdir().unwrap();
            let target = root.path().join("target");
            let link = root.path().join("missing-bin/foliune-cli");
            assert_eq!(
                install_link(&target, &link, || Ok(Outcome::Cancelled)),
                Ok(Outcome::Cancelled)
            );
            assert!(install_link(&target, &link, || Ok(Outcome::Installed)).is_err());
            assert_eq!(inspect(&target, &link).unwrap(), Status::Available);
        }

        #[test]
        fn symlinked_parent_is_rejected_without_creating_a_link() {
            let root = tempfile::tempdir().unwrap();
            let real = root.path().join("real");
            fs::create_dir(&real).unwrap();
            let bin = root.path().join("bin");
            symlink(&real, &bin).unwrap();
            let link = bin.join("foliune-cli");
            assert!(install_link(Path::new("target"), &link, || panic!()).is_err());
            assert_eq!(fs::read_dir(real).unwrap().count(), 0);
        }
    }
}

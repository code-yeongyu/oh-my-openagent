//! The macOS app sources: running app processes (each app's main executable only, so a
//! helper, crash reporter or XPC service inside the bundle never stands for the app; bundle id
//! and path from the process's own bundle, window ownership from the window list, the activation policy from the bundle's
//! `LSUIElement` / `LSBackgroundOnly`), and installed apps found under the standard
//! application folders.
//! The launch and reveal run in the UI helper through `NSWorkspace`; until that helper exists
//! (row 46) both answer `Internal{input_unsupported}` / false with nothing launched.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::scan::app_bundles;
use super::seam::{AppsOs, InstalledApp, RunningApp};
use crate::capture::os::cf::{self, cf_string, CfRef};
use crate::capture::os::{listing, process};

/// The application folders; the scan descends into their subfolders (Utilities, vendors).
const FOLDERS: [&str; 2] = ["/Applications", "/System/Applications"];

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFBundleGetValueForInfoDictionaryKey(bundle: CfRef, key: CfRef) -> CfRef;
    fn CFBooleanGetTypeID() -> usize;
}

/// The live app sources.
#[derive(Debug, Default)]
pub struct Os;

/// The app whose main executable `executable` is; `None` for any other process under a bundle
/// (a crashpad handler under Frameworks, an XPC service, a plain helper binary).
fn main_bundle(executable: &Path) -> Option<PathBuf> {
    let app = process::app_bundle(executable)?;
    let main = process::main_executable(app)?;
    let same = main == executable
        || std::fs::canonicalize(&main).is_ok_and(|resolved| resolved == executable);
    same.then(|| app.to_path_buf())
}

/// Every pid of the machine (`proc_listallpids`).
fn all_pids() -> Vec<u32> {
    // SAFETY: a null buffer asks for the count.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let mut pids = vec![0i32; usize::try_from(count).unwrap_or(0) + 64];
    let bytes = i32::try_from(pids.len() * std::mem::size_of::<i32>()).unwrap_or(i32::MAX);
    // SAFETY: `pids` holds `bytes` bytes.
    let filled = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    pids.truncate(usize::try_from(filled).unwrap_or(0));
    pids.into_iter()
        .filter_map(|p| u32::try_from(p).ok())
        .filter(|p| *p > 0)
        .collect()
}

/// An Info.plist flag: a boolean, a number, or a "1"/"YES"/"true" string.
fn truthy(value: CfRef) -> bool {
    if value.is_null() {
        return false;
    }
    // SAFETY: plain type-id reads on a live value.
    let (kind, boolean, number) = unsafe {
        (
            cf::CFGetTypeID(value),
            CFBooleanGetTypeID(),
            cf::CFNumberGetTypeID(),
        )
    };
    if kind == boolean {
        cf::boolean(value)
    } else if kind == number {
        cf::int(value).is_some_and(|n| n != 0)
    } else {
        cf::string(value)
            .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "1" | "yes" | "true"))
    }
}

/// The bundle declares a background or agent-only app (not the regular activation policy).
fn background(app: &Path) -> bool {
    let Some(bundle) = process::bundle(app) else {
        return false;
    };
    [c"LSUIElement", c"LSBackgroundOnly"].iter().any(|name| {
        cf_string(name).is_some_and(|key| {
            // SAFETY: valid bundle and key; the value is not owned (Get rule).
            truthy(unsafe { CFBundleGetValueForInfoDictionaryKey(bundle.get(), key.get()) })
        })
    })
}

fn name_of(bundle: &Path) -> String {
    bundle
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl AppsOs for Os {
    fn running(&mut self) -> Vec<RunningApp> {
        let owners: BTreeSet<u32> = listing::windows()
            .unwrap_or_default()
            .into_iter()
            .filter(|w| w.layer == 0)
            .map(|w| w.pid)
            .collect();
        all_pids()
            .into_iter()
            .filter_map(|pid| {
                let bundle = main_bundle(&process::path(pid)?)?;
                Some(RunningApp {
                    pid,
                    bundle_id: process::bundle_identifier(&bundle),
                    name: name_of(&bundle),
                    path: Some(bundle.display().to_string()),
                    regular: !background(&bundle),
                    has_windows: owners.contains(&pid),
                })
            })
            .collect()
    }

    fn installed(&mut self) -> Vec<InstalledApp> {
        let mut home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join("Applications"));
        let folders = FOLDERS.iter().map(PathBuf::from).chain(home.take());
        folders
            .flat_map(|folder| app_bundles(&folder))
            .filter_map(|bundle| {
                Some(InstalledApp {
                    bundle_id: process::bundle_identifier(&bundle)?,
                    name: name_of(&bundle),
                    path: bundle.display().to_string(),
                })
            })
            .collect()
    }

    fn launch(&mut self, _bundle: &str, _activate: bool) -> Result<u32, Refusal> {
        Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported))
    }

    fn reveal(&mut self, _bundle: &str) -> bool {
        false
    }

    fn process_path(&mut self, pid: u32) -> Option<String> {
        process::path(pid).map(|p| p.display().to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::main_bundle;

    /// A bundle on disk: `Contents/MacOS/Main` is the main executable, beside a crashpad-style
    /// helper under Frameworks and an XPC service.
    fn fixture(root: &Path) -> std::path::PathBuf {
        let app = root.join("Fixture.app");
        let contents = app.join("Contents");
        let files = [
            contents.join("MacOS/Main"),
            contents.join("Frameworks/Kit.framework/Helpers/crashpad_handler"),
            contents.join("XPCServices/Fetch.xpc/Contents/MacOS/Fetch"),
        ];
        for file in &files {
            std::fs::create_dir_all(file.parent().expect("parent")).expect("dir");
            std::fs::write(file, b"").expect("file");
        }
        std::fs::write(
            contents.join("Info.plist"),
            concat!(
                r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>"#,
                "<key>CFBundleIdentifier</key><string>com.example.fixture</string>",
                "<key>CFBundleExecutable</key><string>Main</string>",
                "<key>CFBundlePackageType</key><string>APPL</string>",
                "</dict></plist>"
            ),
        )
        .expect("plist");
        app
    }

    #[test]
    fn only_the_main_executable_is_the_running_app() {
        let root = std::env::temp_dir().join(format!("apps-main-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("root");
        // proc_pidpath answers resolved paths (/private/var, not /var).
        let app = fixture(&root.canonicalize().expect("canonical"));
        let contents = app.join("Contents");
        assert_eq!(main_bundle(&contents.join("MacOS/Main")), Some(app.clone()));
        assert_eq!(
            main_bundle(&contents.join("Frameworks/Kit.framework/Helpers/crashpad_handler")),
            None,
            "a helper executable is not the app"
        );
        assert_eq!(
            main_bundle(&contents.join("XPCServices/Fetch.xpc/Contents/MacOS/Fetch")),
            None,
            "an XPC service is not the app"
        );
        std::fs::remove_dir_all(&root).expect("cleanup");
    }
}

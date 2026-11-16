//! The macOS app sources: running apps that own application-layer windows (bundle id and
//! bundle path from the process), and installed apps from the standard application folders.
//! The launch and reveal run in the UI helper through `NSWorkspace`; until that helper exists
//! (row 46) both answer `Internal{input_unsupported}` / false with nothing launched.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::seam::{AppsOs, InstalledApp, RunningApp};
use crate::capture::os::{listing, process};

const FOLDERS: [&str; 3] = [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
];

/// The live app sources.
#[derive(Debug, Default)]
pub struct Os;

fn bundle_of(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .filter(|p| p.extension().is_some_and(|e| e == "app"))
        .last()
        .map(Path::to_path_buf)
}

fn name_of(bundle: &Path) -> String {
    bundle
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl AppsOs for Os {
    fn running(&mut self) -> Vec<RunningApp> {
        let pids: BTreeSet<u32> = listing::windows()
            .unwrap_or_default()
            .into_iter()
            .filter(|w| w.layer == 0)
            .map(|w| w.pid)
            .collect();
        pids.into_iter()
            .filter_map(|pid| {
                let bundle = bundle_of(&process::path(pid)?)?;
                Some(RunningApp {
                    pid,
                    bundle_id: process::bundle_id(pid),
                    name: name_of(&bundle),
                    path: Some(bundle.display().to_string()),
                    regular: true,
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
            .filter_map(|folder| std::fs::read_dir(folder).ok())
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|e| e == "app"))
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

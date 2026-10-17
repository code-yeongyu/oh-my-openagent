//! Live checks against the real UI Automation server. `#[ignore]`d: they
//! need an interactive Windows desktop (the `windows-latest` runner has one).
//! Run with `--ignored --nocapture`; each prints machine-read `key=value`
//! facts for the QA evidence.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{snapshot, AxRegistry};
use senpi_desktop_core::types::{AxSnapshotOptions, DesktopWindow, DisplaySelector};

use super::Win32Ax;
use crate::Win32Backend;

/// Hang guard for Notepad's launch; the window usually appears in < 2 s.
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);

/// A Notepad editing a scratch file; dropping it (also while a failed
/// assertion unwinds) ends Notepad and removes the file. Shared with the
/// input live tests.
pub(crate) struct Notepad {
    child: Child,
    path: PathBuf,
    /// The window's owning process: packaged Notepad hands the document to
    /// a process other than the one spawned.
    window_pid: Option<u32>,
}

impl Notepad {
    /// `tag` keeps the scratch files of concurrently running tests apart.
    pub(crate) fn open(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!("senpi-{tag}-live-{}.txt", std::process::id()));
        std::fs::write(&path, "senpi uia live").unwrap();
        let child = Command::new("notepad.exe").arg(&path).spawn().unwrap();
        Self {
            child,
            path,
            window_pid: None,
        }
    }

    /// Notepad's document window, found by the scratch file's name in its
    /// title.
    pub(crate) fn wait_for_window(&mut self) -> DesktopWindow {
        let name = self.path.file_name().unwrap().to_string_lossy().into_owned();
        let backend = Win32Backend::new(DisplaySelector::All).unwrap();
        let started = Instant::now();
        let window = loop {
            if let Some(window) = backend
                .windows()
                .unwrap()
                .into_iter()
                .find(|window| window.title.contains(&name))
            {
                break window;
            }
            assert!(
                started.elapsed() < WINDOW_DEADLINE,
                "Notepad window never appeared"
            );
            std::thread::yield_now();
        };
        self.window_pid = window.pid;
        window
    }
}

impl Drop for Notepad {
    fn drop(&mut self) {
        if let Some(pid) = self.window_pid.filter(|pid| *pid != self.child.id()) {
            if let Err(error) = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .status()
            {
                eprintln!("teardown: taskkill {pid} failed: {error}");
            }
        }
        if let Err(error) = self.child.kill().and_then(|()| self.child.wait().map(drop)) {
            eprintln!("teardown: ending notepad failed: {error}");
        }
        if let Err(error) = std::fs::remove_file(&self.path) {
            eprintln!("teardown: removing {} failed: {error}", self.path.display());
        }
    }
}

#[test]
#[ignore = "live: needs an interactive Windows desktop and notepad.exe"]
fn uia_snapshot_of_notepad_has_document() {
    let mut notepad = Notepad::open("uia");
    let window = notepad.wait_for_window();
    let mut ax = Win32Ax::new();
    let mut registry = AxRegistry::default();
    let snap = snapshot(&mut ax, &mut registry, &window, &AxSnapshotOptions::default()).unwrap();
    println!(
        "window_id={} title={:?} pid={:?} node_count={}\n{}",
        window.id, window.title, window.pid, snap.node_count, snap.text
    );
    // Classic Notepad's editor is a UIA `Edit` (textfield); packaged
    // Notepad's is a `Document` (textarea).
    let document = snap.text.lines().map(str::trim_start).find(|line| {
        (line.starts_with("- textfield") || line.starts_with("- textarea")) && line.contains("[ref=e")
    });
    println!("document_line={document:?}");
    assert!(document.is_some(), "no textfield/textarea line in the snapshot");
}

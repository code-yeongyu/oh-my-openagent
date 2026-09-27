//! Live checks against the real accessibility server. `#[ignore]`d: they need
//! a logged-in macOS session and, except the denial check, an Accessibility
//! grant for the launching process. Run with `--ignored --nocapture`; each
//! prints machine-read `key=value` facts for the QA evidence.

use std::process::Command;
use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{snapshot, AxBackend, AxHandle, AxRegistry};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{AxSnapshotOptions, DesktopWindow};

use super::{element, is_trusted, MacAx};

const DOCUMENT_TEXT: &str = "senpi ax live";
/// Hang guard for TextEdit's launch; the window usually appears in < 2 s.
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);

/// TextEdit's pid, once it runs. xcap cannot stand in: without a Screen
/// Recording grant it lists no TextEdit windows at all.
fn textedit_pid() -> Option<u32> {
    let output = Command::new("/usr/bin/pgrep")
        .args(["-x", "TextEdit"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .parse()
        .ok()
}

/// The TextEdit document window titled `title` as `(pid, CGWindowID)`, once
/// TextEdit has shown it. CG window titles need a Screen Recording grant, so
/// the title is matched through AX and the id read with the window-id SPI.
fn find_textedit_window(title: &str) -> Option<(u32, u32)> {
    let pid = textedit_pid()?;
    let app = element::create_application(libc::pid_t::try_from(pid).ok()?).ok()?;
    element::copy_elements(&app, "AXWindows")?
        .iter()
        .find(|window| element::copy_string(window, "AXTitle").as_deref() == Some(title))
        .and_then(|window| element::window_id(window))
        .map(|id| (pid, id))
}

/// Opens a fresh plain-text document in TextEdit (no Apple Events needed) and
/// returns its native window.
fn open_textedit_document(dir: &tempfile::TempDir) -> DesktopWindow {
    let title = format!("senpi-ax-live-{}.txt", std::process::id());
    let path = dir.path().join(&title);
    std::fs::write(&path, DOCUMENT_TEXT).unwrap();
    let status = Command::new("/usr/bin/open")
        .args(["-a", "TextEdit"])
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    let started = Instant::now();
    let (pid, id) = loop {
        if let Some(found) = find_textedit_window(&title) {
            break found;
        }
        assert!(
            started.elapsed() < WINDOW_DEADLINE,
            "TextEdit window never appeared"
        );
        std::thread::yield_now();
    };
    // `window_root` matches by CGWindowID first, so the frame is not needed.
    DesktopWindow {
        id: id.to_string(),
        title,
        app: "TextEdit".to_string(),
        pid: Some(pid),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        focused: false,
        elevated: None,
    }
}

/// Presses the window's close button; the document is unmodified.
fn close_window(ax: &mut MacAx, root: &AxHandle) {
    let root = element::element(root).unwrap();
    let close = element::copy_element(root, "AXCloseButton").unwrap();
    ax.perform(&element::handle(close), "press").unwrap();
}

#[test]
#[ignore = "live: needs an Accessibility grant for the launcher and TextEdit"]
fn ax_snapshot_of_textedit_has_text_area() {
    assert!(
        is_trusted(),
        "precondition: this launcher must hold Accessibility"
    );
    let dir = tempfile::tempdir().unwrap();
    let window = open_textedit_document(&dir);
    let mut ax = MacAx::new();
    let mut registry = AxRegistry::default();
    let snap = snapshot(&mut ax, &mut registry, &window, &AxSnapshotOptions::default()).unwrap();
    println!(
        "window_id={} pid={:?} node_count={}\n{}",
        window.id, window.pid, snap.node_count, snap.text
    );
    let text_area = snap
        .text
        .lines()
        .find(|line| line.trim_start().starts_with("- textarea") && line.contains("[ref=e"))
        .unwrap();
    println!("text_area_line={}", text_area.trim());
    let root = ax.window_root(&window).unwrap();
    close_window(&mut ax, &root);
    assert!(text_area.contains(DOCUMENT_TEXT));
}

#[test]
#[ignore = "live: run from a launcher WITHOUT an Accessibility grant"]
fn reports_permission_denied_naming_accessibility_when_untrusted() {
    assert!(
        !is_trusted(),
        "precondition: this launcher must lack Accessibility"
    );
    let error = MacAx::new().focused_element().err().unwrap();
    println!("code={} message={}", error.code.as_str(), error.message);
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(error.message.contains("Accessibility"));
}

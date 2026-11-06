//! Owned nonactivating backdrop for the live pixel comparison.
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const FIXTURE: &str = r#"
import AppKit
final class Backdrop: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let top = NSScreen.screens[0].frame.maxY
let panel = Backdrop(contentRect: NSRect(x: 100, y: top - 350, width: 400, height: 250),
                     styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.title = "Cursor capture fixture"
panel.backgroundColor = NSColor(srgbRed: 0.06, green: 0.12, blue: 0.25, alpha: 1)
panel.isOpaque = true
panel.hasShadow = false
panel.ignoresMouseEvents = true
panel.hidesOnDeactivate = false
panel.level = .floating
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
panel.orderFrontRegardless()
panel.displayIfNeeded()
DispatchQueue.main.async {
    FileHandle.standardOutput.write(Data("\(panel.windowNumber)\n".utf8))
}
DispatchQueue.global().async {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
"#;

pub(super) struct Fixture {
    child: Child,
    pub(super) window: String,
    pub(super) _dir: tempfile::TempDir,
}

impl Fixture {
    pub(super) fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("backdrop.swift");
        let binary = dir.path().join("backdrop");
        std::fs::write(&source, FIXTURE).unwrap();
        assert!(Command::new("/usr/bin/swiftc")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success());
        let child = Command::new(binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut fixture = Self {
            child,
            window: String::new(),
            _dir: dir,
        };
        let output = fixture.child.stdout.take().unwrap();
        let (sender, ready) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line);
            let _ = sender.send(result.map(|_| line));
        });
        let window = ready
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .unwrap();
        assert!(window.trim().parse::<u32>().unwrap() > 0);
        fixture.window = window.trim().to_owned();
        fixture
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        if let Err(error) = self.child.kill() {
            eprintln!("cursor fixture terminate: {error}");
        }
        self.child.wait().unwrap();
    }
}

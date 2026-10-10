//! Live pixel proof at MacCapture's real boundary, with a solid-color backdrop.
//! Requires SENPI_DESKTOP_QA_ENGINE and SENPI_DESKTOP_QA_EVIDENCE_DIR.
use super::super::{wire, Overlay, State};
use super::Helper;
#[path = "capture_fixture.rs"]
mod fixture;
use fixture::Fixture;
use crate::capture::{capture_permission, MacCapture, Screencapture};
use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector, Target};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn live_overlay() -> Overlay {
    // Attach the actual engine's private helper, never a fixture-supplied ACK.
    // The test binary itself is not an engine and cannot own this helper mode.
    let executable = std::env::var_os("SENPI_DESKTOP_QA_ENGINE").expect("explicit engine path");
    let mut child = Command::new(executable)
        .arg("--cursor-overlay")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let input = child.stdin.take().unwrap();
    let mut output = child.stdout.take().unwrap();
    let (sender, replies) = mpsc::sync_channel(1);
    let helper = Helper {
        child,
        input,
        replies,
    };
    std::thread::spawn(move || loop {
        let reply = wire::read::<wire::Reply>(&mut output);
        let finished = reply.is_err();
        if sender.send(reply).is_err() || finished {
            break;
        }
    });
    helper.receive(0).unwrap();
    let pid = helper.pid();
    Overlay(Arc::new(Mutex::new(State {
        helper: Some(helper),
        pid: Some(pid),
        token: 1,
    })))
}

fn crop(image: &RgbaImage, display: &DesktopDisplay) -> RgbaImage {
    // The primary display has global origin (0,0); the fixture covers this ROI.
    assert_eq!((display.x, display.y), (0, 0));
    let x = 175 * image.width() / display.width;
    let y = 155 * image.height() / display.height;
    let width = 90 * image.width() / display.width;
    let height = 55 * image.height() / display.height;
    image::imageops::crop_imm(image, x, y, width, height).to_image()
}

struct Activity {
    running: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Activity {
    fn start(overlay: Overlay) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let active = running.clone();
        let (started, ready) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            overlay.target(180.0, 160.0);
            let _ = started.send(overlay.available());
            // Real target/ACK traffic keeps the cursor active during arbitrarily
            // slow capture. No sleep or guessed compositor delay is used.
            while active.load(Ordering::Acquire) && overlay.available() {
                overlay.target(180.0, 160.0);
            }
        });
        let activity = Self {
            running,
            thread: Some(thread),
        };
        assert!(ready.recv_timeout(Duration::from_secs(30)).unwrap());
        activity
    }
}

impl Drop for Activity {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.thread.take().unwrap().join().unwrap();
    }
}

fn changed(left: &RgbaImage, right: &RgbaImage) -> usize {
    assert_eq!(left.dimensions(), right.dimensions());
    left.pixels()
        .zip(right.pixels())
        .filter(|(a, b)| {
            a.0.iter()
                .zip(b.0.iter())
                .take(3)
                .any(|(x, y)| x.abs_diff(*y) > 8)
        })
        .count()
}

#[test]
#[ignore = "live: coordinate with GUI owner; requires Screen Recording and swiftc"]
fn cursor_pixels_are_excluded_from_screencapture_and_core_graphics_fallback() {
    assert!(capture_permission(), "launcher needs Screen Recording");
    let evidence = std::path::PathBuf::from(
        std::env::var_os("SENPI_DESKTOP_QA_EVIDENCE_DIR")
            .expect("explicit local evidence directory"),
    );
    std::fs::create_dir_all(&evidence).unwrap();
    let fixture = Fixture::start();
    let primary = MacCapture::new(DisplaySelector::All, Screencapture::system())
        .displays()
        .unwrap()
        .into_iter()
        .find(|display| display.is_primary)
        .unwrap();
    assert!(primary.width >= 500 && primary.height >= 350);
    let overlay = live_overlay();
    let _activity = Activity::start(overlay.clone());
    let system = Screencapture::system();
    let fallback = Screencapture::with(
        fixture._dir.path().join("absent-screencapture"),
        Duration::from_secs(5),
        capture_permission,
    );
    for (name, shooter) in [
        ("screencapture", system.clone()),
        ("core-graphics", fallback),
    ] {
        let capture = MacCapture::new(DisplaySelector::Id(primary.id.clone()), shooter)
            .with_overlay(overlay.clone());
        let baseline = crop(&capture.capture(&Target::Desktop).unwrap().0, &primary);
        // The backdrop must actually cover the ROI; don't compare an arbitrary live desktop.
        assert!(baseline
            .pixels()
            .all(|p| p[0] < p[1] && p[1] < p[2] && p[2] < 100));
        let raw_system = crop(
            &system
                .run(&crate::capture::screencapture::display_args(&primary))
                .unwrap(),
            &primary,
        );
        assert!(
            changed(&baseline, &raw_system) > 10,
            "negative control: cursor must appear in raw pixels"
        );
        let visible = if name == "core-graphics" {
            crop(
                &crate::capture::fallback::capture_primary(
                    std::slice::from_ref(&primary),
                    "QA forced fallback",
                )
                .unwrap()
                .0,
                &primary,
            )
        } else {
            raw_system
        };
        assert!(
            changed(&baseline, &visible) > 10,
            "negative control for {name}"
        );
        let guarded = crop(&capture.capture(&Target::Desktop).unwrap().0, &primary);
        assert_eq!(
            changed(&baseline, &guarded),
            0,
            "overlay leaked through {name}"
        );
        assert!(capture
            .windows()
            .unwrap()
            .iter()
            .all(|w| w.pid != overlay.owner_pid()));
        baseline
            .save(evidence.join(format!("{name}-baseline.png")))
            .unwrap();
        visible
            .save(evidence.join(format!("{name}-raw-visible.png")))
            .unwrap();
        guarded
            .save(evidence.join(format!("{name}-guarded.png")))
            .unwrap();
        if name == "screencapture" {
            let window = capture
                .capture(&Target::Window(fixture.window.clone()))
                .unwrap()
                .0;
            assert!(window
                .pixels()
                .all(|p| p[0] < p[1] && p[1] < p[2] && p[2] < 100));
        }
        println!(
            "path={name} raw_overlay_pixels={} guarded_overlay_pixels=0 owner_pid_filtered=true",
            changed(&baseline, &visible)
        );
    }
}

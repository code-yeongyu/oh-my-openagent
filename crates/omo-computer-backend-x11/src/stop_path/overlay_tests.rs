use std::sync::{Arc, Mutex};

use omo_computer_core::backend::Presence;

use crate::capture::server::PixelRect;
use crate::overlay::{borders, Overlay, OverlayServer, BORDER_PX, OVERLAY_RGB};

#[derive(Default)]
struct Log {
    created: Vec<(PixelRect, u32)>,
    mapped: bool,
}

struct FakeOverlay(Arc<Mutex<Log>>);

impl OverlayServer for FakeOverlay {
    fn screen(&self) -> (u32, u32) {
        (800, 600)
    }

    fn create(&mut self, rect: PixelRect, rgb: u32) -> Result<u32, String> {
        let mut log = self.0.lock().expect("log");
        log.created.push((rect, rgb));
        Ok(u32::try_from(log.created.len()).expect("id"))
    }

    fn set_mapped(&mut self, _windows: &[u32], mapped: bool) -> Result<(), String> {
        self.0.lock().expect("log").mapped = mapped;
        Ok(())
    }
}

#[test]
fn the_border_frames_the_screen_edges_only() {
    let [top, bottom, left, right] = borders(800, 600);
    assert_eq!(
        top,
        PixelRect {
            x: 0,
            y: 0,
            width: 800,
            height: BORDER_PX
        }
    );
    assert_eq!(bottom.y, 600 - 4);
    assert_eq!((left.width, left.height), (BORDER_PX, 600));
    assert_eq!(right.x, 800 - 4);
    assert!(
        !top.contains(400, 300) && !left.contains(400, 300),
        "the centre stays clear"
    );
}

#[test]
fn show_creates_the_border_once_and_a_read_runs_with_it_unmapped() {
    let log = Arc::new(Mutex::new(Log::default()));
    let mut overlay = Overlay::new(Some(Box::new(FakeOverlay(Arc::clone(&log)))));
    overlay.show().expect("show");
    overlay.hide().expect("hide");
    overlay.show().expect("show again");
    assert_eq!(log.lock().expect("log").created.len(), 4, "created once");
    assert!(log
        .lock()
        .expect("log")
        .created
        .iter()
        .all(|(_, rgb)| *rgb == OVERLAY_RGB));

    let seen_mapped = overlay.hidden_for(|| log.lock().expect("log").mapped);
    assert!(!seen_mapped, "the capture never sees the overlay");
    assert!(
        log.lock().expect("log").mapped,
        "mapped back after the read"
    );
}

#[test]
fn no_overlay_server_is_no_presence_surface() {
    let mut overlay = Overlay::new(None);
    assert!(!overlay.available());
    let refused = overlay.show().expect_err("no surface");
    assert_eq!(refused.reason, Some("no_presence_surface"));
}

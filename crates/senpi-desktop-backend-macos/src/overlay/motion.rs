//! Display-only motion in global desktop points, using caller-supplied
//! monotonic milliseconds for deterministic animation and suppression tests.

const GLIDE_MS: f64 = 180.0;
const IDLE_MS: f64 = 1000.0;
const FADE_MS: f64 = 180.0;

#[derive(Debug, Clone, Copy)]
pub(super) struct Frame {
    pub x: f64,
    pub y: f64,
    pub alpha: f64,
}

#[derive(Debug, Default)]
pub(super) struct Motion {
    from: Option<(f64, f64)>,
    to: (f64, f64),
    input_ms: f64,
    capture: Option<u64>,
}

impl Motion {
    pub fn target(&mut self, x: f64, y: f64, now_ms: f64) {
        let from = self
            .frame(now_ms)
            .map_or((x, y), |frame| (frame.x, frame.y));
        self.from = Some(from);
        self.to = (x, y);
        self.input_ms = now_ms;
    }

    pub fn suspend(&mut self, token: u64) {
        self.capture = Some(token);
    }

    pub fn resume(&mut self, token: u64) {
        if self.capture == Some(token) {
            self.capture = None;
        }
    }

    pub fn frame(&self, now_ms: f64) -> Option<Frame> {
        let (x, y) = self.from?;
        let elapsed = (now_ms - self.input_ms).max(0.0);
        let t = (elapsed / GLIDE_MS).min(1.0);
        let eased = t * t * (3.0 - 2.0 * t);
        Some(Frame {
            x: x + (self.to.0 - x) * eased,
            y: y + (self.to.1 - y) * eased,
            alpha: if self.capture.is_some() {
                0.0
            } else {
                (1.0 - (elapsed - IDLE_MS).max(0.0) / FADE_MS).max(0.0)
            },
        })
    }
}

/// Quartz/AX are top-left global points; Cocoa is bottom-left global points.
/// Use the primary NSScreen's top, never Retina pixels or focused-screen height.
pub(super) fn cocoa_origin(x: f64, y: f64, desktop_top: f64, panel_height: f64) -> (f64, f64) {
    (x, desktop_top - y - panel_height)
}

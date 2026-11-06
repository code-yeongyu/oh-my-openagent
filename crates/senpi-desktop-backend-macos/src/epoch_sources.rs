//! macOS epoch sources, sampled whenever the session checks the epoch:
//! a display reconfiguration (the active display list, bounds or pixel size
//! changed) and a system sleep (the continuous clock ran ahead of the
//! absolute clock, which stops while the Mac sleeps). Sampling needs no run
//! loop, so the session thread reads it between and inside requests; the lock
//! screen and display sleep come from the backend's screen probe.

use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::backend::EpochSource;
use senpi_desktop_core::protocol_results::EpochReason;

/// The clocks may drift apart by this much without a sleep.
const SLEEP_THRESHOLD_NS: u128 = 1_000_000_000;
const MAX_DISPLAYS: usize = 32;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgRect {
    origin: CgPoint,
    size: CgSize,
}

#[repr(C)]
#[derive(Default)]
struct TimebaseInfo {
    numer: u32,
    denom: u32,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max_displays: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CgRect;
    fn CGDisplayPixelsWide(display: u32) -> usize;
    fn CGDisplayPixelsHigh(display: u32) -> usize;
}

extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_continuous_time() -> u64;
    fn mach_timebase_info(info: *mut TimebaseInfo) -> i32;
}

/// One active display as the reconfiguration check compares it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DisplayShape {
    id: u32,
    bounds: [i64; 4],
    pixels: (usize, usize),
}

fn displays() -> Option<Vec<DisplayShape>> {
    let mut ids = [0_u32; MAX_DISPLAYS];
    let mut count = 0_u32;
    // SAFETY: `ids` holds `MAX_DISPLAYS` slots and `count` is a valid out pointer.
    let status = unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) };
    if status != 0 {
        return None;
    }
    let shapes = ids.iter().take(count as usize).map(|&id| {
        // SAFETY: plain reads of a display id the system just listed.
        let (bounds, wide, high) = unsafe { (CGDisplayBounds(id), CGDisplayPixelsWide(id), CGDisplayPixelsHigh(id)) };
        DisplayShape {
            id,
            bounds: [bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height].map(|value| value.round() as i64),
            pixels: (wide, high),
        }
    });
    Some(shapes.collect())
}

/// How long the Mac has slept since boot, in nanoseconds.
fn slept_ns() -> u128 {
    let mut timebase = TimebaseInfo::default();
    // SAFETY: clock reads and a valid out pointer.
    let (continuous, absolute, status) =
        unsafe { (mach_continuous_time(), mach_absolute_time(), mach_timebase_info(&mut timebase)) };
    if status != 0 || timebase.denom == 0 {
        return 0;
    }
    u128::from(continuous.saturating_sub(absolute)) * u128::from(timebase.numer) / u128::from(timebase.denom)
}

fn moves(
    displays_before: Option<&[DisplayShape]>,
    displays_now: Option<&[DisplayShape]>,
    slept_before: u128,
    slept_now: u128,
) -> Vec<EpochReason> {
    let mut moves = Vec::new();
    if slept_now.saturating_sub(slept_before) > SLEEP_THRESHOLD_NS {
        moves.push(EpochReason::Sleep);
    }
    if let (Some(before), Some(now)) = (displays_before, displays_now) {
        if before != now {
            moves.push(EpochReason::Display);
        }
    }
    moves
}

struct Sampled {
    displays: Option<Vec<DisplayShape>>,
    slept_ns: u128,
    moves: Vec<EpochReason>,
}

pub(crate) struct MacEpochs(Mutex<Sampled>);

impl MacEpochs {
    /// A source whose first sample is the current display set and sleep total.
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self(Mutex::new(Sampled {
            displays: displays(),
            slept_ns: slept_ns(),
            moves: Vec::new(),
        })))
    }
}

impl EpochSource for MacEpochs {
    fn moves_since(&self, seen: usize) -> Vec<EpochReason> {
        let mut sampled = self.0.lock();
        let now_displays = displays();
        let now_slept = slept_ns();
        let fresh = moves(sampled.displays.as_deref(), now_displays.as_deref(), sampled.slept_ns, now_slept);
        sampled.moves.extend(fresh);
        if now_displays.is_some() {
            sampled.displays = now_displays;
        }
        sampled.slept_ns = now_slept;
        sampled.moves.get(seen..).map(<[EpochReason]>::to_vec).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(id: u32, width: i64) -> DisplayShape {
        DisplayShape {
            id,
            bounds: [0, 0, width, 900],
            pixels: (width as usize * 2, 1800),
        }
    }

    #[test]
    fn a_changed_display_set_or_a_clock_gap_moves_the_epoch() {
        let one = [shape(1, 1440)];
        let resized = [shape(1, 1280)];
        let two = [shape(1, 1440), shape(2, 1920)];
        assert!(moves(Some(&one), Some(&one), 0, SLEEP_THRESHOLD_NS).is_empty());
        assert_eq!(moves(Some(&one), Some(&resized), 0, 0), [EpochReason::Display]);
        assert_eq!(moves(Some(&one), Some(&two), 0, 0), [EpochReason::Display]);
        assert_eq!(moves(Some(&one), None, 0, 0), []);
        assert_eq!(
            moves(Some(&one), Some(&two), 5, 5 + SLEEP_THRESHOLD_NS + 1),
            [EpochReason::Sleep, EpochReason::Display]
        );
    }

    #[test]
    fn the_live_source_starts_without_moves() {
        let source = MacEpochs::new();
        assert!(source.moves_since(0).iter().all(|reason| *reason != EpochReason::Display));
    }
}

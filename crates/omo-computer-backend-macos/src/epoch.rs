//! macOS epoch sources (design row M18): display reconfiguration, a display's scale, a Space
//! switch, lock and unlock, sleep and wake. Each read compares the OS state with the last
//! one and queues one `epoch.changed{reason}` per source that moved, in a fixed order; the
//! first read is the baseline. The engine restart is the host's (it emits it on reconnect).

use std::collections::VecDeque;

use omo_computer_core::backend::{BackendResult, EpochChange, EpochSource};
use omo_computer_core::frame::EpochReason;
use omo_computer_core::listing::Rect;

/// What the epoch sources read at one instant.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct EpochState {
    /// Active displays with their bounds in points.
    pub displays: Vec<(u32, Rect)>,
    /// Each display's backing pixel width (a scale change keeps the bounds).
    pub pixels: Vec<(u32, u32)>,
    pub space: Option<u64>,
    pub locked: Option<bool>,
    pub asleep: Option<bool>,
}

/// The OS read of the epoch sources.
pub trait EpochOs: Send {
    fn state(&mut self) -> EpochState;
}

/// The macOS [`EpochSource`].
pub struct MacEpochSource<O> {
    os: O,
    last: Option<EpochState>,
    pending: VecDeque<EpochReason>,
}

impl<O: EpochOs> MacEpochSource<O> {
    pub const fn new(os: O) -> Self {
        Self {
            os,
            last: None,
            pending: VecDeque::new(),
        }
    }

    pub const fn os_mut(&mut self) -> &mut O {
        &mut self.os
    }
}

fn moved(last: &EpochState, now: &EpochState) -> Vec<EpochReason> {
    // Sleeping displays leave the active list: the display change is the sleep's own.
    let slept = last.asleep != now.asleep;
    let pairs = [
        (
            last.displays != now.displays && !slept,
            EpochReason::Display,
        ),
        (
            last.displays == now.displays && last.pixels != now.pixels && !slept,
            EpochReason::Scale,
        ),
        (last.space != now.space, EpochReason::Space),
        (last.locked != now.locked, EpochReason::Lock),
        (last.asleep != now.asleep, EpochReason::Sleep),
    ];
    pairs
        .into_iter()
        .filter(|(changed, _)| *changed)
        .map(|(_, reason)| reason)
        .collect()
}

/// The reason's wire token (`display`, `space`, ...).
#[must_use]
pub fn wire(reason: EpochReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl<O: EpochOs> EpochSource for MacEpochSource<O> {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        if self.pending.is_empty() {
            let now = self.os.state();
            if let Some(last) = &self.last {
                self.pending.extend(moved(last, &now));
            }
            self.last = Some(now);
        }
        Ok(self.pending.pop_front().map(|reason| EpochChange {
            reason: wire(reason),
        }))
    }
}

#[cfg(target_os = "macos")]
pub mod os {
    //! The macOS reads: display list, active Space, session lock, display sleep.

    use super::{EpochOs, EpochState};
    use crate::capture::os::cf::{self, cf_string, CfRef, Owned};
    use crate::capture::os::listing;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CfRef;
        fn CGDisplayIsAsleep(display: u32) -> bool;
        fn CGGetOnlineDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    }

    /// Displays that may sleep: the online list (the active list drops a sleeping display).
    fn online_displays() -> Vec<u32> {
        let mut ids = [0u32; 32];
        let mut count = 0u32;
        // SAFETY: `ids` holds 32 entries; `count` receives how many were written.
        if unsafe { CGGetOnlineDisplayList(32, ids.as_mut_ptr(), &raw mut count) } != 0 {
            return Vec::new();
        }
        ids.into_iter()
            .take(usize::try_from(count).unwrap_or(0))
            .collect()
    }

    /// The live epoch reads.
    #[derive(Debug, Default)]
    pub struct Os;

    fn locked() -> Option<bool> {
        // SAFETY: plain call; a +1 dictionary or null outside a GUI session.
        let session = Owned::new(unsafe { CGSessionCopyCurrentDictionary() })?;
        let key = cf_string(c"CGSSessionScreenIsLocked")?;
        Some(cf::boolean(cf::get(session.get(), key.get())))
    }

    impl EpochOs for Os {
        fn state(&mut self) -> EpochState {
            let displays = listing::displays().unwrap_or_default();
            let online = online_displays();
            // SAFETY: display ids from the online list.
            let asleep = (!online.is_empty())
                .then(|| online.iter().all(|id| unsafe { CGDisplayIsAsleep(*id) }));
            EpochState {
                displays: displays.iter().map(|d| (d.id, d.bounds)).collect(),
                pixels: displays.iter().map(|d| (d.id, d.pixel_width)).collect(),
                space: crate::spaces::active_space(),
                locked: locked(),
                asleep,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::backend::EpochSource;
    use omo_computer_core::listing::Rect;

    use super::{EpochOs, EpochState, MacEpochSource};

    struct Scripted(EpochState);

    impl EpochOs for Scripted {
        fn state(&mut self) -> EpochState {
            self.0.clone()
        }
    }

    fn base() -> EpochState {
        EpochState {
            displays: vec![(
                1,
                Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 1440.0,
                    height: 900.0,
                },
            )],
            pixels: vec![(1, 2880)],
            space: Some(3),
            locked: Some(false),
            asleep: Some(false),
        }
    }

    fn reasons(source: &mut MacEpochSource<Scripted>) -> Vec<String> {
        std::iter::from_fn(|| source.next_change().expect("read"))
            .map(|c| c.reason)
            .collect()
    }

    #[test]
    fn space_switch_emits_epoch_changed() {
        let mut source = MacEpochSource::new(Scripted(base()));
        assert!(
            reasons(&mut source).is_empty(),
            "the first read is the baseline"
        );
        source.os_mut().0.space = Some(4);
        assert_eq!(reasons(&mut source), vec!["space"]);
        assert!(reasons(&mut source).is_empty(), "one event per move");
    }

    #[test]
    fn display_reconfig_expires_frames() {
        let mut source = MacEpochSource::new(Scripted(base()));
        reasons(&mut source);
        let second = (
            2,
            Rect {
                x: 1440.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
        );
        source.os_mut().0.displays.push(second);
        source.os_mut().0.pixels.push((2, 1920));
        assert_eq!(
            reasons(&mut source),
            vec!["display"],
            "a reconfiguration, not also a scale"
        );
        source.os_mut().0.pixels[0].1 = 1440;
        assert_eq!(reasons(&mut source), vec!["scale"]);
    }

    #[test]
    fn display_sleep_is_one_sleep_event() {
        let mut source = MacEpochSource::new(Scripted(base()));
        reasons(&mut source);
        // Sleeping displays leave the active list: that is the sleep, not a reconfiguration.
        source.os_mut().0.displays.clear();
        source.os_mut().0.pixels.clear();
        source.os_mut().0.asleep = Some(true);
        assert_eq!(reasons(&mut source), vec!["sleep"]);
        source.os_mut().0 = base();
        assert_eq!(
            reasons(&mut source),
            vec!["sleep"],
            "and the wake is one event too"
        );
    }

    #[test]
    fn lock_and_sleep_each_move_the_epoch() {
        let mut source = MacEpochSource::new(Scripted(base()));
        reasons(&mut source);
        source.os_mut().0.locked = Some(true);
        source.os_mut().0.asleep = Some(true);
        assert_eq!(reasons(&mut source), vec!["lock", "sleep"]);
    }
}

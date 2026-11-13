//! The Windows stop path's view of input (d-windows.md '## Capture guard and input lock'). The
//! `WH_KEYBOARD_LL` procedure classifies each event - physical (`!LLKHF_INJECTED`), ours (injected
//! with [`crate::input::ENGINE_TAG`]) or another injector's - and only physical events move the
//! [`PhysicalChord`] tracker, so an injected stop chord never stops and the release paths can skip
//! a key the user holds. The `RegisterHotKey` backstop is judged against the hook's sightings.

use crate::input::{ENGINE_TAG, VK_CONTROL, VK_MENU, VK_SHIFT};

#[cfg(windows)]
pub mod hook;
#[cfg(test)]
mod tests;

/// `VK_ESCAPE`.
pub const VK_ESCAPE: u16 = 0x1B;
/// A `WM_HOTKEY` within this window of a hook sighting is that sighting's (d-windows.md, 250 ms).
pub const HOTKEY_DEDUPE_MS: u64 = 250;
/// The stop chord's modifiers; the chord is these plus Escape (`ctrl+alt+shift+escape`).
const STOP_MODIFIERS: [u16; 3] = [VK_CONTROL, VK_MENU, VK_SHIFT];

/// The generic virtual key of a left/right modifier code (`WH_KEYBOARD_LL` reports VK_LSHIFT 0xA0,
/// VK_RSHIFT 0xA1, VK_LCONTROL 0xA2, VK_RCONTROL 0xA3, VK_LMENU 0xA4 and VK_RMENU 0xA5, never the
/// generic VK_SHIFT/VK_CONTROL/VK_MENU); every other key is itself.
#[must_use]
pub const fn normalize_vk(vk: u16) -> u16 {
    match vk {
        0xA0 | 0xA1 => VK_SHIFT,
        0xA2 | 0xA3 => VK_CONTROL,
        0xA4 | 0xA5 => VK_MENU,
        other => other,
    }
}

/// Whether `event` completes the stop chord, given which keys are held by the SAME origin
/// (physical keys for a physical event, injected keys for an injected one).
pub fn is_chord(event: &HookEvent, held: impl Fn(u16) -> bool) -> bool {
    event.down && normalize_vk(event.vk) == VK_ESCAPE && STOP_MODIFIERS.iter().all(|vk| held(*vk))
}

/// One `KBDLLHOOKSTRUCT` as the procedure reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HookEvent {
    pub vk: u16,
    pub down: bool,
    /// `LLKHF_INJECTED`.
    pub injected: bool,
    pub extra_info: usize,
    /// The event's own `time`.
    pub time: u64,
}

/// Who produced an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Physical,
    Ours,
    Foreign,
}

impl HookEvent {
    #[must_use]
    pub const fn origin(&self) -> Origin {
        match (self.injected, self.extra_info == ENGINE_TAG) {
            (false, _) => Origin::Physical,
            (true, true) => Origin::Ours,
            (true, false) => Origin::Foreign,
        }
    }
}

/// The keys the user holds physically, and the stop-chord sighting of each event.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PhysicalChord {
    held: Vec<u16>,
    injected_down: Vec<u16>,
}

impl PhysicalChord {
    /// Folds one event in; `Some(origin)` when it completes the stop chord (only a physical
    /// sighting stops; an injected one is recorded for the hotkey dedupe).
    pub fn on_key(&mut self, event: &HookEvent) -> Option<Origin> {
        let origin = event.origin();
        let vk = normalize_vk(event.vk);
        let keys = if origin == Origin::Physical {
            &mut self.held
        } else {
            &mut self.injected_down
        };
        if event.down {
            if !keys.contains(&vk) {
                keys.push(vk);
            }
        } else {
            keys.retain(|held| *held != vk);
        }
        let keys: &[u16] = keys;
        is_chord(event, |modifier| keys.contains(&modifier)).then_some(origin)
    }

    /// The virtual keys seen physically down and not yet up.
    #[must_use]
    pub fn held(&self) -> Vec<u16> {
        self.held.clone()
    }
}

/// Each listener's view of the hook's stop count: every listener reports each stop exactly once,
/// and a listener started after a stop does not report it (review M1 of #13350: one shared
/// `swap(false)` let only the first poller see a stop).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopCursor {
    seen: u64,
}

impl StopCursor {
    /// A cursor that has seen the stops counted so far.
    #[must_use]
    pub const fn at(count: u64) -> Self {
        Self { seen: count }
    }

    /// True once for each stop counted after the cursor's last read.
    pub fn take(&mut self, count: u64) -> bool {
        let _ = count;
        let _ = self.seen;
        false
    }
}

/// Whether the listener can hear the stop chord.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Liveness {
    Listening,
    Deaf,
}

/// A listener is DEAF when its thread is not running (never started, or its message loop
/// ended and Windows dropped the hook and hotkey) or when both its hook and hotkey failed.
#[must_use]
pub const fn liveness(running: bool, hook: bool, hotkey: bool) -> Liveness {
    let _ = running;
    if hook || hotkey {
        Liveness::Listening
    } else {
        Liveness::Deaf
    }
}

/// What a `WM_HOTKEY` for the stop chord means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyVerdict {
    /// The hook saw an injected chord: never a stop.
    Discard,
    /// The hook already stopped on the physical chord.
    Dedupe,
    /// The hook saw nothing (blind behind an elevated window): stop, audited `hotkey_backstop`.
    BackstopStop,
}

/// The hook's most recent stop-chord sighting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Sightings {
    last: Option<(Origin, u64)>,
}

impl Sightings {
    pub fn record(&mut self, origin: Origin, time: u64) {
        self.last = Some((origin, time));
    }

    #[must_use]
    pub fn on_hotkey(&self, now: u64) -> HotkeyVerdict {
        match self.last {
            Some((origin, at)) if now.saturating_sub(at) <= HOTKEY_DEDUPE_MS => {
                if origin == Origin::Physical {
                    HotkeyVerdict::Dedupe
                } else {
                    HotkeyVerdict::Discard
                }
            }
            _ => HotkeyVerdict::BackstopStop,
        }
    }
}

/// Whether `vk` is one of the stop chord's keys.
#[must_use]
pub fn is_stop_chord_key(vk: u16) -> bool {
    let vk = normalize_vk(vk);
    vk == VK_ESCAPE || STOP_MODIFIERS.contains(&vk)
}

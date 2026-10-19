//! The stop chord as a low-level keyboard hook sees it: which modifiers a
//! person is holding, and whether a key-down completes the chord. Injected
//! events (`SendInput`, `keybd_event`, the engine's own input, any other
//! process) never change that state and never stop input. Pure, so the rules
//! are tested on every host.

use std::time::{Duration, Instant};

use super::chord::{Hotkey, MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN};

const VK_SHIFT: u32 = 0x10;
const VK_CONTROL: u32 = 0x11;
const VK_MENU: u32 = 0x12;
const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;
const VK_LSHIFT: u32 = 0xA0;
const VK_RSHIFT: u32 = 0xA1;
const VK_LCONTROL: u32 = 0xA2;
const VK_RCONTROL: u32 = 0xA3;
const VK_LMENU: u32 = 0xA4;
const VK_RMENU: u32 = 0xA5;

/// One key transition from the hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyEvent {
    pub vk: u32,
    pub down: bool,
    /// `LLKHF_INJECTED`: a process synthesized the event.
    pub injected: bool,
}

/// What one key event means for the stop path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// A person completed the chord: stop all input.
    Stop,
    /// The trigger key went down, but a process injected it.
    InjectedTrigger,
    /// Anything else, including a held trigger's auto-repeat.
    Other,
}

/// Physically held modifier sides, so releasing one side of a doubled
/// modifier keeps the other counted.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Held(u16);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhysicalChord {
    hotkey: Hotkey,
    held: Held,
    trigger_down: bool,
}

/// The `MOD_*` flag and the held-side bit of a modifier key, `None` for any
/// other key. The generic codes stand for their left side.
const fn modifier(vk: u32) -> Option<(u32, u16)> {
    match vk {
        VK_LCONTROL | VK_CONTROL => Some((MOD_CONTROL, 1)),
        VK_RCONTROL => Some((MOD_CONTROL, 1 << 1)),
        VK_LMENU | VK_MENU => Some((MOD_ALT, 1 << 2)),
        VK_RMENU => Some((MOD_ALT, 1 << 3)),
        VK_LSHIFT | VK_SHIFT => Some((MOD_SHIFT, 1 << 4)),
        VK_RSHIFT => Some((MOD_SHIFT, 1 << 5)),
        VK_LWIN => Some((MOD_WIN, 1 << 6)),
        VK_RWIN => Some((MOD_WIN, 1 << 7)),
        _ => None,
    }
}

impl Held {
    /// `MOD_*` flags with at least one side down.
    const fn flags(self) -> u32 {
        let mut flags = 0;
        if self.0 & 0b11 != 0 {
            flags |= MOD_CONTROL;
        }
        if self.0 & 0b1100 != 0 {
            flags |= MOD_ALT;
        }
        if self.0 & 0b11_0000 != 0 {
            flags |= MOD_SHIFT;
        }
        if self.0 & 0b1100_0000 != 0 {
            flags |= MOD_WIN;
        }
        flags
    }
}

impl PhysicalChord {
    #[must_use]
    pub const fn new(hotkey: Hotkey) -> Self {
        Self {
            hotkey,
            held: Held(0),
            trigger_down: false,
        }
    }

    #[must_use]
    pub const fn trigger_vk(&self) -> u32 {
        self.hotkey.vk
    }

    /// Feeds one hook event. Extra held modifiers still match, like the X11
    /// path: a stop is never missed for a stray key.
    pub fn key(&mut self, event: KeyEvent) -> Outcome {
        if event.vk == self.hotkey.vk {
            if event.injected {
                return if event.down { Outcome::InjectedTrigger } else { Outcome::Other };
            }
            let pressed = event.down && !self.trigger_down;
            self.trigger_down = event.down;
            let complete = self.held.flags() & self.hotkey.modifiers == self.hotkey.modifiers;
            return if pressed && complete { Outcome::Stop } else { Outcome::Other };
        }
        if event.injected {
            return Outcome::Other;
        }
        if let Some((_, side)) = modifier(event.vk) {
            self.held = if event.down { Held(self.held.0 | side) } else { Held(self.held.0 & !side) };
        }
        Outcome::Other
    }
}

/// How long a trigger the hook saw explains a later `WM_HOTKEY`: the system
/// calls the hook before it posts the hotkey message, so the two are
/// milliseconds apart.
pub const TRIGGER_WINDOW: Duration = Duration::from_millis(250);

/// The last trigger key-down the hook saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TriggerSeen {
    pub at: Instant,
    pub injected: bool,
    /// The hook already stopped input for it.
    pub stopped: bool,
}

/// Whether a `WM_HOTKEY` (the registration backstop) must stop input, given
/// the trigger the hook last saw. The hook is blind while an elevated window
/// has focus, and a lower-integrity process cannot inject into that window,
/// so a hotkey the hook did not see (or saw too long ago) is a person's.
#[must_use]
pub fn hotkey_needs_stop(seen: Option<TriggerSeen>, now: Instant) -> bool {
    match seen {
        Some(seen) if now.saturating_duration_since(seen.at) <= TRIGGER_WINDOW => !seen.injected && !seen.stopped,
        _ => true,
    }
}

#[cfg(test)]
#[path = "physical_tests.rs"]
mod tests;

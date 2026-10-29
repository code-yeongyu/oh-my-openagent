use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Holder {
    /// The user's app, or an app other than the target.
    Elsewhere,
    /// The target took it without the user choosing it.
    Stolen { buttons: [u32; 6] },
    /// The user chose the target or another process: nothing is moved for the
    /// rest of the action.
    UserChose,
    /// This action's repair is over (a newer action took over, or 30 s passed
    /// after the action): nothing more is moved, except the repeats and
    /// releases of keys whose press already was.
    Ended,
}

/// Which part of a keystroke an event is, for pairing a release with its
/// press.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stroke {
    Press,
    /// An auto-repeat of a key held down.
    Repeat,
    Release,
}

impl Stroke {
    /// A modifier key's flags change: its press when that key's
    /// device-dependent flag (`IOLLEvent.h`) is set, its release otherwise.
    /// `None` for caps lock and fn, whose events are routed one by one.
    pub const fn of_modifier(code: i64, flags: u64) -> Option<Self> {
        let bit = match code {
            59 => 0x1,    // left ⌃
            56 => 0x2,    // left ⇧
            60 => 0x4,    // right ⇧
            55 => 0x8,    // left ⌘
            54 => 0x10,   // right ⌘
            58 => 0x20,   // left ⌥
            61 => 0x40,   // right ⌥
            62 => 0x2000, // right ⌃
            _ => return None,
        };
        Some(if flags & bit == 0 {
            Self::Release
        } else {
            Self::Press
        })
    }
}

/// One key event delivered to the target.
#[derive(Clone, Copy, Debug)]
pub struct Key {
    /// Typed on a keyboard: no process posted it, this one included.
    pub physical: bool,
    pub code: i64,
    pub stroke: Option<Stroke>,
}

/// A key the user pressed through a target's tap and has not released.
#[derive(Clone, Copy, Debug)]
pub struct Held {
    pub target: i32,
    pub code: i64,
    /// The user's app its press was posted to; `None` when it went to the
    /// target.
    pub to: Option<i32>,
    /// Since when the key has read up without its release reaching the tap.
    pub lifted_at: Option<Instant>,
}

/// What every action's taps share: the latest armed action and its target,
/// whether the target holds the keyboard uninvited as that action sees it,
/// and the keys pressed through any target's tap that have not come up.
#[derive(Debug)]
pub struct Registry {
    pub latest: (u64, i32),
    /// The latest action's [`Holder::Stolen`] mouse buttons while its target
    /// holds the keyboard uninvited, for a newer action on the same target to
    /// take over: the target already has the keyboard then, so no
    /// notification tells the newer action.
    pub stolen: Option<[u32; 6]>,
    pub held: Vec<Held>,
}

/// How long a held key may read up before its release is taken to have gone
/// around the target's tap: the release reaches the tap within milliseconds
/// of the key state changing.
pub(super) const RELEASE_GRACE: Duration = Duration::from_millis(100);

/// Forgets the target's held keys that `is_down` has read up for
/// [`RELEASE_GRACE`]: their release reached an app without passing its tap.
pub(super) fn forget_lifted(
    held: &mut Vec<Held>,
    target: i32,
    is_down: impl Fn(i64) -> bool,
    now: Instant,
) {
    held.retain_mut(|held| {
        if held.target != target {
            return true;
        }
        if is_down(held.code) {
            held.lifted_at = None;
            return true;
        }
        let since = *held.lifted_at.get_or_insert(now);
        now.saturating_duration_since(since) < RELEASE_GRACE
    });
}

/// When the user last held ⌘ or ⌃, from the flags changes the session tap
/// sees.
#[derive(Clone, Copy, Debug)]
pub struct Chord {
    pub held: bool,
    /// When ⌘ or ⌃ was last down. Its release counts: ⌘-Tab picks its app
    /// as ⌘ comes up, however long it was held.
    pub last: Option<Instant>,
}

impl Chord {
    /// From the modifiers held as the action starts.
    pub const fn new(flags: u64, now: Instant) -> Self {
        let held = flags & SWITCH_MODIFIERS != 0;
        Self {
            held,
            last: if held { Some(now) } else { None },
        }
    }

    pub const fn flags_changed(&mut self, flags: u64, now: Instant) {
        let held = flags & SWITCH_MODIFIERS != 0;
        if held || self.held {
            self.last = Some(now);
        }
        self.held = held;
    }

    /// The latest time ⌘ or ⌃ was down, as of `now`; `held_now` is the
    /// system's current modifier state, in case a flags change was missed.
    pub const fn last(&self, held_now: bool, now: Instant) -> Option<Instant> {
        if held_now || self.held {
            Some(now)
        } else {
            self.last
        }
    }
}

/// What the user did with the mouse and the switch modifiers, read when a
/// notification or key arrives.
#[derive(Clone, Copy, Debug)]
pub struct UserSignals {
    pub buttons: [u32; 6],
    pub last_chord: Option<Instant>,
}

impl Registry {
    pub const fn new() -> Self {
        Self {
            latest: (0, -1),
            stolen: None,
            held: Vec::new(),
        }
    }
    pub fn prune_lifted(&mut self, target: i32, is_down: impl Fn(i64) -> bool, now: Instant) {
        forget_lifted(&mut self.held, target, is_down, now);
    }
}
impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

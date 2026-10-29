use super::*;

/// The theft bookkeeping for one action: the user's app, the target, the
/// mouse buttons as they were when the action started, and which armed
/// action it is.
#[derive(Debug)]
pub struct Theft {
    pub user: i32,
    pub target: i32,
    pub buttons: [u32; 6],
    pub holder: Holder,
    pub generation: u64,
}

impl Theft {
    pub const fn new(user: i32, target: i32, buttons: [u32; 6], generation: u64) -> Self {
        Self {
            user,
            target,
            buttons,
            holder: Holder::Elsewhere,
            generation,
        }
    }

    /// Whether the user picked an app: a mouse button went down or up since
    /// the action started, or since the theft once there is one, or ⌘/⌃ was
    /// held within the chord window.
    pub fn user_acted(&self, signals: UserSignals, now: Instant) -> bool {
        let since = match self.holder {
            Holder::Stolen { buttons } => buttons,
            _ => self.buttons,
        };
        signals.buttons != since
            || signals
                .last_chord
                .is_some_and(|at| now.saturating_duration_since(at) <= CHORD_WINDOW)
    }

    pub fn take(&mut self, signals: UserSignals, now: Instant) {
        self.holder = if self.user_acted(signals, now) {
            Holder::UserChose
        } else {
            Holder::Stolen {
                buttons: signals.buttons,
            }
        };
    }

    /// The target holds the keyboard: a theft, unless the user picked it. A
    /// theft already under way stays one unless the user picks the target now,
    /// as ⌘-Tab, a ⌃ launcher hotkey or a click does while its menu has the
    /// keyboard.
    pub fn target_holds(&mut self, signals: UserSignals, now: Instant) {
        if !self.stolen() || self.user_acted(signals, now) {
            self.take(signals, now);
        }
    }

    /// Whether `focus` is a panel of another process, such as Spotlight's or
    /// a launcher's, which the user opened to pick an app.
    pub const fn is_panel(&self, focus: i32, front: i32) -> bool {
        focus != front && focus != self.user && focus != self.target
    }

    /// Updates the holder from one `WindowServer` notification.
    pub fn notify(
        &mut self,
        notification: i64,
        recipient: i32,
        subject: i32,
        signals: UserSignals,
        now: Instant,
    ) {
        if matches!(self.holder, Holder::UserChose | Holder::Ended) {
            return;
        }
        match notification {
            NEW_FRONT if subject == self.target => self.target_holds(signals, now),
            // The user switched to an app other than theirs: the target taking
            // the keyboard later must not send their keys to the app they left.
            NEW_FRONT if subject != self.user && self.user_acted(signals, now) => {
                self.holder = Holder::UserChose;
            }
            NEW_FRONT => self.holder = Holder::Elsewhere,
            KEY_FOCUS_TAKEN if recipient == self.user && subject == self.target => {
                self.take(signals, now);
            }
            // Another process's panel took the keyboard from the user's app, or
            // from the target holding it: Spotlight or a launcher, which the user
            // opened to pick an app.
            KEY_FOCUS_TAKEN
                if (recipient == self.user || (recipient == self.target && self.stolen()))
                    && subject != self.user
                    && subject != self.target =>
            {
                self.holder = Holder::UserChose;
            }
            KEY_FOCUS_RETURNED if recipient == self.user => self.holder = Holder::Elsewhere,
            _ => {}
        }
    }

    /// After the focus tap was disabled, when `WindowServer` notifications
    /// may have been missed: the holder from who has the keyboard now, the
    /// `front` process or the `key_focus` one within it. With `key_focus`
    /// unknown, only a target in front is known to hold the keyboard; the
    /// holder otherwise stands, as a target menu may still have it from
    /// behind the user's app.
    pub fn resync(
        &mut self,
        front: i32,
        key_focus: Option<i32>,
        signals: UserSignals,
        now: Instant,
    ) {
        if matches!(self.holder, Holder::UserChose | Holder::Ended) {
            return;
        }
        let Some(focus) = key_focus else {
            if front == self.target {
                self.target_holds(signals, now);
            }
            return;
        };
        if self.is_panel(focus, front) {
            self.holder = Holder::UserChose;
        } else if front == self.target || focus == self.target {
            self.target_holds(signals, now);
        } else {
            self.holder = Holder::Elsewhere;
        }
    }

    /// Makes this the latest action, unless a newer one already is. A newer
    /// action on the same target takes over its predecessor's theft, which
    /// no notification repeats while the target keeps the keyboard. With no
    /// theft to take over, the holder is read from `holders`, the front and
    /// key focus processes as the action starts: a target menu left open
    /// after an earlier repair gave up repeats no notification either.
    pub fn register(
        &mut self,
        registry: &mut Registry,
        holders: Option<(i32, Option<i32>)>,
        signals: UserSignals,
        now: Instant,
    ) {
        if registry.latest.0 >= self.generation {
            return;
        }
        if let Some(buttons) = registry.stolen.filter(|_| registry.latest.1 == self.target) {
            self.holder = Holder::Stolen { buttons };
        } else if let Some((front, key_focus)) = holders {
            self.resync(front, key_focus, signals, now);
        }
        registry.latest = (self.generation, self.target);
        self.publish(registry);
    }

    /// Shares whether this, the latest action, sees its target holding the
    /// keyboard uninvited ([`Registry::stolen`]).
    pub const fn publish(&self, registry: &mut Registry) {
        if registry.latest.0 == self.generation {
            registry.stolen = match self.holder {
                Holder::Stolen { buttons } => Some(buttons),
                _ => None,
            };
        }
    }

    pub const fn stolen(&self) -> bool {
        matches!(self.holder, Holder::Stolen { .. })
    }

    /// Whether a key the user typed now goes to their app instead of the
    /// target. A mouse button since the theft means the user is now working
    /// in the target, which keeps its keys from then on.
    pub fn reroutes(&mut self, secure: bool, buttons: [u32; 6]) -> bool {
        let Holder::Stolen { buttons: at_theft } = self.holder else {
            return false;
        };
        if buttons != at_theft || buttons.as_chunks::<2>().0.iter().any(|pair| pair[0] != pair[1]) {
            self.holder = Holder::UserChose;
            return false;
        }
        !secure
    }

    /// Where a key event delivered to the target goes: `Some(app)` posts it
    /// there and drops the original, `None` lets it through. Only keys typed
    /// on a keyboard move: a key a process posted, this one or an automation
    /// tool, is meant for the target. A held key's repeats and release go
    /// where its press went, whoever holds the keyboard by then; a key first
    /// seen repeating counts as pressed then. Everything else is decided by
    /// [`Self::reroutes`]. Once a newer action taps the same target, its taps
    /// decide alone.
    pub fn route(
        &mut self,
        registry: &mut Registry,
        key: Key,
        secure: bool,
        buttons: [u32; 6],
    ) -> Option<i32> {
        let (latest, latest_target) = registry.latest;
        if latest != self.generation {
            if latest_target == self.target {
                return None;
            }
            self.end();
        }
        if !key.physical {
            return None;
        }
        let fresh = self.reroutes(secure, buttons).then_some(self.user);
        self.publish(registry);
        let target = self.target;
        let held = registry
            .held
            .iter()
            .position(|held| held.target == target && held.code == key.code);
        match (key.stroke, held) {
            (Some(Stroke::Release), Some(index)) => registry.held.swap_remove(index).to,
            (Some(Stroke::Repeat), Some(index)) => registry.held[index].to,
            (Some(Stroke::Press | Stroke::Repeat), held) => {
                if let Some(index) = held {
                    registry.held.swap_remove(index);
                }
                registry.held.push(Held {
                    target,
                    code: key.code,
                    to: fresh,
                    lifted_at: None,
                });
                fresh
            }
            _ => fresh,
        }
    }

    /// Stops moving keys pressed from now on.
    pub const fn end(&mut self) {
        self.holder = Holder::Ended;
    }

    /// After the action, `lingered` ago: the repair goes on only for a target
    /// that holds the keyboard from behind the user's app, as an open menu
    /// does, and for at most [`LINGER_MAX`]. A target in `front` is in plain
    /// sight, and the user's keys are theirs to aim.
    pub fn linger(&mut self, front: Option<i32>, lingered: Duration) {
        if front == Some(self.target) || lingered >= LINGER_MAX {
            self.end();
        }
    }

    /// Whether the taps can go: the target no longer holds the keyboard
    /// uninvited, and every key pressed through it into a user's app has come
    /// up.
    pub fn settled(&self, registry: &Registry) -> bool {
        // A superseding tap on this target owns its held-key records. This worker
        // already passes every key through, so retaining its ports cannot
        // help deliver a release and would leak a thread per later action.
        if registry.latest.0 != self.generation && registry.latest.1 == self.target {
            return true;
        }
        !self.stolen()
            && !registry.held
                .iter()
                .any(|held| held.target == self.target && held.to.is_some())
    }
}

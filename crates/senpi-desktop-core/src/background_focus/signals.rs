use std::time::{Duration, Instant};

use super::{SWITCH_SAMPLE, USER_SWITCH_WINDOW};

const PRESS_COUNTERS: [usize; 3] = [0, 2, 4];

#[derive(Clone, Copy, Default, Debug)]
pub struct SwitchSignals {
    pub buttons: [u32; 6],
    pub last_click: Option<Instant>,
    pub chord: bool,
    pub key_focus: Option<u32>,
    pub last_send: Option<Instant>,
    pub in_user_app: bool,
}

/// How the user, rather than an app, changed the front app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum UserSwitch {
    /// A hardware mouse button went down or up outside the user's own app: on
    /// the target's or another app's window, the Dock, the app switcher or a
    /// Spotlight result.
    Click,
    /// ⌘ or ⌃ was held: ⌘-Tab, ⌘-H, Spaces, launcher hotkeys.
    Chord,
    /// Another process's panel had the keyboard, as Spotlight's does while the
    /// user types an app name and presses Return.
    Panel,
}

/// Whether [`UserSwitchWatch`]'s latest button change, counted as a click
/// outside the user's app, may still be placed in their app.
#[derive(Clone, Copy)]
enum ClickPlacement {
    Settled,
    /// [`ClickPlacer`] may place the change in the user's app only some
    /// readings later; `previous` is the click to put back then, and `press`
    /// when the change pressed a button, the user's own-app click it becomes.
    Pending {
        previous: Option<Instant>,
        press: Option<Instant>,
    },
}

/// Answers "did the user switch to this app on purpose, and how?" for an
/// action between the user's app and the `target`, whose own focus grabs are
/// not the user's doing. It sees every reading of the switch sampler, which
/// no AX probe blocks, so a whole ⌘-Tab or launcher pick between two of the
/// observer's polls is still seen when it happened. Clicks are timed exactly
/// from the HID state.
pub(super) struct UserSwitchWatch {
    user: u32,
    pub target: u32,
    buttons: [u32; 6],
    click: Option<Instant>,
    placement: ClickPlacement,
    chord: Option<Instant>,
    /// The other process last seen holding the keyboard, and when.
    panel: Option<(u32, Instant)>,
    /// The one seen before it: Spotlight's panel, once the app picked from it
    /// takes the keyboard a moment before `WindowServer` lists it in front.
    before: Option<(u32, Instant)>,
    /// When a click placed in the user's own app was last seen, until a
    /// change of their key window uses it ([`Self::take_own_click`]).
    pub(super) own_click: Option<Instant>,
}

impl UserSwitchWatch {
    /// Starts with the user's app in front at `now`; a click up to `lookback`
    /// earlier still counts.
    pub(super) fn new(
        user: u32,
        target: u32,
        signals: SwitchSignals,
        now: Instant,
        lookback: Duration,
    ) -> Self {
        let mut watch = Self {
            user,
            target,
            buttons: signals.buttons,
            click: signals.last_click.filter(|at| {
                !signals.in_user_app && now.saturating_duration_since(*at) <= lookback
            }),
            placement: if signals.in_user_app {
                ClickPlacement::Settled
            } else {
                ClickPlacement::Pending {
                    previous: None,
                    press: signals
                        .last_click
                        .filter(|at| now.saturating_duration_since(*at) <= lookback),
                }
            },
            chord: None,
            panel: None,
            before: None,
            own_click: signals
                .last_click
                .filter(|at| signals.in_user_app && now.saturating_duration_since(*at) <= lookback),
        };
        watch.observe_held(signals, user, now);
        watch
    }

    pub(super) fn observe(&mut self, signals: SwitchSignals, front: u32, now: Instant) {
        if signals.buttons != self.buttons {
            // A press, not its release, is the click: the sampler can see the two
            // on separate readings.
            let pressed = PRESS_COUNTERS
                .into_iter()
                .any(|i| signals.buttons[i] != self.buttons[i]);
            self.buttons = signals.buttons;
            // A click in the user's own app, menus included, picks no app: the
            // target activating itself right after is still sent back.
            let pending = self.placement;
            self.placement = ClickPlacement::Settled;
            if signals.in_user_app {
                if pressed {
                    self.own_click = Some(signals.last_click.unwrap_or(now));
                }
            } else {
                self.placement = match pending {
                    // A release while its press still waits for placement is part
                    // of that click.
                    ClickPlacement::Pending { previous, press } if !pressed => {
                        ClickPlacement::Pending { previous, press }
                    }
                    _ => ClickPlacement::Pending {
                        previous: self.click,
                        press: pressed.then(|| signals.last_click.unwrap_or(now)),
                    },
                };
                self.click = Some(signals.last_click.unwrap_or(now));
            }
        } else if signals.in_user_app {
            if let ClickPlacement::Pending { previous, press } = self.placement {
                // Placed in the user's app after a reading had counted it.
                self.placement = ClickPlacement::Settled;
                self.click = previous;
                if press.is_some() {
                    self.own_click = press;
                }
            }
        }
        self.observe_held(signals, front, now);
    }

    /// Whether a click in the user's own app, seen up to
    /// [`USER_SWITCH_WINDOW`] before `now`, may have picked another of their
    /// windows.
    pub(super) fn own_click_since(&self, now: Instant) -> bool {
        self.own_click
            .is_some_and(|at| now.saturating_duration_since(at) <= USER_SWITCH_WINDOW)
    }

    /// [`Self::own_click_since`], using the click up: one click explains one
    /// change of the user's key window; a later change, such as a window opened
    /// from the keyboard, is the user's switch.
    pub(super) fn take_own_click(&mut self, now: Instant) -> bool {
        self.own_click
            .take()
            .is_some_and(|at| now.saturating_duration_since(at) <= USER_SWITCH_WINDOW)
    }

    pub(super) fn observe_held(&mut self, signals: SwitchSignals, front: u32, now: Instant) {
        if signals.chord {
            self.chord = Some(now);
        }
        // The keyboard in a process other than the front app and the action's
        // two apps: a panel such as Spotlight's or a launcher's, which takes the
        // keyboard while the user's app stays in front.
        if let Some(focus) = signals
            .key_focus
            .filter(|focus| *focus != front && *focus != self.user && *focus != self.target)
        {
            if self.panel.is_some_and(|(psn, _)| psn != focus) {
                self.before = self.panel;
            }
            self.panel = Some((focus, now));
        }
    }

    /// The latest switch that picked `front`, which came forward at `came`: a
    /// click from [`USER_SWITCH_WINDOW`] before on, which may be on `front`
    /// itself, or a ⌘/⌃ chord or panel in that window up to `came`. A ⌃ or ⌘
    /// key once `front` is in front is typing there, not a switch to it. A
    /// process that had the keyboard just before coming forward is that app
    /// taking focus a moment before `WindowServer` lists it in front, not a
    /// panel it was picked from.
    pub(super) fn picked(&self, came: Instant, front: u32) -> Option<UserSwitch> {
        let start = came.checked_sub(USER_SWITCH_WINDOW);
        let end = came + SWITCH_SAMPLE;
        let after_start = |at: &Instant| start.is_none_or(|start| *at >= start);
        let before_came = |at: &Instant| after_start(at) && *at <= end;
        let panel = [self.panel, self.before]
            .into_iter()
            .flatten()
            .filter(|(psn, at)| *psn != front && before_came(at))
            .map(|(_, at)| at)
            .max();
        [
            (self.click.filter(after_start), UserSwitch::Click),
            (self.chord.filter(before_came), UserSwitch::Chord),
            (panel, UserSwitch::Panel),
        ]
        .into_iter()
        .filter_map(|(at, how)| at.map(|at| (at, how)))
        .max_by_key(|(at, _)| *at)
        .map(|(_, how)| how)
    }
}

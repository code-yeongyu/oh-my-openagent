use super::*;

const USER: i32 = 100;
const TARGET: i32 = 200;
const SPOTLIGHT: i32 = 300;
const BUTTONS: [u32; 6] = [5, 5, 0, 0, 0, 0];
const CLICKED: [u32; 6] = [6, 5, 0, 0, 0, 0];

fn quiet() -> UserSignals {
    UserSignals {
        buttons: BUTTONS,
        last_chord: None,
    }
}

fn theft() -> Theft {
    Theft::new(USER, TARGET, BUTTONS, 1)
}

const Q: i64 = 12;
const LEFT_SHIFT: i64 = 56;
const OTHER_USER: i32 = 500;
const OTHER_TARGET: i32 = 600;
/// Posted to the user's app.
const MOVED: Option<i32> = Some(USER);
/// Let through to the target.
const KEPT: Option<i32> = None;

fn user_key(code: i64, stroke: Stroke) -> Key {
    Key {
        physical: true,
        code,
        stroke: Some(stroke),
    }
}

/// A key a process posted: this one, or an automation tool.
fn posted_key(code: i64, stroke: Stroke) -> Key {
    Key {
        physical: false,
        code,
        stroke: Some(stroke),
    }
}

/// Registers `theft` as its action starts, the user's app holding the
/// keyboard.
fn register(theft: &mut Theft, registry: &mut Registry) {
    theft.register(registry, Some((USER, Some(USER))), quiet(), Instant::now());
}

/// One action's theft, the latest armed action in its registry.
struct Rig {
    theft: Theft,
    registry: Registry,
}

impl Rig {
    fn new() -> Self {
        let registry = Registry {
            latest: (0, -1),
            stolen: None,
            held: Vec::new(),
        };
        let mut rig = Self {
            theft: theft(),
            registry,
        };
        register(&mut rig.theft, &mut rig.registry);
        rig
    }

    /// One notification, as the focus tap handles it.
    fn notify(&mut self, notification: i64, recipient: i32, subject: i32) {
        self.theft
            .notify(notification, recipient, subject, quiet(), Instant::now());
        self.theft.publish(&mut self.registry);
    }

    fn steal(&mut self) {
        self.notify(KEY_FOCUS_TAKEN, USER, TARGET);
    }

    fn give_back(&mut self) {
        self.notify(KEY_FOCUS_RETURNED, USER, USER);
    }

    fn key_with(&mut self, code: i64, stroke: Stroke, secure: bool) -> Option<i32> {
        self.theft
            .route(&mut self.registry, user_key(code, stroke), secure, BUTTONS)
    }

    fn key(&mut self, code: i64, stroke: Stroke) -> Option<i32> {
        self.key_with(code, stroke, false)
    }

    fn settled(&self) -> bool {
        self.theft.settled(&self.registry)
    }
}

const SYNTHETIC_EVENT_TAG: i64 = 1;

mod classification;
mod handoff;
mod held;
mod ownership;
mod seeded;

//! The release helper's copy of the hold ledger. The engine streams one line per press and per
//! release over the helper's pipe; when the engine dies the helper replays the releases of what is
//! still down, last pressed first, a held button's up after a warp to its press origin, skipping
//! any key the helper's own low-level hook saw the user hold (d-windows.md '## Input', RELEASE
//! HELPER). The helper sends ups only (the up-only constructors).

use super::KeyUnit;

/// One ledger line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entry {
    KeyDown(KeyUnit),
    KeyUp(KeyUnit),
    ButtonDown { button: u8, x: i32, y: i32 },
    ButtonUp { button: u8 },
}

fn key_line(tag: &str, unit: &KeyUnit) -> String {
    format!("{tag} {} {} {}", unit.vk, unit.scan, u8::from(unit.unicode))
}

fn key_of(fields: &[&str], down: bool) -> Option<KeyUnit> {
    let [vk, scan, unicode] = fields else {
        return None;
    };
    let (vk, scan) = (vk.parse().ok()?, scan.parse().ok()?);
    Some(match *unicode {
        "1" => KeyUnit::unicode(scan, down),
        "0" => KeyUnit {
            vk,
            scan,
            unicode: false,
            scan_coded: scan != 0,
            down,
        },
        _ => return None,
    })
}

impl Entry {
    /// The pipe line of this entry.
    #[must_use]
    pub fn line(&self) -> String {
        match self {
            Self::KeyDown(unit) => key_line("KD", unit),
            Self::KeyUp(unit) => key_line("KU", unit),
            Self::ButtonDown { button, x, y } => format!("BD {button} {x} {y}"),
            Self::ButtonUp { button } => format!("BU {button}"),
        }
    }

    /// Parses one pipe line; `None` for anything malformed.
    #[must_use]
    pub fn parse(line: &str) -> Option<Self> {
        let fields: Vec<&str> = line.split_ascii_whitespace().collect();
        match fields.split_first()? {
            (&"KD", rest) => key_of(rest, true).map(Self::KeyDown),
            (&"KU", rest) => key_of(rest, false).map(Self::KeyUp),
            (&"BD", [button, x, y]) => Some(Self::ButtonDown {
                button: button.parse().ok()?,
                x: x.parse().ok()?,
                y: y.parse().ok()?,
            }),
            (&"BU", [button]) => Some(Self::ButtonUp {
                button: button.parse().ok()?,
            }),
            _ => None,
        }
    }
}

/// What is down now, in press order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ledger {
    held: Vec<Entry>,
}

impl Ledger {
    pub fn apply(&mut self, entry: &Entry) {
        match entry {
            Entry::KeyDown(_) | Entry::ButtonDown { .. } => self.held.push(*entry),
            Entry::KeyUp(up) => {
                if let Some(at) = self
                    .held
                    .iter()
                    .rposition(|held| matches!(held, Entry::KeyDown(down) if down.same_key(up)))
                {
                    self.held.remove(at);
                }
            }
            Entry::ButtonUp { button } => {
                if let Some(at) = self.held.iter().rposition(
                    |held| matches!(held, Entry::ButtonDown { button: b, .. } if b == button),
                ) {
                    self.held.remove(at);
                }
            }
        }
    }
}

/// One replay step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Warp { x: i32, y: i32 },
    ButtonUp { button: u8 },
    KeyUp(KeyUnit),
}

/// The releases of everything still down, last pressed first, skipping the virtual keys in
/// `user_held`.
#[must_use]
pub fn replay(ledger: &Ledger, user_held: &[u16]) -> Vec<Step> {
    let mut steps = Vec::new();
    for entry in ledger.held.iter().rev() {
        match entry {
            Entry::KeyDown(down) if down.unicode || !user_held.contains(&down.vk) => {
                steps.push(Step::KeyUp(down.up()))
            }
            Entry::ButtonDown { button, x, y } => {
                steps.push(Step::Warp { x: *x, y: *y });
                steps.push(Step::ButtonUp { button: *button });
            }
            _ => {}
        }
    }
    steps
}

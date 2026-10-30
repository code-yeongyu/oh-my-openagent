//! Where the helper's releases go: through the routes the presses took, or,
//! for the engine's integration tests, as lines in a file (the env seam the
//! engine strips from every helper it spawns).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::holds::UserHolds;
use super::observe::{Observation, Transitions};
use super::plan::{Open, Step};
use super::tap;
use super::wire::{Input, Route, READY};

/// Records the releases in this file instead of posting them, and takes the
/// user's holds from [`USER_HOLDS_ENV`] instead of an event tap.
pub(crate) const RECORD_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_RECORD";
/// The user's holds in record mode: `key:<code>` and `button:<number>`,
/// comma-separated.
pub(crate) const USER_HOLDS_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_USER_HOLDS";

pub(crate) enum Seam {
    Native,
    Record { path: PathBuf, user: UserHolds },
}

impl Seam {
    pub(crate) fn from_env() -> Result<Self, String> {
        let Some(path) = std::env::var_os(RECORD_ENV) else {
            return Ok(Self::Native);
        };
        let mut user = UserHolds::default();
        for hold in std::env::var(USER_HOLDS_ENV).unwrap_or_default().split(',').filter(|hold| !hold.is_empty()) {
            user.set(parse_hold(hold)?, true);
        }
        Ok(Self::Record { path: PathBuf::from(path), user })
    }

    /// Starts following the user's holds, answering READY once it does.
    pub(crate) fn observe(&self, observation: &Arc<Observation>, ready: UnixStream) {
        let observation = Arc::clone(observation);
        let user = match self {
            Self::Native => None,
            Self::Record { user, .. } => Some(*user),
        };
        let started = thread::Builder::new().name("observe-user".to_owned()).spawn(move || match user {
            None => tap::observe(&observation, ready),
            Some(user) => {
                observation.holds().hold_all(user);
                let mut ready = ready;
                observation.follow(&Recorded, || {
                    if let Err(error) = ready.write_all(&[READY]) {
                        eprintln!("release helper: READY: {error}");
                    }
                });
            }
        });
        if let Err(error) = started {
            eprintln!("release helper: cannot observe the user: {error}");
        }
    }

    pub(crate) fn poster(&self) -> Result<Poster, String> {
        match self {
            Self::Native => Ok(Poster::Native),
            Self::Record { path, .. } => File::create(path)
                .map(|file| Poster::Record(BufWriter::new(file)))
                .map_err(|error| format!("cannot create {}: {error}", path.display())),
        }
    }
}

fn parse_hold(hold: &str) -> Result<Input, String> {
    let parsed = match hold.split_once(':') {
        Some(("key", code)) => code.parse().ok().map(Input::Key),
        Some(("button", number)) => number.parse().ok().map(Input::Button),
        _ => None,
    };
    parsed.ok_or_else(|| format!("{USER_HOLDS_ENV}: cannot read '{hold}'"))
}

/// Record mode has no tap: the holds it was given stay as they are.
struct Recorded;

impl Transitions for Recorded {
    fn drain(&self) {}

    fn run_briefly(&self) {
        thread::sleep(Duration::from_millis(50));
    }
}

pub(crate) enum Poster {
    Native,
    Record(BufWriter<File>),
}

impl Poster {
    pub(crate) fn apply(&mut self, open: &[Open], step: &Step) {
        let (Step::Post { id, .. } | Step::Leave { id }) = step;
        let Some(press) = open.iter().find(|press| press.id == *id) else {
            return;
        };
        let outcome = match (self, step) {
            (Self::Native, Step::Post { flags, .. }) => {
                crate::input::post_helper_release(press.route, press.input, press.text.as_deref(), *flags)
                    .map_err(|error| error.message)
            }
            (Self::Native, Step::Leave { .. }) => Ok(()),
            (Self::Record(file), step) => writeln!(file, "{}", describe(press, step))
                .and_then(|()| file.flush())
                .map_err(|error| error.to_string()),
        };
        if let Err(error) = outcome {
            eprintln!("release helper: press {id}: {error}");
        }
    }
}

/// One record-mode line: `post <id> <route> <input> [text=<c>] flags=<hex|->`
/// or `leave <id> <route> <input>`.
pub(crate) fn describe(press: &Open, step: &Step) -> String {
    let route = match press.route {
        Route::Hid => "hid".to_owned(),
        Route::Keyboard(pid) => format!("keyboard:{pid}"),
        Route::Window { pid, wid, x, y } => format!("window:{pid}:{wid}@{x},{y}"),
    };
    let input = match press.input {
        Input::Key(code) => format!("key:{code}"),
        Input::Button(number) => format!("button:{number}"),
    };
    let text = press.text.as_ref().map(|text| format!(" text={text}")).unwrap_or_default();
    match step {
        Step::Post { id, flags: Some(flags) } => format!("post {id} {route} {input}{text} flags={flags:#x}"),
        Step::Post { id, flags: None } => format!("post {id} {route} {input}{text} flags=-"),
        Step::Leave { id } => format!("leave {id} {route} {input}{text}"),
    }
}

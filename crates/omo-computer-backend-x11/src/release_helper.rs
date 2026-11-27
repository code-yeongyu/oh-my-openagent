//! The X11 release helper (design row L5). An X server keeps a key or button that a client
//! pressed through XTEST down after that client dies, so a killed engine would leave the user's
//! keyboard stuck. The engine therefore starts this helper (`omo-computer-engine
//! --x11-release-helper`) with its own connection to the same display and writes every hold to
//! the helper's stdin BEFORE pressing it. When stdin closes - the engine exited or was killed -
//! the helper warps each held button back to its press origin and releases it, releases every
//! key, restores every remapped scratch keycode, and exits.

use std::fmt;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};

use crate::input::connection::InputConnection;
use crate::input::server::{FakeInput, InputServer, XError};

/// The engine flag that runs the helper.
pub const ARG: &str = "--x11-release-helper";

/// One record of the helper's pipe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Note {
    Key(u8),
    Unkey(u8),
    Button(u8, (i16, i16)),
    Unbutton(u8),
    /// The scratch keycode and the keysyms it had, written before the remap.
    Remap(u8, Vec<u32>),
    Restored(u8),
}

impl fmt::Display for Note {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Key(code) => write!(f, "key {code}"),
            Self::Unkey(code) => write!(f, "unkey {code}"),
            Self::Button(detail, (x, y)) => write!(f, "button {detail} {x} {y}"),
            Self::Unbutton(detail) => write!(f, "unbutton {detail}"),
            Self::Remap(code, keysyms) => {
                write!(f, "remap {code}")?;
                keysyms.iter().try_for_each(|keysym| write!(f, " {keysym}"))
            }
            Self::Restored(code) => write!(f, "restored {code}"),
        }
    }
}

impl Note {
    /// One line of the pipe; `None` for a line the helper does not know.
    #[must_use]
    pub fn parse(line: &str) -> Option<Self> {
        let mut words = line.split_whitespace();
        let kind = words.next()?;
        let mut number = || words.next().and_then(|word| word.parse::<i64>().ok());
        let code = u8::try_from(number()?).ok()?;
        Some(match kind {
            "key" => Self::Key(code),
            "unkey" => Self::Unkey(code),
            "button" => Self::Button(
                code,
                (
                    i16::try_from(number()?).ok()?,
                    i16::try_from(number()?).ok()?,
                ),
            ),
            "unbutton" => Self::Unbutton(code),
            "remap" => Self::Remap(
                code,
                std::iter::from_fn(number)
                    .map(u32::try_from)
                    .collect::<Result<_, _>>()
                    .ok()?,
            ),
            "restored" => Self::Restored(code),
            _ => return None,
        })
    }
}

/// What a dead engine still holds, as the pipe told it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Holds {
    keys: Vec<u8>,
    buttons: Vec<(u8, (i16, i16))>,
    remaps: Vec<(u8, Vec<u32>)>,
}

impl Holds {
    pub fn apply(&mut self, note: Note) {
        match note {
            Note::Key(code) => self.keys.push(code),
            Note::Unkey(code) => self.keys.retain(|held| *held != code),
            Note::Button(detail, origin) => self.buttons.push((detail, origin)),
            Note::Unbutton(detail) => self.buttons.retain(|(held, _)| *held != detail),
            Note::Remap(code, keysyms) => self.remaps.push((code, keysyms)),
            Note::Restored(code) => self.remaps.retain(|(held, _)| *held != code),
        }
    }

    /// Releases everything still held: buttons at their press origins, keys last press first,
    /// then the scratch keycodes' own keysyms. A failure is logged and the rest still go out.
    pub fn release(&self, server: &impl InputServer) {
        let sent = |result: Result<(), XError>| {
            if let Err(error) = result {
                eprintln!("omo-computer-backend-x11 release helper: {error}");
            }
        };
        for (detail, (x, y)) in self.buttons.iter().rev() {
            sent(server.fake(FakeInput::Motion { x: *x, y: *y }));
            sent(server.fake(FakeInput::Button {
                detail: *detail,
                press: false,
            }));
        }
        for code in self.keys.iter().rev() {
            sent(server.fake(FakeInput::Key {
                code: *code,
                press: false,
            }));
        }
        for (code, keysyms) in self.remaps.iter().rev() {
            sent(server.remap(*code, keysyms));
        }
        sent(server.flush());
    }
}

/// Runs the helper on `display`: reads notes from stdin until it closes, then releases.
///
/// # Errors
/// The display is unreachable; nothing was ever held through this helper then.
pub fn run(display: &str) -> Result<(), XError> {
    let server = InputConnection::connect(display)?;
    let mut holds = Holds::default();
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        if let Some(note) = Note::parse(&line) {
            holds.apply(note);
        }
    }
    holds.release(&server);
    Ok(())
}

/// How the engine starts its helper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl HelperCommand {
    /// This executable with [`ARG`]: the engine binary dispatches it.
    #[must_use]
    pub fn engine() -> Option<Self> {
        let program = std::env::current_exe().ok()?;
        Some(Self {
            program,
            args: vec![ARG.to_owned()],
            env: Vec::new(),
        })
    }
}

/// The engine's end of the pipe. Dropping it closes the pipe and waits for the helper to finish
/// releasing.
pub struct Witness {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Witness {
    /// Starts the helper on `display`.
    ///
    /// # Errors
    /// The helper could not be started.
    pub fn spawn(command: &HelperCommand, display: &str) -> std::io::Result<Self> {
        use std::os::unix::process::CommandExt;
        // Its own process group: a signal to the engine's group must not take the helper too.
        let mut child = Command::new(&command.program)
            .process_group(0)
            .args(&command.args)
            .envs(command.env.iter().map(|(key, value)| (key, value)))
            .env("DISPLAY", display)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take();
        Ok(Self { child, stdin })
    }
}

impl Write for Witness {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.stdin
            .as_mut()
            .ok_or(std::io::ErrorKind::BrokenPipe)?
            .write(bytes)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.stdin.as_mut().map_or(Ok(()), Write::flush)
    }
}

impl Drop for Witness {
    fn drop(&mut self) {
        drop(self.stdin.take());
        if let Err(error) = self.child.wait() {
            eprintln!("omo-computer-backend-x11: release helper did not finish: {error}");
        }
    }
}

#[cfg(test)]
#[path = "release_helper_tests.rs"]
mod tests;

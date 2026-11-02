//! The helper process, `senpi-desktop-engine --release-helper --parent <pid>
//! --token <hex>`. Standard input is a socket carrying an input request's
//! presses, drag moves and releases. When it ends with presses still open,
//! because the engine died or abandoned the request, this posts their
//! releases through the routes the presses took, then exits.

use std::io::{ErrorKind, Read};
use std::os::fd::FromRawFd;
use std::os::unix::net::UnixStream;
use std::sync::Arc;

use super::observe::Observation;
use super::plan::{self, Open};
use super::poster::Seam;
use super::signals;
use super::tap;
use super::wire::{Record, TOKEN_LEN, VERSION};

/// Who may run the helper: the engine whose pid is on the argv, which also
/// opens the stream with the argv's per-spawn token.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Spawner {
    pub(crate) parent: i32,
    pub(crate) token: [u8; TOKEN_LEN],
}

/// Reads the arguments after `--release-helper`.
pub(crate) fn parse_args(args: &[String]) -> Result<Spawner, String> {
    let [parent_flag, parent, token_flag, token] = args else {
        return Err("refusing to run: expected --parent <pid> --token <hex>".to_owned());
    };
    if parent_flag != "--parent" || token_flag != "--token" {
        return Err("refusing to run: expected --parent <pid> --token <hex>".to_owned());
    }
    let parent = parent.parse().map_err(|_| format!("refusing to run: bad parent pid '{parent}'"))?;
    Ok(Spawner { parent, token: decode_token(token).ok_or("refusing to run: bad spawn token")? })
}

pub(crate) fn encode_token(token: &[u8; TOKEN_LEN]) -> String {
    token.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_token(text: &str) -> Option<[u8; TOKEN_LEN]> {
    if text.len() != TOKEN_LEN * 2 || !text.is_ascii() {
        return None;
    }
    let mut token = [0; TOKEN_LEN];
    for (byte, pair) in token.iter_mut().zip(text.as_bytes().chunks(2)) {
        *byte = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }
    Some(token)
}

/// Closes the tap whenever the helper returns.
struct ClosesTap;

impl Drop for ClosesTap {
    fn drop(&mut self) {
        tap::close();
    }
}

pub(crate) fn run() -> Result<(), String> {
    signals::ignore_group_signals();
    let args: Vec<String> = std::env::args().skip(2).collect();
    let spawner = parse_args(&args)?;
    // SAFETY: [FFI] getppid takes no arguments and cannot fail.
    let parent = unsafe { libc::getppid() };
    if parent != spawner.parent {
        return Err(format!("refusing to run: started by pid {parent}, not by the engine (pid {})", spawner.parent));
    }
    // SAFETY: [FFI] setsid has no preconditions. Its own session keeps a
    // hangup or group kill of the engine's terminal session from reaching it.
    unsafe { libc::setsid() };
    signals::end_on_deadline_or_abandon()?;
    let _tap = ClosesTap;
    // SAFETY: [double free] the engine passes its end of a socket pair as
    // standard input, which nothing else in this process owns.
    let mut records = Records { socket: unsafe { UnixStream::from_raw_fd(0) }, pending: Vec::new() };
    match records.next() {
        Some(Record::Hello { version, token }) if version == VERSION && token == spawner.token => {}
        _ => return Err("refusing to run: the stream does not open with this helper's spawn token".to_owned()),
    }
    let seam = Seam::from_env()?;
    let observation = Arc::new(Observation::default());
    let ready = records.socket.try_clone().ok();
    let open = records.open_presses(|| {
        if let Some(ready) = ready {
            seam.observe(&observation, ready);
        }
    });
    signals::start_release_deadline();
    if open.is_empty() {
        return Ok(());
    }
    let user = observation.settle().for_plan(plan::hid_inputs(&open));
    let mut poster = seam.poster()?;
    for step in plan::plan(&open, user) {
        poster.apply(&open, &step);
    }
    Ok(())
}

struct Records {
    socket: UnixStream,
    pending: Vec<u8>,
}

impl Records {
    /// The next record; `None` once the stream ends or turns malformed.
    fn next(&mut self) -> Option<Record> {
        let mut chunk = [0u8; 4096];
        loop {
            match Record::decode(&self.pending) {
                Ok(Some((record, length))) => {
                    self.pending.drain(..length);
                    return Some(record);
                }
                Ok(None) => {}
                Err(_) => return None,
            }
            match self.socket.read(&mut chunk) {
                Ok(0) => return None,
                Ok(length) => self.pending.extend_from_slice(&chunk[..length]),
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(_) => return None,
            }
        }
    }

    /// The presses still open when the stream ends, calling `observe` at the
    /// first [`Record::Observe`]. A malformed stream ends it too, keeping
    /// what arrived intact.
    fn open_presses(&mut self, observe: impl FnOnce()) -> Vec<Open> {
        let mut observe = Some(observe);
        let mut open = Vec::new();
        while let Some(record) = self.next() {
            if record == Record::Observe {
                if let Some(observe) = observe.take() {
                    observe();
                }
            }
            plan::apply(&mut open, record);
        }
        open
    }
}

//! The engine side of the release helper (plan D7): an input request that
//! presses starts the engine binary again as `--release-helper` before its
//! first press and streams every press with its release, every drag move and
//! every release to it. At the request's end the stream ends and the request
//! waits up to 500 ms for the helper to exit; a helper still running then with
//! nothing open is stopped. Ported from oh-my-pi
//! `desktop/macos/release_guard.rs` (MIT).

use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::process::Child;
use std::time::Duration;

use super::process::{closed_within, reap, reap_detached, spawn, stop};
use super::wire::{Input, Lane, Record, Route, READY};

/// How long a request on the shared HID route waits, before its first press
/// there, for the helper to start following the user's keys and buttons.
const READY_TIMEOUT: Duration = Duration::from_millis(250);
/// How long a request waits at its end for the helper to exit.
const EXIT_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub(crate) struct Helper {
    /// `None` for a test peer.
    pub(crate) child: Option<Child>,
    pub(crate) socket: UnixStream,
    observes: bool,
    pub(crate) ready: bool,
}

impl Helper {
    pub(crate) const fn new(child: Option<Child>, socket: UnixStream, ready: bool) -> Self {
        Self { child, socket, observes: false, ready }
    }

    pub(crate) fn write(&mut self, record: &Record) -> io::Result<()> {
        let mut bytes = Vec::new();
        record.encode(&mut bytes);
        self.socket.write_all(&bytes)
    }
}

#[derive(Debug)]
struct Entry {
    id: u32,
    lane: Lane,
    input: Input,
}

/// One input request's presses and its helper. Requests nest; the outermost
/// one owns the stream.
#[derive(Debug)]
pub(crate) struct Ledger {
    depth: usize,
    next_id: u32,
    open: Vec<Entry>,
    helper: Option<Helper>,
    /// The helper could not start, or stalled; the request runs without one.
    unguarded: bool,
    connect: fn() -> io::Result<Helper>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::with_connect(spawn)
    }
}

/// The end of the outermost request's stream.
pub(crate) struct Ending {
    helper: Helper,
    open: bool,
}

impl Ledger {
    pub(crate) fn with_connect(connect: fn() -> io::Result<Helper>) -> Self {
        Self { depth: 0, next_id: 0, open: Vec::new(), helper: None, unguarded: false, connect }
    }

    pub(crate) fn begin(&mut self) {
        self.depth += 1;
    }

    /// Ends a request; the outermost one hands back its helper to finish.
    pub(crate) fn end(&mut self) -> Option<Ending> {
        self.depth = self.depth.saturating_sub(1);
        if self.depth > 0 {
            return None;
        }
        let open = !self.open.is_empty();
        self.open.clear();
        self.unguarded = false;
        self.helper.take().map(|helper| Ending { helper, open })
    }

    /// Tells the helper that `input` goes down on `route`, before it is
    /// posted, starting the helper first. Outside a request this does nothing.
    pub(crate) fn press(&mut self, route: Route, input: Input, text: Option<&str>) {
        if self.depth == 0 {
            return;
        }
        self.start();
        if route == Route::Hid {
            self.observe();
            self.await_ready();
        }
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1);
        self.open.push(Entry { id, lane: route.lane(), input });
        self.send(&Record::Press { id, route, input, text: text.map(str::to_owned) });
    }

    /// The release of the latest press of `input` on `route`'s lane moved
    /// where `route` points, as a drag does; told before the move is posted.
    pub(crate) fn moved(&mut self, route: Route, input: Input) {
        let lane = route.lane();
        if let Some(id) = self.open.iter().rev().find(|entry| entry.lane == lane && entry.input == input).map(|entry| entry.id) {
            self.send(&Record::Update { id, route });
        }
    }

    /// Every press of `input` on `lane` was released; told after the post.
    pub(crate) fn released(&mut self, lane: Lane, input: Input) {
        let mut released = Vec::new();
        self.open.retain(|entry| {
            let hit = entry.lane == lane && entry.input == input;
            if hit {
                released.push(entry.id);
            }
            !hit
        });
        for id in released {
            self.send(&Record::Release { id });
        }
    }

    fn start(&mut self) {
        if self.helper.is_none() && !self.unguarded {
            match (self.connect)() {
                Ok(helper) => self.helper = Some(helper),
                Err(error) => {
                    eprintln!("release helper: unavailable, input runs without it: {error}");
                    self.unguarded = true;
                }
            }
        }
    }

    fn observe(&mut self) {
        if let Some(helper) = self.helper.as_mut().filter(|helper| !helper.observes) {
            helper.observes = true;
            self.send(&Record::Observe);
        }
    }

    /// Holds the request until the helper answers that it follows the user's
    /// holds, so it can tell them from this request's presses. A helper that
    /// does not answer in time or answers anything else is abandoned before
    /// the first HID press, which it could no longer tell apart.
    fn await_ready(&mut self) {
        let Some(helper) = self.helper.as_mut().filter(|helper| !helper.ready) else {
            return;
        };
        let mut answer = [0u8];
        helper.ready = helper.socket.set_read_timeout(Some(READY_TIMEOUT)).is_ok()
            && matches!(helper.socket.read(&mut answer), Ok(1))
            && answer[0] == READY;
        if !helper.ready {
            self.abandon();
        }
    }

    fn send(&mut self, record: &Record) {
        if let Some(helper) = self.helper.as_mut() {
            if helper.write(record).is_err() {
                self.abandon();
            }
        }
    }

    /// Stops a helper that missed part of the stream before it sees the
    /// stream end, so it never releases a key this request still holds.
    fn abandon(&mut self) {
        if let Some(Helper { child: Some(mut child), .. }) = self.helper.take() {
            stop(&mut child);
        }
        self.helper = None;
        self.unguarded = true;
    }
}

impl Ending {
    pub(crate) fn finish(self) {
        self.finish_within(EXIT_TIMEOUT);
    }

    /// Ends the stream so the helper releases what is still open and exits,
    /// and waits up to `exit_wait` for that. A helper still running with
    /// presses open is reaped off this thread once its releases are out; one
    /// with nothing open is stopped rather than left running.
    pub(crate) fn finish_within(self, exit_wait: Duration) {
        let Helper { child, socket, .. } = self.helper;
        if let Err(error) = socket.shutdown(Shutdown::Write) {
            eprintln!("release helper: ending the stream: {error}");
        }
        let Some(mut child) = child else {
            return;
        };
        if closed_within(&socket, exit_wait) {
            reap(&mut child);
        } else if self.open {
            reap_detached(child);
        } else {
            stop(&mut child);
        }
    }
}

//! A recording [`InputServer`]: every request that changes server state is logged in order, and
//! reads answer from a scripted state. Clones share one state, so a test keeps a handle after
//! the fake moves into the backend.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use omo_computer_core::listing::Rect;

use super::keys::GroupMap;
use super::server::{FakeInput, Hit, InputServer, Keyboard, SentEvent, Window, WmRequest, XError};
use crate::toolkit::Evidence;

/// A request that changes server state.
#[derive(Debug, Clone, PartialEq)]
pub enum Request {
    Fake(FakeInput),
    Send(Window, SentEvent),
    Remap {
        code: u8,
        keysyms: Vec<u32>,
    },
    Wm(Window, WmRequest),
    /// A line the engine wrote to its release helper.
    Note(String),
}

#[derive(Debug, Default)]
pub struct State {
    pub log: Vec<Request>,
    pub keyboard: Option<Keyboard>,
    pub down: BTreeSet<u8>,
    pub core: BTreeMap<u8, Vec<u32>>,
    pub pointer: (i16, i16),
    pub focus: Window,
    pub hit: Option<Hit>,
    pub evidence: BTreeMap<Window, Evidence>,
    pub frame: Option<Rect>,
    pub configured: Option<Rect>,
    /// The XTEST request (0-based count) that fails, once: the releases after it go through.
    pub fail_fake_from: Option<usize>,
    /// The XTEST request that panics.
    pub panic_at_fake: Option<usize>,
    /// Every remap fails (a server that refuses `ChangeKeyboardMapping`).
    pub refuse_remap: bool,
}

#[derive(Debug, Clone, Default)]
pub struct FakeServer(pub Arc<Mutex<State>>);

impl FakeServer {
    pub fn with(map: GroupMap, group: usize) -> Self {
        let server = Self::default();
        server.state().keyboard = Some(Keyboard { map, group });
        server
    }

    pub fn state(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn log(&self) -> Vec<Request> {
        self.state().log.clone()
    }

    pub fn fakes(&self) -> Vec<FakeInput> {
        self.log()
            .into_iter()
            .filter_map(|request| {
                if let Request::Fake(input) = request {
                    Some(input)
                } else {
                    None
                }
            })
            .collect()
    }
}

/// A witness that writes the helper's lines into the fake's log, in order with the requests.
pub struct NoteLog(pub FakeServer);

impl std::io::Write for NoteLog {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        for line in String::from_utf8_lossy(bytes).lines() {
            self.0.state().log.push(Request::Note(line.to_owned()));
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn refused(what: &str) -> XError {
    XError(format!("fake: {what} refused"))
}

impl InputServer for FakeServer {
    fn keyboard(&self) -> Result<Keyboard, XError> {
        self.state()
            .keyboard
            .clone()
            .ok_or_else(|| refused("keyboard"))
    }

    fn keys_down(&self) -> Result<[u8; 32], XError> {
        let mut bits = [0u8; 32];
        for code in &self.state().down {
            bits[usize::from(code / 8)] |= 1 << (code % 8);
        }
        Ok(bits)
    }

    fn keysyms_of(&self, code: u8) -> Result<Vec<u32>, XError> {
        Ok(self
            .state()
            .core
            .get(&code)
            .cloned()
            .unwrap_or_else(|| vec![0, 0]))
    }

    fn remap(&self, code: u8, keysyms: &[u32]) -> Result<(), XError> {
        let mut state = self.state();
        if state.refuse_remap {
            return Err(refused("remap"));
        }
        state.log.push(Request::Remap {
            code,
            keysyms: keysyms.to_vec(),
        });
        Ok(())
    }

    fn fake(&self, input: FakeInput) -> Result<(), XError> {
        let mut state = self.state();
        let index = state
            .log
            .iter()
            .filter(|request| matches!(request, Request::Fake(_)))
            .count();
        if state.panic_at_fake == Some(index) {
            state.panic_at_fake = None;
            drop(state);
            panic!("fake: injected panic at XTEST request {index}");
        }
        if state.fail_fake_from.is_some_and(|from| index >= from) {
            state.fail_fake_from = None;
            return Err(refused("XTEST"));
        }
        state.log.push(Request::Fake(input));
        Ok(())
    }

    fn send(&self, window: Window, event: SentEvent) -> Result<(), XError> {
        self.state().log.push(Request::Send(window, event));
        Ok(())
    }

    fn pointer(&self) -> Result<(i16, i16), XError> {
        Ok(self.state().pointer)
    }

    fn focus(&self) -> Result<Window, XError> {
        Ok(self.state().focus)
    }

    fn hit(&self, _x: i16, _y: i16) -> Result<Option<Hit>, XError> {
        Ok(self.state().hit)
    }

    fn evidence(&self, window: Window) -> Option<Evidence> {
        self.state().evidence.get(&window).cloned()
    }

    fn wm_request(&self, window: Window, request: WmRequest) -> Result<(), XError> {
        self.state().log.push(Request::Wm(window, request));
        Ok(())
    }

    fn frame(&self, _window: Window) -> Result<Rect, XError> {
        self.state().frame.ok_or_else(|| refused("frame"))
    }

    fn configured(&self, _window: Window, _wait: Duration) -> Result<Option<Rect>, XError> {
        Ok(self.state().configured)
    }

    fn flush(&self) -> Result<(), XError> {
        Ok(())
    }
}

//! The lifetime of a backend's concurrent background focus watcher.
//! The session owns the watcher, while every native press consults its lease.

use std::cell::RefCell;
use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;

use crate::background_focus::BackgroundFocusLease;
use crate::error::{CoreResult, DesktopError};

pub struct BackgroundActionState {
    pub lease: Mutex<BackgroundFocusLease>,
    pub last_send: Mutex<Option<Instant>>,
}

impl BackgroundActionState {
    pub fn new(lease: BackgroundFocusLease) -> Self {
        Self {
            lease: Mutex::new(lease),
            last_send: Mutex::new(None),
        }
    }
}

/// Native observers run independently of the backend's mutable input borrow.
/// `finish` joins the observers after their bounded settle; Drop must also join
/// on unwind. A missing platform capability returns no watcher at all.
pub trait BackgroundActionWatch: Send {
    fn state(&self) -> Arc<BackgroundActionState>;
    fn finish(&mut self) -> CoreResult<()>;
}

thread_local! {
    static CURRENT: RefCell<Option<Arc<BackgroundActionState>>> = const { RefCell::new(None) };
}

pub struct BackgroundActionScope {
    previous: Option<Arc<BackgroundActionState>>,
    _thread: PhantomData<*const ()>,
}

impl BackgroundActionScope {
    pub fn enter(state: Arc<BackgroundActionState>) -> Self {
        Self {
            previous: CURRENT.replace(Some(state)),
            _thread: PhantomData,
        }
    }
}

impl Drop for BackgroundActionScope {
    fn drop(&mut self) {
        CURRENT.set(self.previous.take());
    }
}

/// Called only for a model-requested press, never a release or restoration.
pub fn check_press() -> CoreResult<()> {
    CURRENT.with_borrow(|current| {
        if current.as_ref().is_some_and(|state| state.lease.lock().visited) {
            Err(DesktopError::user_intervened(
                "the user chose the background target; input sent before that may already have landed, and nothing more was sent",
            ))
        } else {
            Ok(())
        }
    })
}

/// Every posted input and AX write advances this action's reflex window.
pub fn note_send() {
    CURRENT.with_borrow(|current| {
        if let Some(state) = current {
            *state.last_send.lock() = Some(Instant::now());
        }
    });
}

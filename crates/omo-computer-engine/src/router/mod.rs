//! The engine router: every transport (`--stdio`, `--oneshot`, the `--mcp` shim) calls the
//! session through here, so the exposure bridge, the host latch and the v1 notifications are
//! decided once. Replaces the interim dispatch of `rpc.rs` (R31: "row 28 moves this routing
//! into the engine router").

mod audit;
mod dispatch;
mod gate;
mod refusals;
mod resume;
mod wire;

use omo_computer_backend_fake::FakeClock;
use omo_computer_core::methods::{Effect, Method};
use omo_computer_session::Session;
use serde_json::Value;

pub use dispatch::overtaken;
pub use gate::{admit, Peer};
pub use refusals::refused;
pub use wire::{notification, reply, WireError, INVALID_PARAMS, INVALID_REQUEST, PARSE_ERROR};

use crate::host::{HostLatch, HostView};

/// What the router needs besides the session.
pub struct RouterContext {
    /// The fake's clock: `$/test.advanceClock` moves it, the executor paces replies by it.
    pub fake_clock: Option<FakeClock>,
    /// `OMO_COMPUTER_FAKE_CLOCK` is installed: test-only rows exist.
    pub test_clock: bool,
    /// The bytes `engine.hello.machineId` is derived from (the runtime root's identity).
    pub machine_key: Vec<u8>,
    /// Reads the live host's view at `session.open` and `stopPath.resume` (G1).
    pub host: Box<dyn FnMut() -> HostView + Send>,
}

pub struct Router {
    session: Session,
    ctx: RouterContext,
    resume_token: Option<String>,
    stop_epoch: u64,
    host_latched: bool,
    notifications: Vec<Value>,
}

impl Router {
    #[must_use]
    pub fn new(session: Session, ctx: RouterContext) -> Self {
        Self {
            session,
            ctx,
            resume_token: None,
            stop_epoch: 0,
            host_latched: false,
            notifications: Vec::new(),
        }
    }

    /// One call from `peer`.
    ///
    /// # Errors
    /// The v1 rejection, the host latch, or the session's refusal, as the wire carries it.
    pub fn call(&mut self, peer: Peer, method: &str, params: Value) -> Result<Value, WireError> {
        let spec = gate::admit(peer, method, self.ctx.test_clock)?;
        let outcome = self
            .admit_latched(spec.method, spec.effect)
            .and_then(|()| dispatch::dispatch(self, spec.method, params.clone()));
        let secure = self.session.is_secure_target(params.get("target").and_then(Value::as_str));
        if let Some(audit) = audit::notify(spec, &params, &outcome, secure) {
            self.notifications.push(audit);
        }
        if matches!(spec.method, Method::StopPathStart | Method::StopPathStop) {
            if let Ok(status) = &outcome {
                self.notifications.push(notification("stopPath.changed", status.clone()));
            }
        }
        outcome
    }

    /// The notifications written since the last take, oldest first.
    pub fn take_notifications(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.notifications)
    }

    /// Counts the stops this router answered; a reply issued before the count moved is stale.
    #[must_use]
    pub const fn stop_epoch(&self) -> u64 {
        self.stop_epoch
    }

    /// The fake clock's time, when the backend is the fake.
    #[must_use]
    pub fn fake_now_ms(&self) -> Option<u64> {
        self.ctx.fake_clock.as_ref().map(FakeClock::now_ms)
    }

    #[must_use]
    pub const fn test_clock(&self) -> bool {
        self.ctx.test_clock
    }

    #[must_use]
    pub const fn session(&self) -> &Session {
        &self.session
    }

    pub fn session_mut(&mut self) -> &mut Session {
        &mut self.session
    }

    /// While a live host's latch holds, `session.open`, `stopPath.resume` and every exec row
    /// answer `Suspended{host_latch}` with nothing sent; `session.open` re-reads the host.
    fn admit_latched(&mut self, method: Method, effect: Effect) -> Result<(), WireError> {
        match method {
            Method::SessionOpen => self.admit_host_latch(),
            Method::StopPathResume => Ok(()),
            _ if self.host_latched && effect == Effect::Exec => {
                Err(HostLatch::refusal())
            }
            _ => Ok(()),
        }
    }

    /// Reads the live host's view (G1) and latches on a set host latch.
    ///
    /// # Errors
    /// `Suspended{host_latch}` with `nothingSent:true`.
    pub fn admit_host_latch(&mut self) -> Result<(), WireError> {
        let view = (self.ctx.host)();
        self.host_latched = view.latch.is_set();
        if let crate::host::LatchOutcome::Set { audit: Some(why) } = &view.latch {
            eprintln!("omo-computer-engine: host_latch {why}");
        }
        if self.host_latched {
            return Err(HostLatch::refusal());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

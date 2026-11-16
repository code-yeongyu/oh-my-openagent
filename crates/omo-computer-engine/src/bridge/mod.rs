//! The two bridges an external consumer drives (`--oneshot`, the `--mcp` shim): `desktop.<method>`
//! names, the router as a `Bridge` peer (host-only and test-only rows never cross), the v1 stop
//! verb `desktop.stop` as `stopPath.stop{source:"api"}`, and a standalone null-mode session the
//! bridge opens itself before the first call that needs one, with the engine's own listener as
//! its stop path (d-arch.md 'Host adapters': the shim is the host).

pub mod oneshot;

use omo_computer_session::host_view::ConsentNarrowing;
use serde_json::{json, Value};

use crate::router::{Peer, Router, WireError};

pub const METHOD_PREFIX: &str = "desktop.";
const STOP: &str = "stop";

/// What `desktop.<name>` asks the router, or the v1 rejection.
///
/// # Errors
/// A name without the prefix is unknown.
pub fn translate(method: &str, params: Value) -> Result<(String, Value), WireError> {
    let name = method.strip_prefix(METHOD_PREFIX).ok_or_else(|| WireError::rejected("unknown"))?;
    if name == STOP {
        return Ok(("stopPath.stop".to_owned(), json!({ "source": "api" })));
    }
    Ok((name.to_owned(), params))
}

/// The bridge's own session: opened once, null mode, its stop path armed on the engine's own
/// listener. A refused open (a stop marker, a set host latch) is kept: every exec call answers it.
pub struct BridgeSession {
    router: Router,
    narrowing: ConsentNarrowing,
    opened: Option<Result<(), WireError>>,
}

impl BridgeSession {
    /// `narrowing` is applied to the session right after it opens (G2: it can only narrow).
    #[must_use]
    pub const fn new(router: Router, narrowing: ConsentNarrowing) -> Self {
        Self {
            router,
            narrowing,
            opened: None,
        }
    }

    fn needs_session(name: &str) -> bool {
        !matches!(name, "stopPath.status" | "stopPath.stop" | "engine.hello")
    }

    fn open(&mut self) -> Result<(), WireError> {
        let opened = self.opened.get_or_insert_with(|| {
            let router = &mut self.router;
            router.call(Peer::Host, "session.open", json!({}))?;
            router.session_mut().narrow_consent(self.narrowing);
            router.call(Peer::Host, "stopPath.start", json!({}))?;
            router.take_notifications();
            Ok(())
        });
        opened.clone()
    }

    /// One `desktop.<method>` call.
    ///
    /// # Errors
    /// The v1 rejection, the open's refusal for a call that needs the session, or the router's.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, WireError> {
        let (name, params) = translate(method, params)?;
        let spec = crate::router::admit(Peer::Bridge, &name, self.router.test_clock())?;
        if Self::needs_session(&name) {
            if let Err(refusal) = self.open() {
                if spec.effect == omo_computer_core::methods::Effect::Exec {
                    return Err(refusal);
                }
            }
        }
        let outcome = self.router.call(Peer::Bridge, &name, params);
        self.router.take_notifications();
        outcome
    }
}

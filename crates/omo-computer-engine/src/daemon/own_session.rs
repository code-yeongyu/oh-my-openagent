//! An attach host's OWN session (row 29b): the Public and `HostOnly(session)` methods it sends
//! (anything but the v1 `desktop.*` names the shared bridge answers) run on a router of its own,
//! rebound to issuer `remote`, under the daemon's consent narrowing. An authority method is
//! refused `hostOnly{peer_kind:"attach_host"}` by the gate, with one audit line here.

use serde_json::{json, Value};

use omo_computer_session::host_view::ConsentNarrowing;
use omo_computer_session::mutate::Binding;

use crate::launch::launch;
use crate::mcp::tier::Tier;
use crate::router::{Peer, Router, WireError};

const REMOTE_ISSUER: &str = "remote";

pub struct OwnSession {
    router: Router,
    narrowing: ConsentNarrowing,
    /// A hand-wide stop was in force when this host connected: its session is suspended
    /// right after it opens.
    start_stopped: bool,
}

impl OwnSession {
    /// The attach host's router, from the daemon's own launch environment.
    ///
    /// # Errors
    /// The launch environment did not build a router.
    pub fn start(start_stopped: bool) -> Result<Self, String> {
        let launched = launch(std::env::vars().collect()).map_err(|problem| problem.to_string())?;
        let narrowing = crate::stdio::narrowing(&launched, Tier::Exec);
        let mut router = launched.router;
        // An attach host is never the spawning host: its audit lines never read `local` (Q5).
        router.session_mut().rebind(Binding { issuer: REMOTE_ISSUER.to_owned(), scope: "default".to_owned() });
        Ok(Self { router, narrowing, start_stopped })
    }

    /// One call on this host's session, with the notifications it raised.
    pub fn call(&mut self, method: &str, params: Value) -> (Result<Value, WireError>, Vec<Value>) {
        let outcome = self.router.call(Peer::AttachHost, method, params);
        if outcome.as_ref().err().and_then(|error| error.data.as_ref()).is_some_and(refused_host_only) {
            eprintln!("omo-computer-engine: audit: {method} refused hostOnly{{peer_kind:attach_host}}");
        }
        if method == "session.open" && outcome.is_ok() {
            self.router.session_mut().narrow_consent(self.narrowing);
            if self.start_stopped {
                let _ = self.router.call(Peer::Host, "stopPath.stop", json!({"source": "peer"}));
            }
        }
        (outcome, self.router.take_notifications())
    }
}

fn refused_host_only(data: &Value) -> bool {
    data["reason"] == "hostOnly" && data["peer_kind"] == "attach_host"
}

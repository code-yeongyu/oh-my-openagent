//! Builds one engine's router from the launch environment: the backend the seams select, the
//! session over the per-uid roots, and what the router reads besides (the fake's clock, the
//! live host's view). Every entry mode (`--stdio`, `--oneshot`, `--mcp`, `--serve`) starts here.

use omo_computer_core::env::FAKE_BACKEND;
use omo_computer_core::paths;
use omo_computer_session::Session;

use crate::host::{read_host_view, Authority, HostView, LatchOutcome};
use crate::route::{self, BACKEND_SEAM};
use crate::router::{Router, RouterContext};

const FAKE_CLOCK_SEAM: &str = "OMO_COMPUTER_FAKE_CLOCK";

pub struct Launched {
    pub router: Router,
    /// Replies are held by the fake clock's advance: the fake without its clock seam.
    pub pace: bool,
    pub fake: bool,
    pub vars: Vec<(String, String)>,
}

/// The view of a run with no live host to ask (in-process tests, the self test).
#[must_use]
pub fn host_less_view() -> HostView {
    HostView {
        latch: LatchOutcome::FileOnly,
        authority: Authority::FileOnly,
    }
}

/// # Errors
/// A refused seam, no backend, or no per-uid root, as the one stderr line the caller prints.
pub fn launch(vars: Vec<(String, String)>) -> Result<Launched, String> {
    let lookup = |name: &str| vars.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone());
    let fake = lookup(BACKEND_SEAM).as_deref() == Some(FAKE_BACKEND);
    let test_clock = fake && lookup(FAKE_CLOCK_SEAM).is_some();
    let launched = route::launch(&vars).map_err(|error| error.to_string())?;
    let roots = paths::resolve(lookup).map_err(|error| format!("state directory unavailable: {error}"))?;
    let host_vars = vars.clone();
    let ctx = RouterContext {
        fake_clock: launched.fake_clock,
        test_clock,
        machine_key: roots.runtime.to_string_lossy().into_owned().into_bytes(),
        host: Box::new(move || {
            read_host_view(|name| host_vars.iter().find(|(key, _)| key == name).map(|(_, v)| v.clone()), fake)
        }),
    };
    let session = match (&ctx.fake_clock, test_clock) {
        (Some(clock), true) => {
            let clock = clock.clone();
            Session::for_roots_clocked(launched.backend, &roots, move || clock.now_ms())
        }
        _ => Session::for_roots(launched.backend, &roots),
    }
    .with_generation(crate::router::GENERATION);
    Ok(Launched {
        router: Router::new(session, ctx),
        pace: fake && !test_clock,
        fake,
        vars,
    })
}

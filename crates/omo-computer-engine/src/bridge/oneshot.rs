//! `--oneshot`: the v1 null-mode contract for external consumers - one JSON-RPC line in, one
//! reply line out with the request id echoed verbatim, one engine process with its own
//! standalone session. It never starts a daemon (row 29 owns the daemon and its lock).

use std::io::{self, BufRead, Write};

use omo_computer_session::host_view::ConsentNarrowing;

use super::BridgeSession;
use crate::executor::framing::{parse, Line};
use crate::router::{reply, Router};

/// # Errors
/// Reading the request or writing the reply failed.
pub fn run(router: Router, narrowing: ConsentNarrowing, input: impl BufRead, output: &mut impl Write) -> io::Result<()> {
    let mut line = Vec::new();
    input.take(1 << 20).read_until(b'\n', &mut line)?;
    let message = match parse(&line) {
        Line::Blank | Line::Notification { .. } => return Ok(()),
        Line::Invalid(id, error) => reply(&id, &Err(error)),
        Line::Request { id, method, params } => {
            let mut bridge = BridgeSession::new(router, narrowing);
            reply(&id, &bridge.call(&method, params))
        }
    };
    writeln!(output, "{message}")?;
    output.flush()
}

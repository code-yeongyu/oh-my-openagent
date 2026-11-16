//! `--enable-daemon --serve --endpoint <path> --lock <path>`: the minimal same-uid server row 28
//! needs to prove that an engine the host did not spawn is latched by the live host too (d-arch.md
//! 'Engine binary and modes', the rogue `--serve` under a caller-chosen lock). One connection at
//! a time over a Unix socket, each through the same executor as `--stdio`. Row 29 replaces it
//! with the daemon: concurrent clients, the peer check, the capability, the outbox.

use std::fs::OpenOptions;
use std::io::{self, BufReader};
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::process::ExitCode;

use crate::executor::Executor;
use crate::launch::launch;

/// # Errors
/// The lock is held, the endpoint cannot be bound, or a connection failed.
fn serve(endpoint: &Path, lock: &Path) -> io::Result<()> {
    OpenOptions::new().write(true).create_new(true).open(lock)?;
    let listener = UnixListener::bind(endpoint)?;
    let launched = launch(std::env::vars().collect()).map_err(io::Error::other)?;
    let (mut router, pace) = (launched.router, launched.pace);
    for stream in listener.incoming() {
        let stream = stream?;
        let reader = BufReader::new(stream.try_clone()?);
        router = Executor::new(router, stream, pace).run(reader)?;
    }
    Ok(())
}

pub fn run(endpoint: &Path, lock: &Path) -> ExitCode {
    match serve(endpoint, lock) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: --serve: {error}");
            ExitCode::FAILURE
        }
    }
}

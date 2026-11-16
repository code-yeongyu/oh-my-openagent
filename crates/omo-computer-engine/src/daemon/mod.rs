//! `--enable-daemon --serve --endpoint <path> --lock <path>`: the per-uid engine daemon (row 29).
//! Lock-filed start (a second start loses the lock), the generation capability read once from the
//! inherited stdin (first line, 64 hex digits; never argv, env or a file, d-remote.md:204),
//! concurrent connections each admitted before any frame is decoded.

mod admit;
mod conn;
mod idle;
mod state;

use std::fs::OpenOptions;
use std::io::{self, BufRead};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use admit::{Capability, CAPABILITY_LEN};
use state::Shared;

fn read_capability() -> io::Result<Capability> {
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    let line = line.trim();
    let invalid = || io::Error::new(io::ErrorKind::InvalidInput, "no generation capability on stdin");
    if line.len() != CAPABILITY_LEN * 2 {
        return Err(invalid());
    }
    let mut capability: Capability = [0; CAPABILITY_LEN];
    for (index, byte) in capability.iter_mut().enumerate() {
        *byte = u8::from_str_radix(line.get(index * 2..index * 2 + 2).ok_or_else(invalid)?, 16).map_err(|_| invalid())?;
    }
    Ok(capability)
}

/// The launcher holds the other end of the capability pipe: when it dies the pipe reads EOF
/// and the daemon ends with it (no orphan daemon outliving its launcher).
fn watch_launcher() {
    std::thread::spawn(|| {
        let mut rest = Vec::new();
        let _ = io::Read::read_to_end(&mut io::stdin().lock(), &mut rest);
        eprintln!("omo-computer-engine: --serve: launcher gone, exiting");
        std::process::exit(0);
    });
}

/// Ends the daemon once it has been idle with no open session for [`idle::IDLE_EXIT`].
fn watch_idle(shared: std::sync::Arc<Shared>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        if shared.idle.expired() {
            eprintln!("omo-computer-engine: --serve: idle with no open session, exiting");
            std::process::exit(0);
        }
    });
}

fn serve(endpoint: &Path, lock: &Path) -> io::Result<()> {
    OpenOptions::new().write(true).create_new(true).open(lock)?;
    let generation = read_capability()?;
    watch_launcher();
    let runtime = std::env::var_os("OMO_COMPUTER_RUNTIME_DIR")
        .map_or_else(|| endpoint.parent().map(Path::to_path_buf).unwrap_or_default(), PathBuf::from);
    let fake = std::env::var("OMO_COMPUTER_BACKEND").is_ok_and(|backend| backend == "fake");
    let spawning_host = i32::try_from(std::os::unix::process::parent_id()).unwrap_or_default();
    let shared = Shared::new(runtime, fake, generation, vec![spawning_host]);
    let listener = UnixListener::bind(endpoint)?;
    watch_idle(std::sync::Arc::clone(&shared));
    for (connection, stream) in listener.incoming().enumerate() {
        let Ok(mut stream) = stream else { continue };
        let shared = std::sync::Arc::clone(&shared);
        std::thread::spawn(move || match admit::admit(&mut stream, &shared) {
            Some(grant) => conn::serve(stream, grant, &shared, connection),
            None => {
                eprintln!("omo-computer-engine: audit: connection {connection} closed unauthorized before any frame");
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        });
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

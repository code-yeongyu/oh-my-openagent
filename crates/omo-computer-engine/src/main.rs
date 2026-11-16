//! The omo-computer-engine binary: router, entry modes, exposure bridge, MCP shim, daemon and launcher.

mod bridge;
mod cli;
mod executor;
mod helpers;
mod host;
mod launch;
mod mcp;
mod route;
mod router;
mod schema;
mod selftest;
#[cfg(unix)]
#[cfg(unix)]
mod daemon;
mod stdio;

use std::process::ExitCode;

use cli::Mode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = match cli::parse(&args) {
        Ok(mode) => mode,
        Err(message) => {
            eprintln!("{message}\n{}", cli::USAGE);
            return ExitCode::from(2);
        }
    };
    match mode {
        Mode::Version => {
            println!("omo-computer-engine {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Mode::Schema => schema::run(),
        Mode::Selftest { json } => selftest::run(json),
        Mode::PresenceHelper => helpers::presence::run(),
        Mode::ReleaseHelper => helpers::release::run(),
        Mode::Stdio => stdio::run(),
        Mode::Oneshot => stdio::oneshot(),
        Mode::Mcp { tier } => stdio::mcp(tier),
        #[cfg(unix)]
        Mode::Serve { endpoint, lock, start_stopped } => daemon::run(&endpoint, &lock, start_stopped),
        #[cfg(unix)]
        Mode::OneshotAttach { endpoint } => bridge::attach::run(&endpoint),
        #[cfg(not(unix))]
        Mode::Serve { .. } | Mode::OneshotAttach { .. } => ExitCode::from(2),
    }
}

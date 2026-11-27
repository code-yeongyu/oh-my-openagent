//! The omo-computer-engine binary: router, entry modes, exposure bridge, MCP shim, daemon and launcher.

mod cli;
mod route;
mod rpc;
mod schema;
mod selftest;
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
        Mode::Stdio => stdio::run(),
        Mode::X11ReleaseHelper => x11_release_helper(),
    }
}

#[cfg(target_os = "linux")]
fn x11_release_helper() -> ExitCode {
    let display = std::env::var("DISPLAY").unwrap_or_default();
    match omo_computer_backend_x11::release_helper::run(&display) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: x11 release helper: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn x11_release_helper() -> ExitCode {
    eprintln!("omo-computer-engine: the x11 release helper runs on Linux only");
    ExitCode::from(2)
}

//! `omo-git-job-helper` (omo#10391, design v4.2): `run --op <id> [--linger-ms <n>]`, `probe`, `selftest`.
//! Windows only; every other OS gets exit 2.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "the portable contract is exercised by unit tests only"
    )
)]
mod cli;
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "the portable contract is exercised by unit tests only"
    )
)]
mod frames;
#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "the portable contract is exercised by unit tests only"
    )
)]
mod probe_lines;

#[cfg(windows)]
mod control;
#[cfg(windows)]
mod job;
#[cfg(windows)]
mod members;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod run;
#[cfg(windows)]
mod security;
#[cfg(windows)]
mod selftest;
#[cfg(windows)]
mod spawn;
#[cfg(windows)]
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exit = cli::parse(&args).map_or(cli::Exit::Usage, dispatch);
    std::process::exit(exit.code());
}

#[cfg(windows)]
fn dispatch(command: cli::Command) -> cli::Exit {
    match command {
        cli::Command::Run { op, linger_ms } => run::run(&op, linger_ms),
        cli::Command::Probe => probe::probe(),
        cli::Command::Selftest => selftest::selftest(),
    }
}

#[cfg(not(windows))]
fn dispatch(_command: cli::Command) -> cli::Exit {
    cli::Exit::Usage
}

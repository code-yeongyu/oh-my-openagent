//! The standard-stream entry modes: `--stdio` (the executor over the router), `--oneshot` and
//! the `--mcp` shim (the bridges over a standalone session). Each builds its router from the
//! launch environment and prints one stderr line when it cannot.

use std::io;
use std::process::ExitCode;

use crate::bridge::{oneshot, BridgeSession};
use crate::executor::Executor;
use crate::launch::{launch, Launched};
use crate::mcp::tier::{self, Tier};
use crate::mcp::Server;

fn launched() -> Result<Launched, ExitCode> {
    launch(std::env::vars().collect()).map_err(|error| {
        eprintln!("omo-computer-engine: {error}");
        ExitCode::from(2)
    })
}

fn finish(mode: &str, outcome: io::Result<()>) -> ExitCode {
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: {mode}: {error}");
            ExitCode::FAILURE
        }
    }
}

pub fn run() -> ExitCode {
    match launched() {
        Ok(launched) => finish(
            "stdio",
            Executor::new(launched.router, io::stdout().lock(), launched.pace)
                .run(io::BufReader::new(io::stdin()))
                .map(drop),
        ),
        Err(code) => code,
    }
}

fn narrowing(launched: &Launched, requested: Tier) -> omo_computer_session::host_view::ConsentNarrowing {
    let vars = launched.vars.clone();
    tier::narrowing(
        move |name| vars.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone()),
        launched.fake,
        requested,
    )
}

pub fn oneshot() -> ExitCode {
    match launched() {
        Ok(launched) => {
            let narrowing = narrowing(&launched, Tier::Exec);
            finish("oneshot", oneshot::run(launched.router, narrowing, io::stdin().lock(), &mut io::stdout().lock()))
        }
        Err(code) => code,
    }
}

pub fn mcp(requested: Tier) -> ExitCode {
    match launched() {
        Ok(launched) => {
            let narrowing = narrowing(&launched, requested);
            let server = Server::new(BridgeSession::new(launched.router, narrowing));
            finish("mcp", server.run(io::stdin().lock(), &mut io::stdout().lock()))
        }
        Err(code) => code,
    }
}

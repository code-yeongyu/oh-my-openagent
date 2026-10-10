//! `senpi-desktop-engine`: the standalone desktop engine. JSON-RPC 2.0 over
//! NDJSON on stdio (default) or a local socket; `--selftest` and `--schema`
//! for locators and drift gates.

mod cli;
mod client;
mod config;
mod connection;
mod daemon;
mod engine;
mod fake_listener;
mod mcp;
mod oneshot;
mod outbox;
mod route;
mod rpc;
mod selftest;
mod serve;
mod stop_path;

use clap::Parser;
use std::process::ExitCode;
use std::sync::Arc;

use crate::cli::{Cli, Mode};
use crate::config::EngineConfig;
use crate::engine::Engine;

const USAGE_ERROR: u8 = 2;

fn main() -> ExitCode {
    match Cli::parse().mode() {
        Mode::Schema => print_schema(),
        Mode::Oneshot { endpoint, serve_args } => match endpoint.map_or_else(client::default_endpoint, Ok) {
            Ok(endpoint) => {
                match oneshot::run(|request| client::exchange_or_start(&endpoint, &serve_args, request)) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(error) => fail(&format!("--oneshot: {error}")),
                }
            }
            Err(error) => fail(&format!("--oneshot: {error}")),
        },
        Mode::Mcp {
            endpoint,
            serve_args,
            allow_host_relay_only_stop,
        } => match endpoint.map_or_else(client::default_endpoint, Ok) {
            Ok(endpoint) => {
                let server = mcp::Server::new(allow_host_relay_only_stop, |request: &serde_json::Value| {
                    client::exchange_or_start(&endpoint, &serve_args, request)
                });
                match server.run(std::io::stdin().lock(), std::io::stdout().lock()) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(error) => fail(&format!("--mcp: {error}")),
                }
            }
            Err(error) => fail(&format!("--mcp: {error}")),
        },
        Mode::Resume { endpoint } => match endpoint.map_or_else(client::default_endpoint, Ok) {
            Ok(endpoint) => match client::resume(&endpoint) {
                Ok(status) => {
                    println!("{status}");
                    ExitCode::SUCCESS
                }
                Err(error) => fail(&format!("--resume: {error}")),
            },
            Err(error) => fail(&format!("--resume: {error}")),
        },
        Mode::Selftest => block_on(async {
            selftest::run_selftest()
                .await
                .map(|()| println!("engine: selftest ok"))
        }),
        Mode::Stdio => with_engine(|engine| async move {
            let served =
                connection::serve_connection(Arc::clone(&engine), tokio::io::stdin(), tokio::io::stdout())
                    .await;
            engine.shutdown().await;
            served.map_err(|error| error.to_string())
        }),
        Mode::Serve {
            endpoint,
            idle,
            daemon,
        } => with_engine(|engine| async move {
            daemon::open_daemon_session(&engine, &daemon, &client::token_file(&endpoint)).await?;
            serve::run_serve(engine, &endpoint, idle)
                .await
                .map_err(|error| format!("--serve {endpoint}: {error}"))
        }),
    }
}

fn print_schema() -> ExitCode {
    match serde_json::to_string_pretty(&senpi_desktop_core::engine_schema()) {
        Ok(schema) => {
            println!("{schema}");
            ExitCode::SUCCESS
        }
        Err(error) => fail(&format!("cannot encode the schema: {error}")),
    }
}

fn with_engine<F, Fut>(serve: F) -> ExitCode
where
    F: FnOnce(Arc<Engine>) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let config = match EngineConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("senpi-desktop-engine: {error}");
            return ExitCode::from(USAGE_ERROR);
        }
    };
    match Engine::start(config) {
        Ok(engine) => block_on(serve(Arc::new(engine))),
        Err(error) => fail(&error.to_string()),
    }
}

fn block_on(work: impl std::future::Future<Output = Result<(), String>>) -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => return fail(&format!("cannot start the async runtime: {error}")),
    };
    let outcome = runtime.block_on(work);
    // A session thread stuck in a backend call must not hold the exit.
    runtime.shutdown_background();
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(&error),
    }
}

fn fail(message: &str) -> ExitCode {
    eprintln!("senpi-desktop-engine: {message}");
    ExitCode::FAILURE
}

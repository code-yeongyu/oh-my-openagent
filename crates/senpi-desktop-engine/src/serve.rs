//! `--serve <endpoint>` SKELETON: the stdio protocol on a local socket (a
//! unix socket path, or `\\.\pipe\<name>` on Windows), one client at a time,
//! one session shared by successive clients, exit after `--idle-ms` without a
//! client. The daemon session rule, `--oneshot`, and `--resume` are todo 47.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use crate::connection::serve_connection;
use crate::engine::Engine;

/// # Errors
/// The endpoint cannot be created or accepting a client failed.
pub async fn run_serve(engine: Arc<Engine>, endpoint: &str, idle: Duration) -> io::Result<()> {
    let served = listen(&engine, endpoint, idle).await;
    engine.shutdown().await;
    served
}

/// The readiness line a supervisor waits for before connecting.
fn listening(endpoint: &str) {
    eprintln!("senpi-desktop-engine: serving on {endpoint}");
}

fn client_failed(error: &io::Error) {
    eprintln!("senpi-desktop-engine: --serve client connection failed: {error}");
}

#[cfg(unix)]
async fn listen(engine: &Arc<Engine>, endpoint: &str, idle: Duration) -> io::Result<()> {
    let listener = tokio::net::UnixListener::bind(endpoint)?;
    listening(endpoint);
    let served = async {
        while let Ok(accepted) = tokio::time::timeout(idle, listener.accept()).await {
            let (reader, writer) = accepted?.0.into_split();
            if let Err(error) = serve_connection(Arc::clone(engine), reader, writer).await {
                client_failed(&error);
            }
        }
        Ok(())
    }
    .await;
    let removed = std::fs::remove_file(endpoint);
    served.and(removed)
}

#[cfg(windows)]
async fn listen(engine: &Arc<Engine>, endpoint: &str, idle: Duration) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let mut server = ServerOptions::new().first_pipe_instance(true).create(endpoint)?;
    listening(endpoint);
    while let Ok(connected) = tokio::time::timeout(idle, server.connect()).await {
        connected?;
        let client = std::mem::replace(&mut server, ServerOptions::new().create(endpoint)?);
        let (reader, writer) = tokio::io::split(client);
        if let Err(error) = serve_connection(Arc::clone(engine), reader, writer).await {
            client_failed(&error);
        }
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
async fn listen(_engine: &Arc<Engine>, endpoint: &str, _idle: Duration) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        format!("--serve {endpoint}: local sockets are unsupported on this platform"),
    ))
}

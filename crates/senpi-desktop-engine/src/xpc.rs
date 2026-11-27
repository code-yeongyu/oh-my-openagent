//! Adapter from authenticated, approved XPC frames to the existing NDJSON route.
use crate::{config::EngineConfig, connection, engine::Engine, sessions::Sessions};
use senpi_desktop_core::{methods::Method, types::DesktopSessionOptions};
use senpi_desktop_session::{BackendSelection, SessionTimeouts};
use senpi_desktop_xpc::{AgentTransport, Incoming};
use std::sync::Arc;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    task::JoinSet,
};

trait FrameStream: Send + Sync + 'static {
    fn receive(&self) -> impl std::future::Future<Output = Option<Vec<u8>>> + Send;
    fn send(&self, frame: &[u8]) -> Result<(), senpi_desktop_xpc::TransportError>;
    fn close(&self);
}

impl FrameStream for Incoming {
    fn receive(&self) -> impl std::future::Future<Output = Option<Vec<u8>>> + Send {
        Incoming::receive(self)
    }
    fn send(&self, frame: &[u8]) -> Result<(), senpi_desktop_xpc::TransportError> {
        Incoming::send(self, frame)
    }
    fn close(&self) { Incoming::close(self); }
}

pub(crate) async fn run(name: &str) -> Result<(), String> {
    let latch = crate::stop_latch::StopLatch::open().map_err(|error| error.to_string())?;
    let sessions = Arc::new(Sessions::persistent(latch));
    #[cfg(test)]
    println!("XPC_TEST_READY stopped={}", sessions.stopped_before_connection());
    let transport = AgentTransport::start(name).map_err(|error| error.to_string())?;
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! {
            stream = transport.next() => {
                let Some(stream) = stream else { break; };
                let sessions = Arc::clone(&sessions);
                let opener = Arc::clone(&sessions);
                tasks.spawn(async move {
                    #[cfg(not(test))]
                    serve(stream, sessions, move |config| opener.open(config)).await;
                    #[cfg(test)]
                    {
                        let observers = crate::xpc_test_harness::Observers::default();
                        let factory = observers.clone();
                        serve(stream, sessions, move |mut config| {
                            config.timeouts.operation = std::time::Duration::from_secs(120);
                            opener.open_with(config, factory)
                        }).await;
                        observers.finish();
                    }
                });
            }
            joined = tasks.join_next(), if !tasks.is_empty() => {
                if let Some(Err(error)) = joined {
                    eprintln!("senpi-desktop-engine: XPC session task failed: {error}");
                }
            }
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Ok(())
}

async fn serve(
    stream: impl FrameStream,
    sessions: Arc<Sessions>,
    open: impl FnOnce(EngineConfig) -> senpi_desktop_core::error::CoreResult<Arc<Engine>>,
) {
    let stream = Arc::new(stream);
    let first = loop {
        let Some(frame) = stream.receive().await else {
            return;
        };
        let Ok(method) = sessions.classify(&frame) else {
            return;
        };
        let Ok(request) = connection::parse_request(&frame) else {
            return;
        };
        match method {
            Method::EngineHello => {
                if let Some(id) = request.id {
                    let line = crate::rpc::reply_line(id, crate::rpc::to_result(Engine::hello()));
                    if stream.send(line.as_bytes()).is_err() {
                        return;
                    }
                }
            }
            Method::SessionOpen => {
                let params = if request.params.is_null() {
                    serde_json::json!({})
                } else {
                    request.params
                };
                if serde_json::from_value::<DesktopSessionOptions>(params).is_err() {
                    return;
                }
                break frame;
            }
            _ => return,
        }
    };
    // This point can only be reached after O1, finite authorization, the bound
    // capability/sequence and a valid session.open. No environment-selected backend.
    let config = EngineConfig {
        #[cfg(not(test))]
        selection: BackendSelection::Platform,
        #[cfg(test)]
        selection: BackendSelection::FakeScenario(Box::default()),
        timeouts: SessionTimeouts::default(),
        fake_clock: false,
    };
    let engine = match open(config) {
        Ok(engine) => engine,
        Err(_) => return,
    };
    let (engine_io, transport_io) = tokio::io::duplex(2 * 1024 * 1024);
    let (reader, writer) = tokio::io::split(engine_io);
    let (outgoing, incoming) = tokio::io::split(transport_io);
    let input_stream = Arc::clone(&stream);
    let input = async move {
        let mut first = Some(first);
        let source = &input_stream;
        if let Err(error) = senpi_desktop_xpc::forward_frames(incoming, || {
            let first = first.take();
            async move {
                match first { Some(frame) => Some(frame), None => source.receive().await }
            }
        }, |frame| sessions.classify(frame).is_ok()).await {
            eprintln!("senpi-desktop-engine: closing XPC input failed: {error}");
        }
        input_stream.close();
    };
    let output_stream = Arc::clone(&stream);
    let output = async move {
        let mut outgoing = BufReader::new(outgoing);
        let mut line = String::new();
        loop {
            line.clear();
            match outgoing.read_line(&mut line).await {
                Ok(0) | Err(_) => {
                    output_stream.close();
                    return;
                }
                Ok(_) => {
                    if output_stream.send(line.trim_end().as_bytes()).is_err() {
                        output_stream.close();
                        return;
                    }
                }
            }
        }
    };
    let routed = connection::serve_session_connection(Arc::clone(&engine), reader, writer);
    let (_, _, result) = tokio::join!(input, output, routed);
    if let Err(error) = result {
        eprintln!("senpi-desktop-engine: XPC session transport ended: {error}");
    }
    engine.shutdown().await;
}

#[cfg(test)]
mod tests;

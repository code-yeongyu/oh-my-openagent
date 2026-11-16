//! T25-6 / T25-7: the peer check through the in-crate seam of
//! [`super::listen_checked`]; the integration tests run the non-test binary,
//! which always uses the kernel's lookup.

use std::os::unix::fs::DirBuilderExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_session::{BackendSelection, SessionTimeouts};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use super::{bind, listen_checked};
use crate::config::EngineConfig;
use crate::engine::Engine;
use crate::peer::euid;

const HELLO: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"engine.hello\",\"params\":{}}\n";
const GUARD: Duration = Duration::from_secs(10);

fn engine() -> Arc<Engine> {
    Arc::new(
        Engine::start(EngineConfig {
            selection: BackendSelection::FakeScenario(Box::default()),
            timeouts: SessionTimeouts::default(),
            fake_clock: false,
        })
        .expect("engine starts"),
    )
}

fn private_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("senpi-serve-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::DirBuilder::new().mode(0o700).create(&dir).expect("private dir");
    dir
}

/// Sends `engine.hello`; `None` when the daemon closed without a byte.
async fn hello(socket: &std::path::Path) -> Option<String> {
    let mut stream = UnixStream::connect(socket).await.expect("connects");
    if stream.write_all(HELLO).await.is_err() {
        return None;
    }
    let mut first = [0_u8; 1];
    let read = tokio::time::timeout(GUARD, stream.read(&mut first))
        .await
        .expect("answer or close within the guard")
        .unwrap_or(0);
    if read == 0 {
        return None;
    }
    let mut rest = String::new();
    BufReader::new(stream).read_line(&mut rest).await.expect("reply line");
    Some(format!("{}{rest}", char::from(first[0])))
}

async fn refusal_then_service(name: &str, refuse: fn() -> std::io::Result<u32>) {
    // Given: a lookup that refuses the first client and admits the next.
    let dir = private_dir(name);
    let socket = dir.join("e.sock");
    let bound = bind(socket.to_str().expect("utf-8")).expect("binds");
    let lookups = Arc::new(AtomicUsize::new(0));
    let audits = Arc::new(AtomicUsize::new(0));
    let (seen, audited) = (Arc::clone(&lookups), Arc::clone(&audits));
    let engine = engine();
    let served = tokio::spawn({
        let engine = Arc::clone(&engine);
        async move {
            listen_checked(
                &engine,
                bound,
                Duration::from_millis(500),
                move |_| if seen.fetch_add(1, Ordering::SeqCst) == 0 { refuse() } else { Ok(euid()) },
                move |_| {
                    audited.fetch_add(1, Ordering::SeqCst);
                },
            )
            .await
        }
    });
    // When
    let refused = hello(&socket).await;
    let admitted = hello(&socket).await;
    // Then
    assert_eq!(refused, None, "the refused client got no byte");
    assert_eq!(audits.load(Ordering::SeqCst), 1, "one audit line for the refusal");
    let admitted = admitted.expect("a same-uid client is still served");
    assert!(admitted.contains("\"protocolVersion\""), "{admitted}");
    served.await.expect("listener task").expect("idle exit");
    engine.shutdown().await;
    assert!(!socket.exists(), "the socket is removed at idle exit");
    std::fs::remove_dir_all(&dir).expect("cleanup");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t25_6_a_peer_uid_mismatch_is_closed_before_any_byte_and_audited() {
    refusal_then_service("mismatch", || Ok(euid().wrapping_add(1))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t25_7_a_failed_peer_credential_lookup_is_a_mismatch() {
    refusal_then_service("lookup", || Err(std::io::Error::other("no credentials"))).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_kernel_lookup_reports_this_process_as_its_own_peer() {
    let (left, _right) = std::os::unix::net::UnixStream::pair().expect("socket pair");
    let uid = crate::peer::peer_euid(std::os::fd::AsRawFd::as_raw_fd(&left)).expect("credentials");
    assert_eq!(uid, euid());
}

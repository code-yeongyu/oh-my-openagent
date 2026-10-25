//! Real child death, libxpc EOF, production half-close, Session and ControlSlot.
mod child;
mod client;
mod handoff;
mod server;
mod wait;

use std::{os::unix::process::ExitStatusExt, sync::Arc, time::Duration};

#[test]
fn fixture() {
    let Ok(role) = std::env::var("O2_CRASH_ROLE") else {
        return;
    };
    let endpoint = handoff::receive();
    client::run(endpoint, role == "hold");
}

async fn event(events: &flume::Receiver<&'static str>) -> &'static str {
    let value = tokio::time::timeout(Duration::from_secs(10), events.recv_async())
        .await
        .expect("client crash did not release held input / close its session")
        .unwrap();
    println!("R3_NATIVE_EVENT {value}");
    value
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn r3_real_client_sigkill_releases_session_input_and_control() {
    tokio::task::LocalSet::new()
        .run_until(async {
            // given: only identity is injected, inside this crate's cfg(test). All
            // listener callbacks, approval gates, native EOF and stream reads are real.
            let (agent, endpoint) = crate::AgentTransport::anonymous_for_test(|_| {
                let role = crate::roles::Role::NativeController;
                crate::policy::evaluate(crate::policy::tests::eligible(role), role)
            });
            let endpoint = Arc::new(endpoint);
            let (events, received) = flume::bounded(16);
            let slot = senpi_desktop_session::ControlSlot::new();
            let mut jobs = tokio::task::JoinSet::new();
            jobs.spawn_local(async move {
                for _ in 0..2 {
                    server::serve(
                        agent.next().await.unwrap(),
                        Arc::clone(&slot),
                        events.clone(),
                    )
                    .await;
                    events.send("SESSION_CLOSED").unwrap();
                }
                events.send("DONE").unwrap();
            });
            let first = Arc::clone(&endpoint);
            let mut held = tokio::task::spawn_blocking(move || child::Child::spawn(&first, "hold"))
                .await
                .unwrap();
            assert_eq!(event(&received).await, "KEY_DOWN");
            // when: SIGKILL cannot run any client destructor or graceful disconnect.
            let killed = held.kill();
            assert_eq!(killed.signal(), Some(libc::SIGKILL));
            println!("R3_CLIENT_SIGKILL signal=9");
            // then: both effects must arrive before a new client tries the control slot.
            let (mut released, mut closed) = (false, false);
            while !released || !closed {
                match event(&received).await {
                    "KEY_UP" => released = true,
                    "SESSION_CLOSED" => closed = true,
                    other => panic!("unexpected native event {other}"),
                }
            }
            let second = Arc::clone(&endpoint);
            let mut fresh =
                tokio::task::spawn_blocking(move || child::Child::spawn(&second, "grant"))
                    .await
                    .unwrap();
            let status = tokio::task::spawn_blocking(move || fresh.wait())
                .await
                .unwrap();
            assert!(
                status.success(),
                "fresh controller could not acquire the released slot"
            );
            assert_eq!(event(&received).await, "SESSION_CLOSED");
            assert_eq!(event(&received).await, "DONE");
            jobs.join_next().await.unwrap().unwrap();
            println!("R3_CRASH_PASS released=true session_closed=true fresh_grant=true");
            println!("R3_CRASH_CLEANUP children=reaped jobs=none paths=none");
        })
        .await;
}

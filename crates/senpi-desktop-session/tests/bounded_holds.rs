//! Cancellation is driven through the real Pending/session thread boundary.

use std::sync::{mpsc, Arc};
use std::time::Duration;

use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{CaptureParams, HoldKeysParams, HoldMouseParams};
use senpi_desktop_core::types::DesktopSessionOptions;
use senpi_desktop_safety::{FakeClock, StopPathId, StopSource, Supervisor};
use senpi_desktop_session::{BackendFactory, ControlSlot, Op, Session, SessionSafety, SessionTimeouts};

const GUARD: Duration = Duration::from_secs(5);
type Built = Arc<Mutex<Option<RecordingSink>>>;

struct Factory {
    built: Built,
}

impl BackendFactory for Factory {
    fn create(&self, _: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let scenario = FakeScenario::from_json(include_str!(
            "../../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
        )).unwrap();
        let backend = FakeBackend::new(scenario);
        *self.built.lock() = Some(backend.sink());
        Ok(Box::new(backend))
    }
}

async fn open() -> (Session, RecordingSink, Arc<Supervisor>) {
    let built = Built::default();
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    let session = Session::start_supervised(
        Factory { built: Arc::clone(&built) },
        SessionTimeouts::default(),
        SessionSafety {
            supervisor: Arc::clone(&supervisor),
            audit: Box::new(|_| {}),
            control_slot: ControlSlot::new(),
        },
    ).unwrap();
    session.open(DesktopSessionOptions::default()).wait().await.unwrap();
    let sink = built.lock().clone().unwrap();
    (session, sink, supervisor)
}

fn held_key() -> Op {
    Op::HoldKeys(HoldKeysParams {
        target: "101".to_owned(),
        keys: vec!["shift".to_owned()],
        duration: 100.0,
        opts: None,
    })
}

fn await_press(events: &mpsc::Receiver<SinkOp>, mouse: bool) {
    loop {
        let event = events.recv_timeout(GUARD).expect("hold never pressed its input");
        if matches!(event, SinkOp::HeldButton { down: true, .. }) && mouse
            || matches!(event, SinkOp::HeldKey { down: true, .. }) && !mouse
        {
            return;
        }
    }
}

fn release_precedes_restore(sink: &RecordingSink, mouse: bool) {
    let ops = sink.ops();
    let release = ops.iter().position(|op| {
        if mouse {
            matches!(op, SinkOp::HeldButton { down: false, .. })
        } else {
            matches!(op, SinkOp::HeldKey { key: KeyName::Shift, down: false, .. })
        }
    }).expect("held input was not released");
    let restore = ops.iter().position(|op| matches!(op, SinkOp::RestoreKeyFocus(_)))
        .expect("background window hold did not restore key focus");
    assert!(release < restore, "input escaped into focus restoration");
}

#[tokio::test]
async fn close_interrupts_a_long_hold_and_observes_release() {
    // Given a 100-second hold that has delivered its press.
    let (session, sink, supervisor) = open().await;
    let events = sink.subscribe();
    let parked = supervisor.subscribe_hold_wait_for_test();
    let pending = session.submit(held_key());
    await_press(&events, false);
    parked.recv_timeout(GUARD).expect("hold did not park");
    // When close interrupts the hold before queueing teardown.
    tokio::time::timeout(senpi_desktop_session::CLOSE_TIMEOUT, session.close().wait())
        .await.unwrap().unwrap();
    // Then the backend recorded the release before close acknowledged.
    assert!(sink.ops().iter().any(|op| matches!(op,
        SinkOp::HeldKey { key: KeyName::Shift, down: false, .. }
    )));
    assert_eq!(pending.wait().await.unwrap_err().code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn cancellation_wakes_a_bounded_hold_without_polling() {
    // Given a registered recorder before a real session request.
    let (session, sink, supervisor) = open().await;
    let events = sink.subscribe();
    let parked = supervisor.subscribe_hold_wait_for_test();
    let pending = session.submit(held_key());
    await_press(&events, false);
    parked.recv_timeout(GUARD).expect("hold did not park");
    // When the actual Pending is abandoned, not just a probe set to true.
    drop(pending);
    // Then the next queued request runs only after release and restoration.
    tokio::time::timeout(GUARD, session.submit(Op::Displays).wait()).await.unwrap().unwrap();
    release_precedes_restore(&sink, false);
    session.close().wait().await.unwrap();
}

#[tokio::test]
async fn safety_stop_during_hold_wakes_releases_and_reports_suspended() {
    // Given a held key on the actual worker thread.
    let (session, sink, supervisor) = open().await;
    let events = sink.subscribe();
    let parked = supervisor.subscribe_hold_wait_for_test();
    let pending = session.submit(held_key());
    await_press(&events, false);
    parked.recv_timeout(GUARD).expect("hold did not park");
    // When the supervisor observes the user's stop.
    supervisor.trigger_stop(StopSource::Hotkey);
    // Then it interrupts the 100-second wait and releases before restore.
    let result = tokio::time::timeout(GUARD, pending.wait()).await.unwrap();
    assert_eq!(result.unwrap_err().code, ErrorCode::Suspended);
    release_precedes_restore(&sink, false);
    session.close().wait().await.unwrap();
}

#[tokio::test]
async fn bounded_button_hold_releases_on_cancellation() {
    // Given a full-frame pointer point and an observer registered before input.
    let (session, sink, supervisor) = open().await;
    session.submit(Op::Capture(CaptureParams { target: "101".to_owned(), caps: None, exclude_window_titles: None }))
        .wait().await.unwrap();
    let events = sink.subscribe();
    let parked = supervisor.subscribe_hold_wait_for_test();
    let pending = session.submit(Op::HoldMouse(HoldMouseParams {
        target: "101".to_owned(), x: 10.0, y: 10.0, duration: 100.0,
        button: None, keys: None, frame_id: None, opts: None,
    }));
    await_press(&events, true);
    parked.recv_timeout(GUARD).expect("hold did not park");
    // When the waiter disappears during the button hold.
    drop(pending);
    // Then the queue cannot advance while the button is still held.
    tokio::time::timeout(GUARD, session.submit(Op::Displays).wait()).await.unwrap().unwrap();
    release_precedes_restore(&sink, true);
    session.close().wait().await.unwrap();
}

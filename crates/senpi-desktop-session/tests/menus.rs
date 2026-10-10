//! Menu requests through the session: listing is a read, selection is one
//! gated, audited mutation against the scripted tree of the fake backend.

use std::path::Path;
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::MenuPathParams;
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::types::DesktopSessionOptions;
use senpi_desktop_safety::{FakeClock, StopPathId, StopSource, Supervisor};
use senpi_desktop_session::{BackendFactory, Op, Response, Session, SessionSafety, SessionTimeouts};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/menus.json"
);

fn scenario(overlay: &str) -> FakeScenario {
    let base = std::fs::read_to_string(Path::new(FIXTURE)).expect("fixture is readable");
    let mut json: serde_json::Value = serde_json::from_str(&base).expect("fixture is JSON");
    let overlay: serde_json::Value = serde_json::from_str(overlay).expect("overlay is JSON");
    for (key, value) in overlay.as_object().expect("overlay is an object") {
        json[key] = value.clone();
    }
    FakeScenario::from_json(&json.to_string()).expect("scenario parses")
}

/// Fake menu backends whose op logs stay observable after boxing.
struct MenusFactory {
    scenario: FakeScenario,
    sinks: Arc<Mutex<Vec<RecordingSink>>>,
}

impl BackendFactory for MenusFactory {
    fn create(&self, _options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        self.sinks.lock().push(backend.sink());
        Ok(Box::new(backend))
    }
}

/// A supervised session over the menus fixture, with the pieces a menu test
/// asserts against: the supervisor behind the gate, the backend's op log,
/// and every audit event the session emitted.
struct MenusSession {
    session: Session,
    supervisor: Arc<Supervisor>,
    sinks: Arc<Mutex<Vec<RecordingSink>>>,
    audits: Arc<Mutex<Vec<AuditEvent>>>,
}

fn start(overlay: &str) -> MenusSession {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    let factory = MenusFactory {
        scenario: scenario(overlay),
        sinks: Arc::default(),
    };
    let sinks = Arc::clone(&factory.sinks);
    let audits: Arc<Mutex<Vec<AuditEvent>>> = Arc::default();
    let sink = Arc::clone(&audits);
    let safety = SessionSafety {
        supervisor: Arc::clone(&supervisor),
        audit: Box::new(move |event| sink.lock().push(event.clone())),
    };
    let session = Session::start_supervised(factory, SessionTimeouts::default(), safety).expect("session starts");
    MenusSession {
        session,
        supervisor,
        sinks,
        audits,
    }
}

fn select(window: &str, path: &[&str]) -> Op {
    Op::MenusSelect(MenuPathParams {
        window_id: window.to_owned(),
        path: path.iter().map(|label| (*label).to_owned()).collect(),
    })
}

fn items(window: &str, path: &[&str]) -> Op {
    Op::MenuItems(MenuPathParams {
        window_id: window.to_owned(),
        path: path.iter().map(|label| (*label).to_owned()).collect(),
    })
}

fn code(result: CoreResult<Response>) -> Option<ErrorCode> {
    result.err().map(|error| error.code)
}

fn recorded(sinks: &Mutex<Vec<RecordingSink>>) -> Vec<SinkOp> {
    sinks.lock().last().expect("open built a backend").ops()
}

#[tokio::test]
async fn items_lists_children_without_a_mutation_transaction() {
    // Given
    let started = start("{}");
    let (session, sinks, audits) = (&started.session, &started.sinks, &started.audits);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    let root = session.submit(items("101", &[])).wait().await.expect("root items");
    let file = session
        .submit(items("101", &["File"]))
        .wait()
        .await
        .expect("File children");
    // Then: a read emits no audit event and records no side effect
    let Response::MenuItems(root) = root else {
        panic!("expected menu items, got {root:?}");
    };
    let Response::MenuItems(file) = file else {
        panic!("expected menu items, got {file:?}");
    };
    assert_eq!(
        root.iter().map(|item| item.title.as_str()).collect::<Vec<_>>(),
        ["File", "Edit", "View"]
    );
    assert_eq!(
        file.iter().map(|item| item.title.as_str()).collect::<Vec<_>>(),
        ["Save", "Export…"]
    );
    assert!(audits.lock().is_empty(), "{:?}", audits.lock());
    assert_eq!(recorded(sinks), [], "{:?}", recorded(sinks));
}

#[tokio::test]
async fn select_records_the_path_and_emits_exactly_one_audit_event() {
    // Given
    let started = start("{}");
    let (session, sinks, audits) = (&started.session, &started.sinks, &started.audits);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    let selected = session
        .submit(select("101", &["File", "Save"]))
        .wait()
        .await
        .expect("select succeeds");
    // Then
    assert_eq!(selected, Response::Unit);
    assert_eq!(
        recorded(sinks),
        [SinkOp::MenuSelect {
            window: "101".to_owned(),
            path: vec!["File".to_owned(), "Save".to_owned()],
        }]
    );
    let audits = audits.lock();
    assert_eq!(audits.len(), 1, "{audits:?}");
    let event = &audits[0];
    assert_eq!(event.action, Method::MenusSelect);
    assert_eq!(event.target, "101");
    assert_eq!(event.delivery, "background");
    assert_eq!(event.code, None, "{event:?}");
}

#[tokio::test]
async fn a_disabled_leaf_is_refused_and_dispatches_nothing() {
    // Given
    let started = start("{}");
    let (session, sinks, audits) = (&started.session, &started.sinks, &started.audits);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    let refused = session.submit(select("101", &["Edit", "Undo"])).wait().await;
    // Then: the failure is still audited, but nothing was dispatched
    assert_eq!(code(refused), Some(ErrorCode::AxFailed));
    assert_eq!(recorded(sinks), [], "{:?}", recorded(sinks));
    assert_eq!(audits.lock().len(), 1, "{:?}", audits.lock());
}

#[tokio::test]
async fn an_invalid_path_is_refused_before_the_backend() {
    // Given
    let started = start("{}");
    let (session, sinks) = (&started.session, &started.sinks);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When: an empty path names no command; a blank label is invalid
    let empty = session.submit(select("101", &[])).wait().await;
    let blank = session.submit(select("101", &["File", " "])).wait().await;
    // Then
    assert_eq!(code(empty), Some(ErrorCode::InvalidTarget));
    assert_eq!(code(blank), Some(ErrorCode::InvalidTarget));
    assert_eq!(recorded(sinks), [], "{:?}", recorded(sinks));
}

#[tokio::test]
async fn select_is_refused_while_suspended() {
    // Given
    let started = start("{}");
    let (session, supervisor, sinks) = (&started.session, &started.supervisor, &started.sinks);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When: the user's stop chord latches before the request
    supervisor.trigger_stop(StopSource::Hotkey);
    let refused = session.submit(select("101", &["File", "Save"])).wait().await;
    // Then: the gate applies and nothing was dispatched
    assert_eq!(code(refused), Some(ErrorCode::Suspended));
    assert_eq!(recorded(sinks), [], "{:?}", recorded(sinks));
}

#[tokio::test]
async fn a_backend_without_menus_reports_ax_unsupported() {
    // Given: the scenario carries no menu tree at all
    let started = start(r#"{"menus": {}}"#);
    let session = &started.session;
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When / Then
    let listed = session.submit(items("101", &[])).wait().await;
    assert_eq!(code(listed), Some(ErrorCode::AxUnsupported));
    let selected = session.submit(select("101", &["File", "Save"])).wait().await;
    assert_eq!(code(selected), Some(ErrorCode::AxUnsupported));
}

//! The guard over the fake backend: a deaf listener refuses before any OS call, and a window
//! owned by the self set is `SelfTarget` on every persona with the sink empty.

use std::cell::Cell;

use omo_computer_backend_fake::{FakeBackend, FakeMethod, FakeScenario, Persona, StopPathScript};
use omo_computer_core::backend::Backend;
use omo_computer_core::backend::WindowFilter;
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::params::Point;

use super::{Call, Guard, MonotonicClock, Observed, OwnProcess, ProcessSource};
use crate::gate::{Gate, VerbKind};
use crate::marker::MemoryMarker;
use crate::resolve::TargetRef;
use crate::self_set::{BrainLock, HostAdditions, ProcessInfo, ProcessSnapshot};
use crate::stop_path::{StopPolicy, Transport};
use crate::supervisor::{NoHolds, Supervisor};

const SCENARIO: &str = r#"{"windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

fn fake(script: StopPathScript, persona: Persona) -> FakeBackend {
    FakeBackend::new(FakeScenario::from_json(SCENARIO).expect("scenario"))
        .with_persona(persona)
        .with_stop_path(script)
}

fn guard(source: Box<dyn ProcessSource>) -> Guard {
    let supervisor = Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy::default_for(Transport::Local),
    );
    Guard::new(supervisor, source, Box::new(MonotonicClock::new()))
}

fn click() -> Call<'static> {
    Call {
        verb: VerbKind::Pointer,
        target: TargetRef::Window("101"),
        points: vec![Point { x: 5.0, y: 5.0 }],
        chord: None,
        force: true,
    }
}

fn admit(
    guard: &mut Guard,
    backend: &mut FakeBackend,
    reads: &Cell<u32>,
) -> Result<(), crate::gate::GateRefusal> {
    guard.observe(&mut || backend.stop_listener(), &mut NoHolds);
    let caps = backend.capabilities();
    let permission = backend.probe_permissions().input;
    let windows = || -> Option<Vec<WindowInfo>> {
        reads.set(reads.get() + 1);
        backend
            .windows(&WindowFilter::default())
            .ok()
            .map(|list| list.windows)
    };
    guard
        .admit(
            &click(),
            Observed {
                screen_locked: caps.session.screen_locked,
                permission,
                windows,
            },
        )
        .map(drop)
}

#[test]
fn deaf_listener_refuses_exec_before_any_os_call() {
    for allow in [false, true] {
        let mut backend = fake(StopPathScript::Deaf, Persona::host());
        let mut guard = guard(Box::new(OwnProcess::default()));
        guard
            .open(
                StopPolicy {
                    allow_host_relay_only: allow,
                },
                HostAdditions::default(),
            )
            .expect("open");
        let deaf_reason = backend.capabilities().stop_path.deaf_reason;
        guard.start(backend.stop_listener(), deaf_reason);
        guard.heartbeat();
        let reads = Cell::new(0);
        let refused = admit(&mut guard, &mut backend, &reads).expect_err("deaf");
        assert_eq!(
            (
                refused.gate,
                refused.refusal.code.wire(),
                refused.refusal.reason
            ),
            (Gate::StopPath, "StopPathUnavailable", Some("deaf"))
        );
        assert_eq!(reads.get(), 0, "nothing was read for the refused call");
        assert_eq!(backend.calls(FakeMethod::Windows), 0);
        assert!(backend.sink().is_empty(), "{:?}", backend.sink().lines());
        assert_eq!(guard.status().reason.as_deref(), Some("deaf"));
    }
}

/// A process table where pid 4242 is a sibling `omo-computer-*` helper.
struct WithHelper;

impl ProcessSource for WithHelper {
    fn snapshot(&self) -> ProcessSnapshot {
        let helper = ProcessInfo {
            pid: 4242,
            ppid: 1,
            start: 2,
            name: "omo-computer-helper".to_owned(),
            tty: None,
            host_pid: None,
            session_leader: false,
        };
        ProcessSnapshot {
            processes: vec![helper],
            tty_owners: Vec::new(),
        }
    }
    fn brain_locks(&self) -> Vec<BrainLock> {
        Vec::new()
    }
}

/// Where the self set gets the window's owner from.
type Owner = (Box<dyn Fn() -> Box<dyn ProcessSource>>, HostAdditions);

#[test]
fn a_self_set_window_is_refused_on_every_fake_persona() {
    let owners: [Owner; 3] = [
        (
            Box::new(|| Box::new(OwnProcess::default())),
            HostAdditions {
                pids: vec![4242],
                app_keys: Vec::new(),
            },
        ),
        (
            Box::new(|| Box::new(OwnProcess::default())),
            HostAdditions {
                pids: Vec::new(),
                app_keys: vec!["Notes".to_owned()],
            },
        ),
        (Box::new(|| Box::new(WithHelper)), HostAdditions::default()),
    ];
    for persona in Persona::ALL {
        for (source, additions) in &owners {
            let mut backend = fake(StopPathScript::Live, persona);
            let mut guard = guard(source());
            guard
                .open(StopPolicy::default_for(Transport::Local), additions.clone())
                .expect("open");
            guard.start(backend.stop_listener(), None);
            let refused = admit(&mut guard, &mut backend, &Cell::new(0)).expect_err("self target");
            assert_eq!(
                (refused.refusal.code.wire(), refused.refusal.reason),
                ("ProtectedProcess", Some("self_target")),
                "{persona:?}"
            );
            assert!(backend.sink().is_empty());
        }
        let mut backend = fake(StopPathScript::Live, persona);
        let mut other = guard(Box::new(OwnProcess::default()));
        other
            .open(
                StopPolicy::default_for(Transport::Local),
                HostAdditions::default(),
            )
            .expect("open");
        other.start(backend.stop_listener(), None);
        assert_eq!(
            admit(&mut other, &mut backend, &Cell::new(0)),
            Ok(()),
            "{persona:?}: another app is admitted"
        );
    }
}

#[test]
fn open_refuses_suspended_while_a_marker_is_present() {
    let supervisor = Supervisor::new(
        Box::new(MemoryMarker::present()),
        StopPolicy::default_for(Transport::Local),
    );
    let mut guard = Guard::new(
        supervisor,
        Box::new(OwnProcess::default()),
        Box::new(MonotonicClock::new()),
    );
    let refused = guard
        .open(
            StopPolicy::default_for(Transport::Local),
            HostAdditions::default(),
        )
        .expect_err("stopped");
    assert_eq!(
        (refused.code.wire(), refused.reason),
        ("Suspended", Some("stop_marker"))
    );
    assert!(
        guard.self_set().contains_pid(std::process::id()),
        "the self set is computed before any exec"
    );
}

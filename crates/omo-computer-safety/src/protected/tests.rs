//! The shipped tables, entry by entry on every OS: every protected entry refuses before send
//! with `force` included; the dangerous chords per OS need `force`, and `force` admits only them.

use omo_computer_core::backend::Refusal;

use super::{Chord, Os, ProtectedTable};
use crate::gate::{gate, GateFacts, Identity, PointTarget, Resolution, Tables, Tier, VerbKind};
use crate::self_set::{HostAdditions, ProcessSnapshot, SelfSet, SelfSetInputs};
use crate::stop_path::{GlobalListener, RelayBeat, StopPathView, StopPolicy};

fn identity(entry: &str) -> Identity {
    let (app, surface) = match entry.split_once(':') {
        Some((app, surface)) => (app, Some(surface.to_owned())),
        None => (entry, None),
    };
    Identity {
        pid: 4242,
        app_key: app.replace('*', "Service"),
        surface,
    }
}

pub(super) fn run(
    table: &'static ProtectedTable,
    set: &SelfSet,
    tier: Tier,
    verb: VerbKind,
    id: Identity,
) -> Option<Refusal> {
    let view = StopPathView {
        global: GlobalListener::Fresh,
        relay: RelayBeat::Absent,
        policy: StopPolicy {
            allow_host_relay_only: false,
        },
    };
    let mut facts = GateFacts::clear(tier, verb, view);
    facts.force = true;
    let tables = Tables {
        self_set: set,
        protected: table,
        allowed_apps: &[],
    };
    let targets = vec![PointTarget::new(None, Resolution::Window(id))];
    gate(&facts, &tables, || targets).err().map(|r| r.refusal)
}

pub(super) fn wire(refusal: Option<Refusal>) -> Option<(&'static str, Option<&'static str>)> {
    refusal.map(|r| (r.code.wire(), r.reason))
}

pub(super) fn self_set(pid: u32, app: &str) -> SelfSet {
    SelfSet::compute(&SelfSetInputs {
        own_pid: 1,
        snapshot: &ProcessSnapshot::default(),
        brain_locks: &[],
        brain_names: &[],
        additions: &HostAdditions {
            pids: vec![pid],
            app_keys: vec![app.to_owned()],
        },
    })
}

#[test]
fn every_shipped_table_parses_with_disjoint_surface_columns() {
    for os in Os::ALL {
        let table = ProtectedTable::of(os);
        assert_eq!(table.v, 4, "{os:?}");
        let columns = [
            &table.protected_surfaces,
            &table.read_only_surfaces,
            &table.system_surfaces,
        ];
        for (i, a) in columns.iter().enumerate() {
            for b in &columns[i + 1..] {
                assert!(
                    a.iter().all(|entry| !b.contains(entry)),
                    "{os:?}: {entry:?} in two columns",
                    entry = a
                );
            }
        }
        assert!(!table.dangerous_chords.is_empty() && !table.denied_apps.is_empty());
        assert!(table.secure_label_regex.contains("passw"));
    }
}

#[test]
fn protected_table_refuses_every_entry_force_included() {
    for os in Os::ALL {
        let table = ProtectedTable::of(os);
        let none = self_set(1, "none.self");
        for entry in &table.protected_surfaces {
            for tier in [Tier::Exec, Tier::Read] {
                let refused = run(table, &none, tier, VerbKind::Pointer, identity(entry));
                let expected =
                    (tier == Tier::Exec).then_some(("InvalidTarget", Some("protected_surface")));
                assert_eq!(wire(refused), expected, "{os:?} {entry} {tier:?}");
            }
        }
        for entry in &table.read_only_surfaces {
            let exec = run(table, &none, Tier::Exec, VerbKind::Pointer, identity(entry));
            assert_eq!(
                wire(exec),
                Some(("InvalidTarget", Some("protected_surface"))),
                "{os:?} {entry}"
            );
            assert_eq!(
                run(table, &none, Tier::Read, VerbKind::Pointer, identity(entry)),
                None,
                "reads admitted"
            );
        }
        for entry in &table.system_surfaces {
            assert_eq!(
                run(table, &none, Tier::Exec, VerbKind::Pointer, identity(entry)),
                None,
                "{os:?} {entry} is desktop-class"
            );
        }
        for entry in &table.processes {
            let quit = run(
                table,
                &none,
                Tier::Exec,
                VerbKind::AppsQuit,
                identity(entry),
            );
            assert_eq!(
                wire(quit),
                Some(("ProtectedProcess", None)),
                "{os:?} quit {entry}"
            );
        }
        for entry in &table.denied_apps {
            let refused = run(table, &none, Tier::Exec, VerbKind::Pointer, identity(entry));
            assert_eq!(
                wire(refused),
                Some(("ControlRequired", Some("denied_app"))),
                "{os:?} {entry}"
            );
        }
        let own = self_set(5151, "ai.example.omo-desktop");
        for id in [
            Identity {
                pid: 5151,
                app_key: "x".to_owned(),
                surface: None,
            },
            identity("ai.example.omo-desktop"),
        ] {
            let input = run(table, &own, Tier::Exec, VerbKind::Keyboard, id.clone());
            assert_eq!(
                wire(input),
                Some(("ProtectedProcess", Some("self_target"))),
                "{os:?} {id:?}"
            );
            let quit = run(table, &own, Tier::Exec, VerbKind::AppsQuit, id);
            assert_eq!(wire(quit), Some(("ProtectedProcess", None)));
        }
    }
}

#[test]
fn dangerous_chords_per_os_table() {
    for os in Os::ALL {
        let table = ProtectedTable::of(os);
        for entry in &table.dangerous_chords {
            assert!(Chord::parse(entry).is_some(), "{os:?} {entry} parses");
            assert!(table.is_dangerous_chord(entry), "{os:?} {entry}");
            assert!(
                table.is_dangerous_chord(&entry.to_uppercase()),
                "{os:?} {entry} in capitals"
            );
        }
        assert!(!table.is_dangerous_chord("ctrl+c"), "{os:?}");
        assert!(!table.is_dangerous_chord(""), "{os:?}");
    }
    let mac = ProtectedTable::of(Os::Macos);
    assert!(
        mac.is_dangerous_chord("command+option+escape"),
        "spellings fold"
    );
    assert!(
        !mac.is_dangerous_chord("cmd+shift+q"),
        "macOS lists exact chords"
    );
    let windows = ProtectedTable::of(Os::Windows);
    for superset in ["ctrl+alt+f4", "shift+win+l", "ctrl+alt+shift+esc"] {
        assert!(
            windows.is_dangerous_chord(superset),
            "Windows: {superset} is a modifier superset"
        );
    }
    assert!(!windows.is_dangerous_chord("alt+f5"));
    let linux = ProtectedTable::of(Os::Linux);
    assert!(
        linux.is_dangerous_chord("ctrl+alt+f12") && linux.is_dangerous_chord("control+alt+delete")
    );
}

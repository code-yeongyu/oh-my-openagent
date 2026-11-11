//! Freshness of the generated files and the method allowlist.

mod backend;
mod corpus;
mod hello;
mod listing;
mod read_sites;
mod readers;
mod requests;
mod seams;
mod settings;

use std::path::{Path, PathBuf};

use crate::doc::{protocol_doc, DOC_PATH};
use crate::methods::{Effect, Exposure, Method, PeerKind, METHODS};
use crate::schema::{engine_schema_text, SCHEMA_PATH};

pub(super) fn crate_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// Compares a generated file with its committed copy; `OMO_COMPUTER_UPDATE_SCHEMA=1` rewrites it.
fn assert_fresh(relative: &str, generated: &str) {
    let path = crate_path(relative);
    if std::env::var("OMO_COMPUTER_UPDATE_SCHEMA").as_deref() == Ok("1") {
        std::fs::write(&path, generated).expect("write the generated file");
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    if committed == generated {
        return;
    }
    let line = committed
        .lines()
        .zip(generated.lines())
        .position(|(old, new)| old != new);
    let (number, old, new) = line.map_or_else(
        || {
            (
                committed.lines().count().min(generated.lines().count()) + 1,
                "<end>",
                "<end>",
            )
        },
        |index| {
            (
                index + 1,
                committed.lines().nth(index).unwrap_or(""),
                generated.lines().nth(index).unwrap_or(""),
            )
        },
    );
    panic!(
        "{relative} is stale (committed {} bytes, generated {} bytes); first difference at line {number}:\n- {old:?}\n+ {new:?}\nregenerate with OMO_COMPUTER_UPDATE_SCHEMA=1 cargo test -p omo-computer-core",
        committed.len(),
        generated.len()
    );
}

#[test]
fn schema_is_fresh() {
    assert_fresh(SCHEMA_PATH, &engine_schema_text());
}

#[test]
fn protocol_doc_is_fresh() {
    assert_fresh(DOC_PATH, &protocol_doc());
}

use Effect::{Exec as X, Read as R};
const P: Exposure = Exposure::Public;
const S: Exposure = Exposure::HostOnly(PeerKind::Session);
const A: Exposure = Exposure::HostOnly(PeerKind::Authority);
const T: Exposure = Exposure::TestOnly;

/// The reviewed allowlist: a row added to the table without being added here fails.
const ALLOWLIST: &[(&str, Effect, Exposure)] = &[
    ("engine.hello", R, P),
    ("session.open", R, S),
    ("session.close", R, S),
    ("capabilities", R, P),
    ("displays", R, P),
    ("windows", R, P),
    ("apps.list", R, P),
    ("pointer", R, P),
    ("diagnose", R, P),
    ("capture", R, P),
    ("zoom", R, P),
    ("observe", R, P),
    ("ax.snapshot", R, P),
    ("ax.drill", R, P),
    ("ax.node", R, P),
    ("ax.children", R, P),
    ("ax.focused", R, P),
    ("elementAt", R, P),
    ("waitFor", R, P),
    ("clipboard.read", R, P),
    ("menu.items", R, P),
    ("surface", R, P),
    ("click", X, P),
    ("move", X, P),
    ("mouse.down", X, P),
    ("mouse.up", X, P),
    ("key.down", X, P),
    ("key.up", X, P),
    ("drag", X, P),
    ("type", X, P),
    ("press", X, P),
    ("paste", X, P),
    ("scroll", X, P),
    ("typeText", X, P),
    ("keyChord", X, P),
    ("holdKeys", X, P),
    ("holdMouse", X, P),
    ("raiseWindow", X, P),
    ("ax.setValue", X, P),
    ("ax.perform", X, P),
    ("ax.focus", X, P),
    ("ax.typeText", X, P),
    ("ax.selectText", X, P),
    ("menu.select", X, P),
    ("apps.open", X, P),
    ("apps.quit", X, P),
    ("window.raise", X, P),
    ("window.activate", X, P),
    ("window.setFrame", X, P),
    ("window.minimize", X, P),
    ("window.restore", X, P),
    ("clipboard.write", X, P),
    ("openSystemSurface", X, P),
    ("control.grant", X, A),
    ("control.revoke", X, A),
    ("control.acquire", X, A),
    ("control.release", R, S),
    ("display.release", X, S),
    ("display.resume", X, S),
    ("preview.subscribe", R, S),
    ("stopPath.start", X, A),
    ("stopPath.status", R, P),
    ("stopPath.heartbeat", R, S),
    ("stopPath.stop", R, P),
    ("stopPath.resume", X, A),
    ("desktop.shutdown", X, A),
    ("$/cancel", R, P),
    ("$/test.advanceClock", X, T),
];

#[test]
fn method_allowlist() {
    let table: Vec<(&str, Effect, Exposure)> = METHODS
        .iter()
        .map(|spec| (spec.name, spec.effect, spec.exposure))
        .collect();
    assert_eq!(
        table, ALLOWLIST,
        "the method table differs from the reviewed allowlist"
    );
    for (index, spec) in METHODS.iter().enumerate() {
        assert_eq!(
            spec.method as usize, index,
            "{} is out of variant order",
            spec.name
        );
        assert_eq!(
            Method::from_name(spec.name),
            Some(spec.method),
            "{} does not resolve",
            spec.name
        );
    }
}

#[test]
fn host_only_methods_are_split_by_peer_kind() {
    let named = |exposure: Exposure| -> Vec<&str> {
        let mut names: Vec<&str> = METHODS
            .iter()
            .filter(|spec| spec.exposure == exposure)
            .map(|spec| spec.name)
            .collect();
        names.sort_unstable();
        names
    };
    let mut session = vec![
        "session.open",
        "session.close",
        "stopPath.heartbeat",
        "display.release",
        "display.resume",
    ];
    session.extend(["control.release", "preview.subscribe"]);
    session.sort_unstable();
    let mut authority = vec![
        "control.grant",
        "control.revoke",
        "control.acquire",
        "stopPath.start",
        "stopPath.resume",
        "desktop.shutdown",
    ];
    authority.sort_unstable();
    assert_eq!(named(S), session);
    assert_eq!(named(A), authority);
}

#[test]
fn oneshot_names_resolve_through_the_prefix_and_the_alias() {
    assert_eq!(Method::from_oneshot("desktop.click"), Some(Method::Click));
    assert_eq!(
        Method::from_oneshot("desktop.ax.node"),
        Some(Method::AxNode)
    );
    assert_eq!(
        Method::from_oneshot("desktop.stop"),
        Some(Method::StopPathStop)
    );
    assert_eq!(
        Method::from_oneshot("desktop.shutdown"),
        Some(Method::DesktopShutdown)
    );
    assert_eq!(Method::from_oneshot("desktop.nope"), None);
    assert_eq!(Method::from_name("desktop.click"), None);
}

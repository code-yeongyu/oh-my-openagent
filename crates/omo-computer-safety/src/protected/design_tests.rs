//! The shipped tables against the design's own list (`design.tsv`: one cited row per entry,
//! taken from d-safety.md '### The shipped table'), in both directions: every design entry is in
//! the JSON, and every JSON entry is cited. The expected side never reads the JSON it checks.

use std::collections::BTreeSet;

use super::tests::{run, self_set, wire};
use super::{Os, ProtectedTable};
use crate::gate::{Identity, Tier, VerbKind};

const DESIGN: &str = include_str!("design.tsv");

/// `(os, column, entry)`.
type Entry = (String, String, String);

const fn os_name(os: Os) -> &'static str {
    match os {
        Os::Macos => "macos",
        Os::Linux => "linux",
        Os::Windows => "windows",
    }
}

fn design() -> BTreeSet<Entry> {
    let mut rows = BTreeSet::new();
    for line in DESIGN
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), 4, "os, column, entry, citation: {line:?}");
        assert!(
            fields[3].starts_with("d-safety.md:"),
            "uncited row: {line:?}"
        );
        let entry = (
            fields[0].to_owned(),
            fields[1].to_owned(),
            fields[2].to_owned(),
        );
        assert!(rows.insert(entry), "duplicate row: {line:?}");
    }
    rows
}

fn shipped(os: Os) -> BTreeSet<Entry> {
    let table = ProtectedTable::of(os);
    let name = os_name(os);
    assert_eq!(table.os, name);
    let lists = [
        ("protectedSurfaces", &table.protected_surfaces),
        ("readOnlySurfaces", &table.read_only_surfaces),
        ("systemSurfaces", &table.system_surfaces),
        ("processes", &table.processes),
        ("deniedApps", &table.denied_apps),
        ("dangerousChords", &table.dangerous_chords),
        ("secureInputSources", &table.secure_input_sources),
    ];
    let row = |column: &str, entry: &str| (name.to_owned(), column.to_owned(), entry.to_owned());
    let mut rows = BTreeSet::new();
    for (column, entries) in lists {
        for entry in entries {
            assert!(
                rows.insert(row(column, entry)),
                "{name} {column}: {entry} twice"
            );
        }
    }
    rows.insert(row(
        "chordsMatchSupersets",
        &table.chords_match_supersets.to_string(),
    ));
    rows.insert(row("secureLabelRegex", &table.secure_label_regex));
    rows
}

#[test]
fn protected_table_matches_the_design_entry_by_entry() {
    let design = design();
    let shipped: BTreeSet<Entry> = Os::ALL.into_iter().flat_map(shipped).collect();
    let missing: Vec<&Entry> = design.difference(&shipped).collect();
    let uncited: Vec<&Entry> = shipped.difference(&design).collect();
    assert!(
        missing.is_empty(),
        "design entries missing from the shipped JSON: {missing:?}"
    );
    assert!(
        uncited.is_empty(),
        "shipped JSON entries the design does not cite: {uncited:?}"
    );
}

/// The keys the real windows carry, matched by the table's prefix and exact entries.
#[test]
fn portal_keyring_and_store_package_keys_refuse() {
    let none = self_set(1, "none.self");
    let refused = |os: Os, key: &str| {
        let id = Identity {
            pid: 4242,
            app_key: key.to_owned(),
            surface: None,
        };
        wire(run(
            ProtectedTable::of(os),
            &none,
            Tier::Exec,
            VerbKind::Pointer,
            id,
        ))
    };
    let protected = Some(("InvalidTarget", Some("protected_surface")));
    let denied = Some(("ControlRequired", Some("denied_app")));
    for key in [
        "xdg-desktop-portal-gnome",
        "xdg-desktop-portal-kde",
        "xdg-desktop-portal-gtk",
        "org.freedesktop.impl.portal.desktop.kde",
        "gcr-prompter",
        "Gcr-prompter",
    ] {
        assert_eq!(refused(Os::Linux, key), protected, "{key}");
    }
    for key in ["kwalletd6", "org.kde.kwalletd6", "gnome-keyring-daemon"] {
        assert_eq!(refused(Os::Linux, key), denied, "{key}");
    }
    for key in [
        "8bitSolutionsLLC.bitwardendesktop_h4e712dmw3xyy!bitwardendesktop",
        "Agilebits.1Password_amwd9z03whsfe!1Password",
        "Agilebits.1Password_gh85et3mt782r!1Password",
    ] {
        assert_eq!(refused(Os::Windows, key), denied, "{key}");
    }
    assert_eq!(refused(Os::Windows, "secure-desktop"), protected);
    assert_eq!(
        refused(Os::Linux, "xdg-desktop"),
        None,
        "a prefix entry needs its prefix"
    );
}

use std::collections::BTreeMap;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, NextCall, Reason};
use omo_computer_core::routes::{RouteOs, RouteTable};
use omo_computer_core::settings::ToolkitClass;
use serde_json::json;

use super::{background_route, classify, read_evidence, route_class, Evidence, Toolkit, QT_SHIM};

fn evidence(wm_class: &str, maps: &[&str], children: &[&[&str]]) -> Evidence {
    Evidence {
        wm_class: wm_class.to_owned(),
        maps: maps.iter().map(|name| (*name).to_owned()).collect(),
        children: children
            .iter()
            .map(|argv| argv.iter().map(|arg| (*arg).to_owned()).collect())
            .collect(),
        exe: None,
        asar_beside_exe: false,
    }
}

fn refused(reason: Reason, toolkit: &str) -> Result<(), Refusal> {
    Err(Refusal::new(EngineCode::BackgroundUnavailable, reason)
        .with_data(json!({ "toolkit": toolkit })))
}

#[test]
fn toolkit_classified_by_evidence_not_substring() {
    let gtk = evidence("QtLookingBrowser", &["libgtk-3.so.0"], &[]);
    assert_eq!(
        classify(&gtk),
        Toolkit::Gtk3,
        "the mapped library wins over the class"
    );
    let qt = evidence("gtk-editor", &["libQt6Gui.so.6", "libqxcb.so"], &[]);
    assert_eq!(classify(&qt), Toolkit::QtXcb { shim: false });
    let chromium = evidence(
        "Chromium",
        &["libgtk-3.so.0"],
        &[&["/usr/lib/chromium/chromium", "--type=zygote"]],
    );
    assert_eq!(
        classify(&chromium),
        Toolkit::Chromium,
        "a --type= helper child wins over the GTK it maps"
    );
    let bare = evidence("chromium-gtk-qt", &[], &[]);
    assert_eq!(
        classify(&bare),
        Toolkit::Unknown,
        "a class alone is no evidence"
    );
    let xterm = Evidence {
        exe: Some("/usr/bin/xterm".into()),
        ..evidence("XTerm", &["libXt.so.6"], &[])
    };
    assert_eq!(
        classify(&xterm),
        Toolkit::Xterm,
        "xterm maps libXt, its exe names it"
    );
}

#[test]
fn qt_xcb_without_shim_is_background_unavailable() {
    let qt = classify(&evidence("app", &["libQt5Gui.so.5", "libqxcb.so"], &[]));
    let refusal =
        background_route(qt, route_class(qt, "app", &RouteTable::default())).expect_err("refused");
    assert_eq!(
        (refusal.code, refusal.reason),
        (EngineCode::BackgroundUnavailable, Some(Reason::Toolkit))
    );
    assert_eq!(refusal.wire_data()["toolkit"], "qt_xcb");
    assert_eq!(
        refusal.row().map(|row| row.next_call),
        Ok(NextCall::Call("el.setValue()")),
        "the table owns the next call"
    );
    let shimmed = classify(&evidence(
        "app",
        &["libQt5Gui.so.5", "libqxcb.so", &format!("{QT_SHIM}.so")],
        &[],
    ));
    assert_eq!(
        background_route(shimmed, Some(ToolkitClass::QtXcb)),
        Ok(()),
        "the shim accepts synthetic events"
    );
}

#[test]
fn electron_fixture_refused_naming_toolkit() {
    let electron = Evidence {
        exe: Some("/usr/share/code/code".into()),
        asar_beside_exe: true,
        ..evidence(
            "Code",
            &["libffmpeg.so"],
            &[&["/usr/share/code/code", "--type=renderer"]],
        )
    };
    let toolkit = classify(&electron);
    assert_eq!(toolkit, Toolkit::Electron);
    assert_eq!(
        background_route(
            toolkit,
            route_class(toolkit, "Code", &RouteTable::default())
        ),
        refused(Reason::ChromiumElectron, "electron")
    );
}

#[test]
fn every_dropping_or_unknown_client_is_refused_with_its_toolkit() {
    let table = RouteTable::default();
    for (toolkit, reason) in [
        (Toolkit::Chromium, Reason::ChromiumElectron),
        (Toolkit::Gtk3, Reason::Toolkit),
        (Toolkit::Gtk4, Reason::Toolkit),
        (Toolkit::Xterm, Reason::Toolkit),
        (Toolkit::Unknown, Reason::Toolkit),
    ] {
        assert_eq!(
            background_route(toolkit, route_class(toolkit, "k", &table)),
            refused(reason, toolkit.wire())
        );
    }
    assert_eq!(background_route(Toolkit::Xt, None), Ok(()));
    assert_eq!(background_route(Toolkit::Tk, None), Ok(()));
}

#[test]
fn an_exact_wm_class_key_classes_only_a_client_the_evidence_leaves_unknown() {
    let mut table = RouteTable::default();
    table
        .extend(
            RouteOs::X11,
            &BTreeMap::from([("Blender".to_owned(), ToolkitClass::CanvasGl)]),
        )
        .expect("exact key");
    assert_eq!(
        route_class(Toolkit::Unknown, "Blender", &table),
        Some(ToolkitClass::CanvasGl)
    );
    assert_eq!(
        background_route(Toolkit::Unknown, Some(ToolkitClass::CanvasGl)),
        refused(Reason::CanvasGl, "unknown")
    );
    assert_eq!(
        route_class(Toolkit::Unknown, "blender", &table),
        None,
        "never a case fold"
    );
    assert_eq!(
        route_class(Toolkit::Gtk3, "Blender", &table),
        None,
        "evidence wins over the class"
    );
}

#[test]
fn proc_evidence_reads_maps_child_command_lines_and_the_asar_beside_exe() {
    let root = tempfile::tempdir().expect("tempdir");
    let (proc, app) = (root.path().join("proc"), root.path().join("app"));
    std::fs::create_dir_all(proc.join("40/task/40")).expect("task");
    std::fs::create_dir_all(proc.join("41")).expect("child");
    std::fs::create_dir_all(app.join("resources")).expect("resources");
    std::fs::write(app.join("resources/app.asar"), b"").expect("asar");
    std::fs::write(app.join("code"), b"").expect("exe");
    std::os::unix::fs::symlink(app.join("code"), proc.join("40/exe")).expect("exe link");
    std::fs::write(
        proc.join("40/maps"),
        "7f00-7f01 r-xp 0 08:01 9 /usr/lib/libgtk-3.so.0\n",
    )
    .expect("maps");
    std::fs::write(proc.join("40/task/40/children"), "41 ").expect("children");
    std::fs::write(proc.join("41/cmdline"), b"code\0--type=renderer\0").expect("cmdline");
    let read = read_evidence(&proc, 40, "Code".into()).expect("readable");
    assert_eq!(read.maps, ["libgtk-3.so.0"]);
    assert_eq!(read.children, [["code", "--type=renderer"]]);
    assert!(read.asar_beside_exe);
    assert_eq!(classify(&read), Toolkit::Electron);
    assert_eq!(
        read_evidence(&proc, 99, String::new()),
        None,
        "an unreadable process is no evidence"
    );
}

//! The design points the RED list does not name: secure focus, re-identification, the web
//! document `URI`, the deadline-sliced walk, and the `Exec` quoting rules (menus: `menus.rs`).

use omo_computer_core::backend::Semantic;
use omo_computer_core::error::{EngineCode, Reason};

use super::{gedit, observe, ref_of, GEDIT_XID};
use crate::apps::exec::{argv, ExecRefusal};
use crate::bus::States;
use crate::types::Detail;

#[test]
fn a_focused_password_field_withholds_the_tree() {
    let mut fx = gedit();
    let field = fx.bus.node(&fx.frame, "password text", "");
    fx.bus.set_text(&field, "hunter2");
    fx.bus.set_states(
        &field,
        States {
            focused: true,
            enabled: true,
            ..States::default()
        },
    );
    fx.bus.push_event(0, "object:state-changed:focused", &field);
    let (mut backend, _) = fx.backend();

    let observed = observe(&mut backend, GEDIT_XID).expect("observe");

    assert!(observed.secure);
    assert!(
        observed.snapshot.tree.is_empty(),
        "no tree leaves the backend"
    );
}

#[test]
fn a_secure_label_hides_the_value_in_the_outline() {
    let mut fx = gedit();
    let pin = fx.bus.node(&fx.frame, "text", "PIN");
    fx.bus.set_text(&pin, "4321");
    let note = fx.bus.node(&fx.frame, "text", "Note");
    fx.bus.set_text(&note, "hello");
    let (mut backend, _) = fx.backend();

    let tree = observe(&mut backend, GEDIT_XID)
        .expect("observe")
        .snapshot
        .tree;

    assert!(!tree.contains("4321"), "{tree}");
    assert!(
        tree.contains("(secure)") && tree.contains("\"hello\""),
        "{tree}"
    );
}

#[test]
fn a_ref_whose_object_left_the_bus_is_stale() {
    let mut fx = gedit();
    let ok = fx.bus.node(&fx.frame, "push button", "OK");
    fx.bus.set_actions(&ok, &["click"]);
    let (mut backend, handle) = fx.backend();
    let tree = observe(&mut backend, GEDIT_XID)
        .expect("observe")
        .snapshot
        .tree;
    let reference = ref_of(&tree, "OK");
    handle.kill(&ok);

    let stale = backend
        .perform_detailed(&reference, &Semantic("press".to_owned()))
        .expect_err("gone");
    let unresolved = backend.resolve_detailed(&reference).expect_err("gone");

    assert_eq!(stale.code(), EngineCode::StaleRef);
    assert_eq!(unresolved.code(), EngineCode::StaleRef);
    assert!(
        handle.performed().is_empty(),
        "nothing was sent to a gone object"
    );
}

#[test]
fn twin_elements_with_one_evidence_tuple_are_ambiguous_and_gone_ones_stale() {
    let mut fx = gedit();
    for _ in 0..2 {
        let twin = fx.bus.node(&fx.frame, "push button", "Delete");
        fx.bus.set_actions(&twin, &["click"]);
    }
    let save = fx.bus.node(&fx.frame, "push button", "Save");
    fx.bus.set_actions(&save, &["click"]);
    let mut bus = fx.bus;
    bus.remove(&save);
    let mut backend = crate::AtspiBackend::new(Some(bus), Box::new(fx.windows));
    let press = Semantic("press".to_owned());
    let tree = observe(&mut backend, GEDIT_XID)
        .expect("observe")
        .snapshot
        .tree;

    let twin = backend
        .perform_detailed(&ref_of(&tree, "Delete"), &press)
        .expect_err("two Delete buttons");

    assert_eq!(twin.code(), EngineCode::AmbiguousTarget);
    assert_eq!(twin.detail, Some(Detail::Matches { count: 2 }));
    assert!(!tree.contains("\"Save\""), "a removed node is not walked");
    let stale = backend
        .perform_detailed(
            &omo_computer_core::backend::Ref("s1:e99".to_owned()),
            &press,
        )
        .expect_err("never minted");
    assert_eq!(stale.code(), EngineCode::StaleRef);
}

#[test]
fn the_focused_web_document_uri_is_read_for_the_url_policy() {
    let mut fx = gedit();
    let document = fx.bus.node(&fx.frame, "document web", "Example");
    fx.bus
        .set_attribute(&document, "URI", "https://example.com/a");
    let link = fx.bus.node(&document, "link", "More");
    fx.bus.set_states(
        &link,
        States {
            focused: true,
            enabled: true,
            ..States::default()
        },
    );
    fx.bus.push_event(0, "object:state-changed:focused", &link);
    let (mut backend, _) = fx.backend();

    assert_eq!(
        backend.document_url(GEDIT_XID).expect("read"),
        Some("https://example.com/a".to_owned())
    );
}

#[test]
fn a_hung_subtree_costs_one_unknown_node_not_the_observe() {
    let mut fx = gedit();
    let pane = fx.bus.node(&fx.frame, "panel", "Sidebar");
    fx.bus.node(&pane, "label", "inside");
    fx.bus.set_hung(&pane);
    fx.bus.node(&fx.frame, "push button", "OK");
    fx.bus.set_latency(1);
    let (mut backend, _) = fx.backend();

    let observed = observe(&mut backend, GEDIT_XID).expect("observe");

    assert!(
        observed.snapshot.tree.contains("\"OK\""),
        "{}",
        observed.snapshot.tree
    );
    assert!(
        observed.snapshot.tree.contains("(?)"),
        "{}",
        observed.snapshot.tree
    );
}

#[test]
fn exec_quoting_and_field_codes_follow_the_desktop_entry_spec() {
    assert_eq!(argv("gimp-2.10 %U").expect("plain"), ["gimp-2.10"]);
    assert_eq!(
        argv("\"/opt/My App/run\" \"--flag=x\" %%").expect("quoted"),
        ["/opt/My App/run", "--flag=x", "%"].map(|s| s.to_owned())
    );
    assert_eq!(
        argv("env \"A=\\$HOME\"").expect("escaped dollar"),
        ["env", "A=$HOME"]
    );
    assert_eq!(argv("prog \"$(id)\""), Err(ExecRefusal::ShellOperator('$')));
    assert_eq!(argv("bash -lc 'x'"), Err(ExecRefusal::ShellOperator('\'')));
    assert_eq!(
        argv("/bin/bash -c \"gedit\""),
        Err(ExecRefusal::ShellCommand("bash".to_owned()))
    );
    assert_eq!(argv("  "), Err(ExecRefusal::Empty));
}

#[test]
fn a_shell_behind_a_wrapper_is_refused() {
    let shell = |name: &str| Err(ExecRefusal::ShellCommand(name.to_owned()));

    assert_eq!(argv("env sh -c \"a; b\""), shell("sh"));
    assert_eq!(argv("env -i /bin/bash -c gedit"), shell("bash"));
    assert_eq!(argv("env -S \"sh -c gedit\""), shell("env"));
    assert_eq!(argv("env --split-string=gedit"), shell("env"));
    assert_eq!(
        argv("env FOO=1 gedit --new-window").expect("a wrapper without a shell"),
        ["env", "FOO=1", "gedit", "--new-window"]
    );
    let _ = Reason::LaunchNeedsUser;
}

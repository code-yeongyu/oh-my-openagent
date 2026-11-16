//! The accessibility half: snapshots under the deadline, refs, actions and unanswered writes.

use omo_computer_core::backend::{AxBackend, Ref, Semantic, SnapshotRequest, Target};
use omo_computer_core::params::ObserveOptions;

use omo_computer_core::error::{ComputerCode, DispositionRule, EngineCode, NothingSent};
use omo_computer_core::report::Disposition;

use crate::{fixtures_dir, FakeBackend, FakeScenario};

fn fixture(name: &str) -> FakeBackend {
    FakeBackend::new(
        FakeScenario::load(&fixtures_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}")),
    )
}

fn request(window: &str) -> SnapshotRequest {
    SnapshotRequest {
        target: Target::Window(window.to_owned()),
        options: ObserveOptions::default(),
    }
}

#[test]
fn snapshot_refs_and_actions() {
    let mut fake = fixture("user-intervened.json");
    let snapshot = fake.snapshot(&request("101")).expect("a tree");
    assert_eq!(
        (
            snapshot.nodes_observed,
            snapshot.complete,
            snapshot.generation
        ),
        (3, true, 1)
    );
    assert!(
        snapshot.tree.contains("e3 button \"Save\""),
        "{}",
        snapshot.tree
    );
    let save = Ref("s1:e3".to_owned());
    assert_eq!(
        fake.resolve(&save).map(|r| r.element.title),
        Ok(Some("Save".to_owned()))
    );
    assert!(
        fake.perform(&save, &Semantic("focus".to_owned())).is_err(),
        "the button lists press only"
    );
    assert!(fake.sink().is_empty());
    assert_eq!(
        fake.perform(&save, &Semantic("press".to_owned()))
            .map(|d| d.count),
        Ok(1)
    );
    assert_eq!(fake.sink().lines(), ["ax_perform ref=s1:e3 action=press"]);
    assert!(fake.snapshot(&request("999")).is_err());
    assert!(fake.resolve(&Ref("garbage".to_owned())).is_err());
}

#[test]
fn deadline_cuts_a_dense_tree_and_unanswered_writes_are_ax_unconfirmed() {
    let mut dense = fixture("v2-scripting.json");
    let snapshot = dense.snapshot(&request("101")).expect("a partial tree");
    assert_eq!((snapshot.nodes_observed, snapshot.complete), (5000, false));
    assert_eq!(
        dense.clock().now_ms(),
        50,
        "the walk spends its deadline on the fake clock"
    );

    let mut unanswered = fixture("ax-unconfirmed.json");
    unanswered.snapshot(&request("101")).expect("a tree");
    let field = Ref("s1:e2".to_owned());
    let unconfirmed = unanswered
        .perform(&field, &Semantic("focus".to_owned()))
        .expect_err("an unanswered write is AxUnconfirmed");
    assert_eq!(unconfirmed.code, EngineCode::AxUnconfirmed);
    let row = unconfirmed.row().expect("AxUnconfirmed has a row");
    assert_eq!(
        (row.computer, row.nothing_sent),
        (ComputerCode::AxUnconfirmed, NothingSent::No)
    );
    assert_eq!(
        row.disposition,
        DispositionRule::Fixed(Disposition::UNCERTAIN_UNSAFE)
    );
    assert_eq!(unanswered.sink().len(), 1, "the write went out");
    assert!(unanswered.sink().lines()[0].ends_with("outcome=cannot_complete"));
}

#[test]
fn every_refusal_the_fake_emits_has_a_table_row() {
    let mut fake = fixture("user-intervened.json");
    let gone = Ref("s9:e1".to_owned());
    let refusals = [
        fake.snapshot(&request("999")).err(),
        fake.snapshot(&SnapshotRequest {
            target: Target::Desktop,
            options: ObserveOptions::default(),
        })
        .err(),
        fake.resolve(&Ref("garbage".to_owned())).err(),
        fake.resolve(&gone).err(),
        fake.menu_select("101", &["Nope"]).err(),
        fake.set_frame(
            "999",
            omo_computer_core::listing::Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        )
        .err(),
    ];
    fake.snapshot(&request("101")).expect("a tree");
    let unsupported = fake
        .perform(&Ref("s1:e3".to_owned()), &Semantic("focus".to_owned()))
        .err();
    for refusal in refusals.into_iter().chain([unsupported]) {
        let refusal = refusal.expect("each probe refuses");
        let row = refusal.row().unwrap_or_else(|e| panic!("{refusal:?}: {e}"));
        assert_eq!(row.nothing_sent, NothingSent::Yes, "{refusal:?}");
    }
    assert!(fake.sink().is_empty());
}

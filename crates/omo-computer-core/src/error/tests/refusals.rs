//! Row 12's backend default refusals through the table: each is a closed engine code with a
//! reason that has a row, maps to the COMPUTER_* member the design names for it, and sent nothing.

use super::super::NothingSent;
use crate::backend::{
    AxBackend, Backend, CaptureOptions, InputEvent, Ref, Refusal, Route, Semantic, SnapshotRequest,
    TaggedInput, Target, WindowFilter, PRESENCE_UNAVAILABLE,
};
use crate::params::{ObserveOptions, Point};

struct Bare;
impl Backend for Bare {}
impl AxBackend for Bare {}

#[test]
fn backend_refusals_map_through_the_table() {
    let mut bare = Bare;
    let input = TaggedInput {
        event: InputEvent::PointerMove(Point { x: 1.0, y: 2.0 }),
        tag: 7,
    };
    let capture = CaptureOptions {
        cursor: true,
        crosshair: None,
        region: None,
    };
    let reference = Ref("s1:e2".to_owned());
    let request = SnapshotRequest {
        target: Target::Desktop,
        options: ObserveOptions::default(),
    };
    let refusals: Vec<Refusal> = [
        bare.windows(&WindowFilter::default()).err(),
        bare.displays().err(),
        bare.capture(&Target::Window("101".to_owned()), &capture)
            .err(),
        bare.post_input(&input, Route::BackgroundPid).err(),
        bare.stop_listener().err(),
        bare.epoch_source().next_change().err(),
        bare.snapshot(&request).err(),
        bare.resolve(&reference).err(),
        bare.perform(&reference, &Semantic("press".to_owned()))
            .err(),
        bare.events().next_event().err(),
        Some(PRESENCE_UNAVAILABLE),
    ]
    .into_iter()
    .flatten()
    .collect();
    assert_eq!(refusals.len(), 11, "every default refuses");
    let expected = [
        "COMPUTER_UNAVAILABLE",
        "COMPUTER_UNAVAILABLE",
        "COMPUTER_CAPTURE_UNAVAILABLE",
        "COMPUTER_UNAVAILABLE",
        "COMPUTER_SUPERVISOR_NOT_LIVE",
        "COMPUTER_UNAVAILABLE",
        "COMPUTER_AX_UNAVAILABLE",
        "COMPUTER_AX_UNAVAILABLE",
        "COMPUTER_AX_UNAVAILABLE",
        "COMPUTER_AX_UNAVAILABLE",
        "COMPUTER_PRESENCE_UNAVAILABLE",
    ];
    for (refusal, computer) in refusals.iter().zip(expected) {
        let row = refusal
            .row()
            .unwrap_or_else(|error| panic!("{refusal:?}: {error}"));
        println!(
            "{}{{{}}} -> {:?} -> {}",
            refusal.code.wire(),
            refusal.reason,
            row.key,
            row.computer.wire()
        );
        assert_eq!(row.computer.wire(), computer, "{refusal:?}");
        assert_eq!(
            row.nothing_sent,
            NothingSent::Yes,
            "{refusal:?}: a refusal sends nothing"
        );
    }
}

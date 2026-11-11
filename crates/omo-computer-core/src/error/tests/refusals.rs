//! Row 12's backend default refusals through the table: each maps to the COMPUTER_* member
//! its RefusalCode names, and nothing was sent.

use super::super::{from_refusal, NothingSent};
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
    for refusal in &refusals {
        let row = from_refusal(refusal).unwrap_or_else(|error| panic!("{refusal:?}: {error}"));
        println!(
            "{:?}{{{}}} -> {:?} -> {}",
            refusal.code,
            refusal.reason,
            row.key,
            row.computer.wire()
        );
        assert_eq!(
            row.computer.wire(),
            refusal.code.computer_code(),
            "{refusal:?}"
        );
        assert_eq!(
            row.nothing_sent,
            NothingSent::Yes,
            "{refusal:?}: a refusal sends nothing"
        );
    }
}

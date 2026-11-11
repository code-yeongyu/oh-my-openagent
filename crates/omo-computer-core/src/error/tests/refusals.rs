//! Row 12's backend default refusals through the table: each is a closed engine code with a
//! reason that has a row, maps to the COMPUTER_* member the design names for it, and sent nothing.

use super::super::{lookup, EngineCode, FailureKey, NothingSent, Source, UnknownFailure};
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
            refusal.reason.unwrap_or("-"),
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

#[test]
fn a_bare_refusal_resolves_to_its_codes_bare_row() {
    for code in EngineCode::ALL {
        let bare = Refusal::bare(code);
        let row = bare
            .row()
            .unwrap_or_else(|error| panic!("{}: {error}", code.wire()));
        let expected = lookup(FailureKey {
            source: Source::Engine(code),
            reason: None,
        });
        assert_eq!(Ok(row), expected, "{}: the bare row", code.wire());
        assert_eq!(bare.computer_code(), Ok(row.computer));
    }
    for (code, computer) in [
        (EngineCode::AmbiguousTarget, "COMPUTER_AMBIGUOUS_TARGET"),
        (EngineCode::Closed, "COMPUTER_TRANSPORT_LOST"),
        (EngineCode::AxUnconfirmed, "COMPUTER_AX_UNCONFIRMED"),
    ] {
        let resolved = Refusal::bare(code).computer_code().map(|code| code.wire());
        println!("{}{{}} -> {resolved:?}", code.wire());
        assert_eq!(resolved, Ok(computer));
    }
    let unlisted = Refusal::new(EngineCode::AmbiguousTarget, "budget");
    assert!(
        matches!(unlisted.row(), Err(UnknownFailure::Pair(_))),
        "a reason the code's rows do not list stays a typed UnknownFailure"
    );
    let unknown = Refusal::new(EngineCode::Closed, "not_a_reason");
    assert!(matches!(unknown.row(), Err(UnknownFailure::Reason { .. })));
}

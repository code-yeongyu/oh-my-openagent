use omo_computer_core::backend::{
    AxBackend, Backend, InputEvent, Ref, Route, Semantic, TaggedInput,
};

use crate::{FakeBackend, FakeMethod, Fault};

const ONE_WINDOW: &str = r#"{"windows":[{"id":"101","title":"Notes","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

fn key_down() -> TaggedInput {
    TaggedInput {
        event: InputEvent::Key {
            key: "a".to_owned(),
            down: true,
        },
        tag: 7,
    }
}

#[test]
fn recording_sink_is_empty_after_refusal() {
    let mut backend = FakeBackend::from_json(ONE_WINDOW).expect("the scenario loads");
    let sink = backend.sink();
    backend.inject(FakeMethod::Key, Fault::fail("InputFailed"));

    let refused = backend.post_input(&key_down(), Route::BackgroundWindow);
    assert!(
        refused
            .as_ref()
            .is_err_and(|refusal| refusal.nothing_sent()),
        "{refused:?}"
    );
    assert!(
        sink.is_empty(),
        "a refusal sends nothing: {:?}",
        sink.lines()
    );

    let perform = backend.perform(&Ref("s9:e1".to_owned()), &Semantic("press".to_owned()));
    assert!(perform.is_err(), "an unknown ref refuses");
    assert!(
        sink.is_empty(),
        "a refused AX write sends nothing: {:?}",
        sink.lines()
    );

    let delivered = backend.post_input(&key_down(), Route::BackgroundWindow);
    assert!(delivered.is_ok(), "{delivered:?}");
    assert_eq!(
        sink.lines().len(),
        1,
        "the control send is one line: {:?}",
        sink.lines()
    );
}

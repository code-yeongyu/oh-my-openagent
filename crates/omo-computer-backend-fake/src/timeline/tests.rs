use crate::{FakeBackend, LoadingState};

const WINDOW: &str = r#"{"id":"101","title":"Notes","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}"#;

#[test]
fn busy_timeline_drives_loading_state() {
    let json = format!(
        r#"{{"windows":[{WINDOW}],"busy_timeline":[{{"t_ms":100,"window":"101","busy":true,"indicator":"AXBusyIndicator"}},{{"t_ms":400,"window":"101","busy":false}}]}}"#
    );
    let backend = FakeBackend::from_json(&json).expect("the scenario loads");
    let clock = backend.clock();
    assert_eq!(backend.loading_state("101"), LoadingState::Idle);
    clock.advance(100);
    let busy = LoadingState::Busy {
        indicator: Some("AXBusyIndicator".to_owned()),
    };
    assert_eq!(backend.loading_state("101"), busy);
    clock.advance(299);
    assert_eq!(backend.loading_state("101"), busy);
    clock.advance(1);
    assert_eq!(backend.loading_state("101"), LoadingState::Idle);

    let control = FakeBackend::from_json(&format!(r#"{{"windows":[{WINDOW}]}}"#)).expect("control");
    control.clock().advance(100);
    assert_eq!(control.loading_state("101"), LoadingState::Unknown);
}

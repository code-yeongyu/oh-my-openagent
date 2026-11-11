//! Each field the v3 rows add changes the fake's behaviour against its null control.

use omo_computer_core::backend::{AxBackend, Backend, CaptureOptions, Target};
use omo_computer_core::listing::Rect;

use omo_computer_core::error::EngineCode;

use crate::{
    fixtures_dir, ClipboardRead, FakeBackend, FakeScenario, FrameAxis, LoadingState, Persona,
};

fn pair(field: &str) -> (FakeBackend, FakeBackend) {
    let load = |name: String| {
        FakeBackend::new(
            FakeScenario::load(&fixtures_dir().join(&name))
                .unwrap_or_else(|e| panic!("{name}: {e}")),
        )
    };
    let kebab = field.replace('_', "-");
    (
        load(format!("v3-{kebab}.json")),
        load(format!("v3-null-{kebab}.json")),
    )
}

const NO_CROSSHAIR: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

#[test]
fn v3_fields_change_behaviour_against_their_null_control() {
    let (set, null) = pair("persona");
    assert_eq!(
        (set.persona(), null.persona()),
        (Persona::Wayland, Persona::host())
    );

    let (mut set, mut null) = pair("ax_notification_timeline");
    let (mut events, mut quiet) = (set.events(), null.events());
    assert_eq!(
        events.next_event().ok().flatten().map(|e| e.kind),
        Some("AXValueChanged".to_owned())
    );
    assert_eq!(
        events.next_event(),
        Ok(None),
        "the next event is not due before 200 ms"
    );
    set.clock().advance(400);
    assert!(
        events.next_event().ok().flatten().is_some()
            && events.next_event().ok().flatten().is_some()
    );
    assert_eq!(quiet.next_event(), Ok(None));

    let (set, null) = pair("busy_timeline");
    set.clock().advance(100);
    assert!(matches!(
        set.loading_state("101"),
        LoadingState::Busy { .. }
    ));
    assert_eq!(null.loading_state("101"), LoadingState::Unknown);

    let (set, null) = pair("secure_focus");
    assert!(set.secure_focus("101") && !null.secure_focus("101"));
    let (set, null) = pair("secure_input_on");
    assert!(set.secure_input_on() && !null.secure_input_on());

    let (mut set, mut null) = pair("clipboard");
    assert_eq!(set.clipboard_read(), Ok(ClipboardRead::Concealed));
    assert_eq!(null.clipboard_read(), Ok(ClipboardRead::Text(None)));

    let (mut set, mut null) = pair("presence_surface");
    assert!(set.presence().is_none());
    null.presence()
        .expect("a presence surface")
        .show()
        .expect("shown");
    assert_eq!(null.sink().lines(), ["presence show"]);

    let (set, null) = pair("preview_subscribed");
    assert!(set.publish_preview("f1") && !null.publish_preview("f1"));
    assert_eq!((set.sink().len(), null.sink().len()), (1, 0));

    let (set, null) = pair("self_set");
    assert_eq!((set.self_set(), null.self_set()), (vec![9001], vec![]));

    let (mut set, mut null) = pair("window_frame_policy");
    let asked = Rect {
        x: 0.0,
        y: 0.0,
        width: 400.0,
        height: 300.0,
    };
    let kept = set.set_frame("101", asked).expect("a frame result");
    assert_eq!((kept.kept, kept.immovable), (vec![FrameAxis::Width], true));
    assert_eq!(
        kept.frame,
        Rect {
            x: 100.0,
            y: 120.0,
            width: 800.0,
            height: 300.0
        }
    );
    assert_eq!(null.set_frame("101", asked).expect("applied").frame, asked);

    let (set, null) = pair("held_keys");
    assert_eq!(
        (set.physically_held_keys(), null.physically_held_keys()),
        (vec!["shift".to_owned()], vec![])
    );
    let (set, null) = pair("full_access_preset");
    assert!(set.full_access_preset() && !null.full_access_preset());

    let (mut set, mut null) = pair("target_exit");
    let window = Target::Window("101".to_owned());
    assert!(set.capture(&window, &NO_CROSSHAIR).is_ok() && set.exited("101"));
    assert_eq!(
        set.capture(&window, &NO_CROSSHAIR)
            .map(|_| ())
            .map_err(|r| (r.code, r.reason)),
        Err((EngineCode::CaptureUnavailable, "unmapped"))
    );
    assert!(
        null.capture(&window, &NO_CROSSHAIR).is_ok()
            && null.capture(&window, &NO_CROSSHAIR).is_ok()
    );

    let (set, null) = pair("window_reservation");
    assert_eq!(
        (set.reservation("101"), null.reservation("101")),
        (Some("session-2".to_owned()), None)
    );
    let (set, null) = pair("code_identity");
    assert!(set
        .code_identity(4242)
        .is_some_and(|id| id.team_id.as_deref() == Some("TEAM123456")));
    assert!(null.code_identity(4242).is_none());
    let (set, null) = pair("hand");
    assert_eq!(
        set.hand().map(|hand| hand.machine_id),
        Some("machine-a".to_owned())
    );
    assert!(null.hand().is_none());
}

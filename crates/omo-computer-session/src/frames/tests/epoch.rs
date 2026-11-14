//! An epoch change supersedes every frame and expires every ref, for every reason and on
//! every persona.

use omo_computer_backend_fake::Persona;
use omo_computer_core::frame::EpochReason;
use serde_json::json;

use super::helpers::{click, fake, frame, frame_refused, object_session, params};
use crate::EpochChanged;

#[test]
fn epoch_changed_expires_frames_and_refs() {
    for reason in EpochReason::ALL {
        let (backend, sink) = fake(&json!({}));
        let mut session = object_session(backend);
        session
            .observe(params(json!({"target": "101"})))
            .expect("observe");
        let token = session.refs.latest("101").expect("a generation").token(0);
        let captured = frame(&mut session, "101");
        session.change_epoch(reason);
        assert_eq!(
            session.take_epoch_events(),
            vec![EpochChanged { reason, epoch: 1 }]
        );
        let stale = session.refs.locate(&token, false).expect_err("expired");
        assert_eq!(
            (stale.code.wire(), stale.reason),
            ("StaleRef", Some("epoch")),
            "{reason:?}"
        );
        let named = json!({"target": "101", "x": 10, "y": 10, "frameId": captured.frame_id});
        frame_refused(&mut session, &sink, named, "superseded");
        frame_refused(
            &mut session,
            &sink,
            json!({"target": "101", "x": 10, "y": 10}),
            "superseded",
        );
        frame(&mut session, "101");
        click(&mut session, json!({"target": "101", "x": 10, "y": 10}))
            .expect("a new frame of the new epoch");
    }
}

#[test]
fn epoch_change_supersedes_frame_and_expires_refs() {
    let events = json!({"epoch_events": [{"after_call": "capture", "reason": "display"}]});
    for persona in [Persona::Macos, Persona::X11, Persona::Win32] {
        let (backend, sink) = fake(&events);
        let mut session = object_session(backend.with_persona(persona));
        session
            .observe(params(json!({"target": "101"})))
            .expect("observe");
        let token = session.refs.latest("101").expect("a generation").token(0);
        frame(&mut session, "101");
        frame_refused(
            &mut session,
            &sink,
            json!({"target": "101", "x": 10, "y": 10}),
            "superseded",
        );
        assert_eq!(
            session.take_epoch_events(),
            vec![EpochChanged {
                reason: EpochReason::Display,
                epoch: 1
            }],
            "{persona:?}"
        );
        let stale = session.refs.locate(&token, false).expect_err("expired");
        assert_eq!(
            (stale.code.wire(), stale.reason),
            ("StaleRef", Some("epoch")),
            "{persona:?}"
        );
    }
}

//! The attribution window over the fake's foreign-input feed.

use omo_computer_backend_fake::FakeBackend;

use crate::attribution::{after_send, holds_send, place, Attribution, InputSeen, Placement};

#[test]
fn foreign_event_40ms_before_send_is_attributed_foreign() {
    let fake = FakeBackend::from_json(
        r#"{"user_input_timeline": [
            {"t_ms": 460, "pid": 4242, "kind": "click"},
            {"t_ms": 800, "pid": 4242, "kind": "key"},
            {"t_ms": 1100, "pid": 4242, "kind": "click"}
        ]}"#,
    )
    .expect("scenario");
    fake.clock().advance(1_200);
    let seen: Vec<InputSeen> = fake
        .user_inputs()
        .iter()
        .map(|input| InputSeen {
            at_ms: u64::try_from(input.at_ms).expect("after the clock's start"),
            own: false,
        })
        .collect();
    let send_ms = 500;
    assert_eq!(
        place(seen[0], send_ms),
        Placement::BeforeSend,
        "40 ms before the send"
    );
    assert!(holds_send(&seen, send_ms));
    assert_eq!(
        place(seen[2], send_ms),
        Placement::Outside,
        "600 ms after is not counted"
    );
    assert_eq!(
        after_send(&seen, send_ms),
        Attribution {
            foreign_events: 1,
            first_foreign_at_ms: Some(300)
        }
    );
    let own = InputSeen {
        at_ms: 480,
        own: true,
    };
    assert_eq!(
        place(own, send_ms),
        Placement::Outside,
        "the engine's own input never counts"
    );
}

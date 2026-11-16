//! Row 21a (D10, LEAD: A): a call that asks for background delivery and names no window is
//! refused before anything is sent (IS-2: no silent fallback to the foreground), with the
//! table's typed pair and next call; a call that names its window is routed to that window.

use serde_json::json;

use super::{params, wire, Run};
use crate::mutate::route_for;
use omo_computer_core::backend::Route;
use omo_computer_core::params::Delivery;

#[test]
fn ta5_background_delivery_without_a_target_is_refused_with_nothing_sent() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let refused = session
        .click(params(json!({ "x": 10, "y": 10, "callId": "c-untargeted", "delivery": "background" })))
        .expect_err("a background call names its window");
    assert_eq!(wire(&refused), ("BackgroundUnavailable", Some("target_unknown")));
    assert!(run.sink.is_empty(), "nothing sent");
}

#[test]
fn ta6_the_route_names_the_window_the_call_aims_at() {
    assert_eq!(
        route_for(Some("202"), Some(Delivery::Background)),
        Ok(Route::BackgroundWindow { window: "202".to_owned() })
    );
    assert_eq!(route_for(Some("202"), None), Ok(Route::BackgroundWindow { window: "202".to_owned() }));
    assert_eq!(route_for(Some("202"), Some(Delivery::Foreground)), Ok(Route::ForegroundHid));
    assert_eq!(route_for(None, None), Ok(Route::ForegroundHid));
    assert!(route_for(None, Some(Delivery::Background)).is_err(), "no window, no background route");
}

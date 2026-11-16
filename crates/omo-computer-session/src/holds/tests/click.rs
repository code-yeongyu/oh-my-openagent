//! Row 15's click under row 23's names (R50): double and secondary clicks take the one funnel,
//! and a click reports its delivery (`delivered`, `route`). Pre-satisfied by row 15; each test
//! carries a mutation proof in `task-23.red.txt`.

use serde_json::json;

use super::fixture;

fn click(f: &mut super::Fixture, extra: &serde_json::Value) -> serde_json::Value {
    let frame = f.frame();
    let mut call = json!({"target": "101", "x": 10, "y": 10, "frameId": frame});
    call.as_object_mut().expect("object").extend(extra.as_object().expect("object").clone());
    let reply = f.session.click(serde_json::from_value(call).expect("click params")).expect("click");
    serde_json::to_value(reply).expect("report")
}

#[test]
fn double_and_secondary_click_share_the_funnel() {
    let mut f = fixture("", None);
    let double = click(&mut f, &json!({"count": 2}));
    assert_eq!(double["delivered"], json!({"count": 5, "of": 5}), "move + two down/up pairs");
    let secondary = click(&mut f, &json!({"button": "right"}));
    assert_eq!(secondary["delivered"], json!({"count": 3, "of": 3}));
    let ups = f.inputs().iter().filter(|l| l.ends_with("down=false")).count();
    assert_eq!(ups, 3, "{:?}", f.inputs());
    assert!(f.inputs().iter().any(|l| l.ends_with("button right down=true")), "{:?}", f.inputs());
}

#[test]
fn click_reports_point_and_delivery_evidence() {
    let mut f = fixture("", None);
    let report = click(&mut f, &json!({}));
    assert_eq!(report["delivered"], json!({"count": 3, "of": 3}));
    assert_eq!(report["route"], json!("background_window"));
    assert!(f.inputs().iter().any(|l| l.ends_with("pointer_move x=10 y=10")), "the point sent: {:?}", f.inputs());
}

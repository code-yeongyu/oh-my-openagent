//! R70s(5), R70ck(1): the send path consults row 19's attribution window. A foreign input in
//! the target inside the window before the send holds it (`UserIntervened`, nothing sent);
//! consecutive sends with no foreign input all go out.

use super::*;

#[test]
fn foreign_input_inside_the_window_before_the_send_holds_it() {
    let (backend, sink) = fake(
        r#","busy_timeline":[{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"},{"t_ms":300,"window":"101","busy":false}],"user_input_timeline":[{"t_ms":280,"pid":4242,"kind":"key"}]"#,
    );
    let mut session = object_session(Box::new(backend));
    let refused = session
        .framed_click(None)
        .expect_err("the user's key 20 ms before the send holds it");
    assert_eq!(wire(&refused), ("UserIntervened", None));
    assert_eq!(refused.stamps.delivered, None, "nothing was sent");
    let posts: Vec<String> = sink.lines().into_iter().filter(|l| l.starts_with("post_input")).collect();
    assert!(posts.is_empty(), "{posts:?}");
}

#[test]
fn consecutive_sends_with_no_foreign_input_both_go_out() {
    let (backend, sink) = fake("");
    let mut session = object_session(Box::new(backend));
    session.framed_click(None).expect("first click");
    session.framed_click(None).expect("the second is not held by the first send's own input");
    let posts = sink.lines().into_iter().filter(|l| l.starts_with("post_input")).count();
    assert_eq!(posts, 6);
}

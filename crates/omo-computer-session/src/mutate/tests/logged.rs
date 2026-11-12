//! Gate review a4: a fallible step the funnel survives fail-closed is still logged, never
//! dropped. The crash path's poison record above all: when it cannot be written the marker is
//! kept (every other callId of the scope reads `recovery_required`) and the log says why.

use std::fs;

use omo_computer_core::report::Disposition;

use super::recovery::die_after_input;
use super::{click, Run};
use crate::mutate::poison::Poisoned;

#[test]
fn a_crashed_call_that_cannot_be_poison_recorded_is_logged_and_keeps_its_marker() {
    let run = Run::new();
    die_after_input(&run, "c-crash", 1);
    let blocked = run.dir.path().join("not-a-dir");
    fs::write(&blocked, b"a file where the poison records go").expect("file");
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.poisoned = Poisoned::Dir(blocked);
    let redrive = session
        .click(click("c-crash"))
        .expect_err("the re-drive is refused");
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert!(
        session
            .funnel
            .warned
            .iter()
            .any(|line| line.contains("not poison-recorded")),
        "{:?}",
        session.funnel.warned
    );
    assert!(
        run.marker_file().exists(),
        "fail-closed: the marker is kept"
    );
    assert_eq!(run.sink.len(), 3, "nothing was resent");
}

use super::*;

#[test]
fn permits_are_read_four_exec_one_and_return_on_drop() {
    let permits = Permits::default();
    let reads: Vec<Permit> = (0..4)
        .filter_map(|_| permits.try_take(PermitKind::Read))
        .collect();
    assert_eq!(reads.len(), 4);
    assert!(
        permits.try_take(PermitKind::Read).is_none(),
        "a fifth read waits"
    );
    let exec = permits.try_take(PermitKind::Exec).expect("one exec");
    assert!(
        permits.try_take(PermitKind::Exec).is_none(),
        "a second exec waits"
    );
    drop(exec);
    assert!(permits.try_take(PermitKind::Exec).is_some());
    drop(reads);
    assert_eq!(permits.held(PermitKind::Read), 0);
}

#[test]
fn frame_budget_is_two_per_second_and_names_the_wait() {
    let mut budget = FrameBudget::default();
    assert!(budget.admit(0).is_ok() && budget.admit(100).is_ok());
    let (refusal, retry) = budget.admit(400).expect_err("the third frame in a second");
    assert_eq!(
        refusal.computer_code().map(|code| code.wire()),
        Ok("COMPUTER_BUSY")
    );
    assert_eq!(retry, 600);
    assert!(
        budget.admit(1_000).is_ok(),
        "the first frame left the window"
    );
}

#[test]
fn encoding_ladder_is_png_then_jpeg_then_artifact() {
    assert_eq!(encoding_for(10, 5, 10), Encoding::Png);
    assert_eq!(encoding_for(20, 10, 10), Encoding::Jpeg);
    assert_eq!(encoding_for(20, 11, 10), Encoding::Artifact);
}

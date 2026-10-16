use super::*;

#[test]
fn an_engine_charged_to_its_launcher_runs() {
    assert_eq!(decide(41, Some(7)), Ok(()));
}

#[test]
fn an_engine_that_is_its_own_responsible_process_is_refused() {
    let refusal = decide(41, Some(41)).unwrap_err();
    assert!(refusal.contains("own responsible process"), "{refusal}");
}

#[test]
fn an_unresolvable_responsible_process_is_refused() {
    let refusal = decide(41, None).unwrap_err();
    assert!(refusal.contains("cannot be resolved"), "{refusal}");
}

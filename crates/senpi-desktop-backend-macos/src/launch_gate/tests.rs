use super::*;

#[test]
fn an_engine_charged_to_its_launcher_runs() {
    assert_eq!(decide(41, Some(7)), Ok(()));
}

#[test]
fn an_engine_that_is_its_own_responsible_process_is_refused() {
    let refusal = decide(41, Some(41)).unwrap_err();
    assert!(
        refusal.to_string().contains("own responsible process"),
        "{refusal}"
    );
}

#[test]
fn an_unresolvable_responsible_process_is_refused() {
    let refusal = decide(41, None).unwrap_err();
    assert!(
        refusal.to_string().contains("cannot be resolved"),
        "{refusal}"
    );
}

#[test]
fn native_refusals_have_distinct_machine_reasons() {
    for (responsible, reason) in [(Some(41), "self-responsible"), (None, "unresolved")] {
        // Given / when: the same native decision, not a host-side predicate.
        let refusal = decide(41, responsible).unwrap_err();
        let value = serde_json::to_value(&refusal).expect("serializable refusal");
        // Then: a machine reason exists independently of the human diagnostic.
        assert_eq!(value["reason"], reason);
        assert_eq!(value["version"], 1);
    }
}

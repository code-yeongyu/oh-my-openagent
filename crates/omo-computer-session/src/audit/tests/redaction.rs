use crate::audit::{keys, text};

#[test]
fn redaction_keeps_length_and_digest_outside_a_secure_focus_and_length_only_inside() {
    let open = text("hello", false);
    assert_eq!(
        (open.length, open.sha256_16.as_deref().map(str::len)),
        (5, Some(16))
    );
    assert_eq!(text("hello", true).sha256_16, None);
    let single = keys(&["a".to_owned()], true);
    assert_eq!(
        (
            single.keys,
            single.text.map(|text| text.length),
            single.redacted
        ),
        (None, Some(1), true)
    );
    let shifted = keys(&["shift".to_owned(), "A".to_owned()], true);
    assert!(shifted.redacted && shifted.keys.is_none());
    let chord = keys(&["cmd".to_owned(), "a".to_owned()], true);
    assert_eq!(
        chord.keys,
        Some(vec!["cmd".to_owned(), "a".to_owned()]),
        "chords keep their names"
    );
    assert_eq!(
        keys(&["a".to_owned()], false).keys,
        Some(vec!["a".to_owned()])
    );
    assert_eq!(
        crate::audit::truncate(&"x".repeat(300)).len(),
        256 + "...[truncated 44]".len()
    );
}

#[test]
fn audit_timestamp_is_rfc3339_utc_with_milliseconds() {
    assert_eq!(crate::audit::rfc3339_ms(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(
        crate::audit::rfc3339_ms(951_782_400_123),
        "2000-02-29T00:00:00.123Z"
    );
    assert_eq!(
        crate::audit::rfc3339_ms(1_762_819_199_999),
        "2025-11-10T23:59:59.999Z"
    );
}

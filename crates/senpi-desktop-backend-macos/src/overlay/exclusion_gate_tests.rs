use super::Overlay;

#[test]
fn enabled_overlay_never_starts_when_capture_cannot_exclude_it() {
    // Given: a host without per-frame capture exclusion (macOS 11-13).
    let overlay = Overlay::default();
    // When: the default-on cursor is enabled.
    overlay.configure_for(true, false);
    // Then: no helper runs, so screenshots keep the unfiltered path and report no overlay.
    assert!(!overlay.available());
}

#[test]
fn disabled_overlay_stays_off_even_when_exclusion_is_supported() {
    let overlay = Overlay::default();
    overlay.configure_for(false, true);
    assert!(!overlay.available());
}

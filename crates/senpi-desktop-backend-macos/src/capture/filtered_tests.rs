use super::{resolve_exclusions, supported};

#[test]
fn helper_closed_before_capture_is_dropped_instead_of_failing_the_frame() {
    // Given: three helper IDs; 22 closed after enumeration and the window list confirms it is gone.
    let in_content = [11_u32, 33];
    // When: exclusions are matched against the content snapshot.
    let present = resolve_exclusions(&[11, 22, 33], |id| in_content.contains(&id), || Ok(vec![11, 33]))
        .expect("a helper that no longer exists does not fail the frame");
    // Then: only live helpers are excluded.
    assert_eq!(present, [11, 33]);
}

#[test]
fn helper_missing_from_content_but_still_alive_fails_the_frame() {
    // Given: helper 22 still exists in the window list but is absent from the capture content.
    let in_content = [11_u32, 33];
    // When: exclusions are resolved.
    let result = resolve_exclusions(&[11, 22, 33], |id| in_content.contains(&id), || Ok(vec![11, 22, 33]));
    // Then: the frame is refused instead of capturing that helper unfiltered.
    let error = result.expect_err("an existing helper that cannot be excluded must fail closed");
    assert!(error.to_string().contains("22"), "{error}");
}

#[test]
fn window_list_is_not_read_when_every_exclusion_is_in_the_content() {
    // Given: every helper is in the content snapshot.
    let in_content = [11_u32, 33];
    // When: exclusions are resolved.
    let present = resolve_exclusions(&[11, 33], |id| in_content.contains(&id), || panic!("window list read"))
        .expect("no missing helper");
    // Then: no extra window enumeration happens on the common path.
    assert_eq!(present, [11, 33]);
}

#[test]
fn exclusion_api_presence_matches_the_running_macos_major_version() {
    // Given: the host's macOS major version.
    let output = std::process::Command::new("sw_vers").arg("-productVersion").output()
        .expect("sw_vers runs on every macOS host");
    let version = String::from_utf8(output.stdout).expect("sw_vers prints UTF-8");
    let major: u32 = version.trim().split('.').next().and_then(|m| m.parse().ok())
        .expect("sw_vers prints a numeric major version");
    // When / Then: the native probe agrees with the documented macOS 14 floor.
    assert_eq!(supported(), major >= 14, "macOS {version}");
}

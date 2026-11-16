//! A-IS-64 test 3 (ruling R70bm(3)): a real backend's platform is a constant of its own crate that
//! nothing carried - a peer, a setting, a consent file - can change; the per-OS safety tables follow
//! it. This crate's is Windows on every host the test runs on.

use omo_computer_core::report::Platform;

use crate::backend::PLATFORM;

#[test]
fn the_win32_backends_platform_is_the_constant_windows() {
    assert_eq!(PLATFORM, Platform::Windows);
}

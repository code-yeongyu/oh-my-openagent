//! OCR stays out of the default observe payload.

use omo_computer_core::backend::Backend;
use omo_computer_core::params::ObserveOptions;

use super::kit::window_os;
use crate::ocr::decide;
use crate::Win32Backend;

#[test]
fn ocr_absent_from_default_observe() {
    let defaults = ObserveOptions::default();
    // The default observe of a window with a tree never runs OCR, even with an engine present.
    assert!(!decide(defaults.ocr, true, 12, false, true));
    // A capability-less host never runs it, whatever is asked.
    assert!(!decide(
        Some(omo_computer_core::params::OcrMode::Always),
        false,
        0,
        true,
        true
    ));
    // Auto runs it only on an empty or AX-blind tree after the cooldown; Always on request.
    assert!(decide(defaults.ocr, true, 0, false, true));
    assert!(!decide(defaults.ocr, true, 0, false, false));
    assert!(decide(
        Some(omo_computer_core::params::OcrMode::Always),
        true,
        12,
        false,
        false
    ));
    assert!(!decide(
        Some(omo_computer_core::params::OcrMode::Never),
        true,
        0,
        true,
        true
    ));
    // The capability is the probe's answer, never asserted.
    let backend = Win32Backend::with_os(window_os(true));
    assert!(!backend.capabilities().ocr);
}

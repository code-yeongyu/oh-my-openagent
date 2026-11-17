//! Checked CF reads on real CoreFoundation values (review L1, L2) and the run loop's idle
//! signal the AX thread blocks on (review L3).

use super::ffi;
use super::observer::run_slice;
use super::token::data_bytes;
use super::values::ax_elements;
use crate::capture::os::cf::{cf_string, CfRef, Owned};

fn array_of(values: &[CfRef]) -> Option<Owned> {
    // SAFETY: valid CF values; the array retains them with the CFType callbacks.
    Owned::new(unsafe {
        ffi::CFArrayCreate(
            std::ptr::null(),
            values.as_ptr(),
            isize::try_from(values.len()).ok()?,
            std::ptr::addr_of!(ffi::kCFTypeArrayCallBacks),
        )
    })
}

fn own_app() -> Option<Owned> {
    // SAFETY: plain call; +1 application element (no IPC).
    Owned::new(unsafe {
        ffi::AXUIElementCreateApplication(i32::try_from(std::process::id()).ok()?)
    })
}

#[test]
fn a_non_array_windows_value_reads_as_no_elements() {
    let text = cf_string(c"AXWindows").expect("a CFString");
    assert!(ax_elements(text.get()).is_empty());
}

#[test]
fn only_the_ax_elements_of_an_array_are_taken() {
    let app = own_app().expect("an application element");
    let text = cf_string(c"not an element").expect("a CFString");
    let array = array_of(&[text.get(), app.get()]).expect("a CFArray");
    let elements = ax_elements(array.get());
    assert_eq!(elements.len(), 1, "the CFString entry is skipped");
    // SAFETY: both are live CF references.
    assert!(unsafe { crate::capture::os::cf::CFEqual(elements[0].get(), app.get()) });
}

#[test]
fn a_token_that_is_not_cf_data_is_refused() {
    let text = cf_string(c"not data").expect("a CFString");
    assert_eq!(data_bytes(text.get()), None);
}

#[test]
fn cf_data_token_bytes_are_copied() {
    let bytes = [1u8, 2, 3];
    // SAFETY: `bytes` holds 3 bytes; +1 CFData.
    let data = Owned::new(unsafe { ffi::CFDataCreate(std::ptr::null(), bytes.as_ptr(), 3) })
        .expect("a CFData");
    assert_eq!(data_bytes(data.get()), Some(bytes.to_vec()));
}

#[test]
fn a_run_loop_without_sources_reports_finished_so_the_thread_blocks() {
    let outcome = std::thread::spawn(run_slice).join().expect("the slice ran");
    assert_eq!(outcome, ffi::RUN_LOOP_FINISHED);
}

//! Which Space a window is on, read through the SkyLight space SPI
//! (`SLSCopySpacesForWindows` against `SLSGetActiveSpace`). Without that SPI
//! (or with `SENPI_DESKTOP_DISABLE_SKYLIGHT=1`) the placement is unknown and
//! capture keeps its public route.

use std::ffi::c_void;
use std::ptr::NonNull;

use objc2_core_foundation::{CFArray, CFNumber, CFRetained};

/// `kCGSAllSpacesMask`: user, fullscreen and system spaces.
const ALL_SPACES_MASK: i32 = 0x7;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpacePlacement {
    /// The window is on the active Space.
    Current,
    /// The window is only on Spaces other than the active one.
    Other,
    /// The SPI is missing or did not answer.
    Unknown,
}

/// The placement of `window_id` relative to the active Space.
pub(crate) fn placement(window_id: u32) -> SpacePlacement {
    #[cfg(test)]
    if let Some(placement) = TEST_PLACEMENT.with(std::cell::Cell::get) {
        return placement;
    }
    native_placement(window_id)
}

fn native_placement(window_id: u32) -> SpacePlacement {
    let Some(spi) = crate::skylight::capture_spi() else {
        return SpacePlacement::Unknown;
    };
    let (Some(copy_spaces), Some(active_space)) = (spi.copy_spaces, spi.active_space) else {
        return SpacePlacement::Unknown;
    };
    // SAFETY: the resolved symbols take no pointers beyond the documented ones.
    let connection = unsafe { (spi.main_connection)() };
    // SAFETY: `connection` is this process's own WindowServer connection.
    let active = unsafe { active_space(connection) };
    let windows = CFArray::from_retained_objects(&[CFNumber::new_i64(i64::from(window_id))]);
    let windows_ptr = CFRetained::as_ptr(&windows).as_ptr().cast::<c_void>().cast_const();
    // SAFETY: `windows` is a live CFArray of CFNumber window ids for the call;
    // the result follows the Copy rule (+1) and is owned below.
    let raw = unsafe { copy_spaces(connection, ALL_SPACES_MASK, windows_ptr) };
    let Some(raw) = NonNull::new(raw.cast_mut().cast::<CFArray>()) else {
        return SpacePlacement::Unknown;
    };
    // SAFETY: a non-null create-rule CFArray this function now owns.
    let spaces: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: SLSCopySpacesForWindows returns space ids as CFNumbers.
    let spaces = unsafe { CFRetained::cast_unchecked::<CFArray<CFNumber>>(spaces) };
    let ids: Vec<u64> = spaces
        .iter()
        .filter_map(|space| space.as_i64().and_then(|id| u64::try_from(id).ok()))
        .collect();
    classify(&ids, active)
}

/// Current when the active Space holds the window, Other when only other
/// Spaces do, Unknown when either side is missing.
pub(crate) fn classify(window_spaces: &[u64], active: u64) -> SpacePlacement {
    if active == 0 || window_spaces.is_empty() {
        SpacePlacement::Unknown
    } else if window_spaces.contains(&active) {
        SpacePlacement::Current
    } else {
        SpacePlacement::Other
    }
}

#[cfg(test)]
thread_local! {
    static TEST_PLACEMENT: std::cell::Cell<Option<SpacePlacement>> =
        const { std::cell::Cell::new(Some(SpacePlacement::Unknown)) };
}

/// Test hook: the placement captures on this thread see (`Unknown` unless
/// set); `None` reads the real SPI.
#[cfg(test)]
pub(crate) fn override_placement(placement: Option<SpacePlacement>) {
    TEST_PLACEMENT.with(|cell| cell.set(placement));
}

#[cfg(test)]
mod tests {
    use super::{classify, SpacePlacement};

    #[test]
    fn a_window_on_the_active_space_is_current() {
        assert_eq!(classify(&[3, 7], 7), SpacePlacement::Current);
    }

    #[test]
    fn a_window_only_on_other_spaces_is_other() {
        assert_eq!(classify(&[3, 4], 7), SpacePlacement::Other);
    }

    #[test]
    fn a_missing_answer_is_unknown() {
        assert_eq!(classify(&[], 7), SpacePlacement::Unknown);
        assert_eq!(classify(&[7], 0), SpacePlacement::Unknown);
    }
}

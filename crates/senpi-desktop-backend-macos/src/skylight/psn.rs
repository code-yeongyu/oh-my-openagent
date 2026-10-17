//! Process serial numbers and the 248-byte SkyLight focus-without-raise event
//! record. The record layout is WindowServer-private; the constants match
//! oh-my-pi's proven encoding.

use super::spi::{self, PsnLookup};

pub(super) const EVENT_RECORD_LENGTH: usize = 248;
const EVENT_RECORD_LENGTH_BYTE: u8 = 0xf8;
const EVENT_RECORD_KIND: u8 = 0x0d;
const WINDOW_ID_OFFSET: usize = 0x3c;
const FOCUS_MARKER_OFFSET: usize = 0x8a;

/// `kCPSNoWindows`: set front without raising or gathering windows.
pub(super) const SET_FRONT_NO_WINDOWS: u32 = 0x400;

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ProcessSerialNumber {
    pub(super) high: u32,
    pub(super) low: u32,
}

/// The focus marker byte of a SkyLight record: `0x02` defocuses the process,
/// `0x01` makes its window key.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FocusMarker {
    Defocus,
    Focus,
}

impl FocusMarker {
    const fn byte(self) -> u8 {
        match self {
            Self::Defocus => 0x02,
            Self::Focus => 0x01,
        }
    }
}

/// Builds the zeroed focus record for `wid`. Pure: only the byte assembly.
pub(super) fn focus_record(wid: u32, marker: FocusMarker) -> [u8; EVENT_RECORD_LENGTH] {
    let mut record = [0u8; EVENT_RECORD_LENGTH];
    record[0x04] = EVENT_RECORD_LENGTH_BYTE;
    record[0x08] = EVENT_RECORD_KIND;
    record[WINDOW_ID_OFFSET..WINDOW_ID_OFFSET + 4].copy_from_slice(&wid.to_le_bytes());
    record[FOCUS_MARKER_OFFSET] = marker.byte();
    record
}

/// The frontmost process's PSN, or `None` when the SPI refused.
pub(super) fn front_process() -> Option<ProcessSerialNumber> {
    let spi = spi::required().ok()?;
    let mut psn = ProcessSerialNumber::default();
    // SAFETY: `psn` is writable and exactly the 8-byte PSN record expected by
    // this SPI.
    (unsafe { (spi.get_front)(&mut psn) } == 0).then_some(psn)
}

/// The PSN owning `pid`, preferring the window-owner connection chain and
/// falling back to `GetProcessForPID`.
pub(super) fn process_psn(lookup: PsnLookup, pid: libc::pid_t, wid: u32) -> Option<ProcessSerialNumber> {
    if let (Some(main_connection), Some(get_window_owner), Some(get_connection_psn)) = (
        lookup.main_connection,
        lookup.get_window_owner,
        lookup.get_connection_psn,
    ) {
        // SAFETY: The no-argument connection query was resolved with its exact
        // signature.
        let main_connection = unsafe { main_connection() };
        let mut owner_connection = 0u32;
        // SAFETY: `owner_connection` is writable for the synchronous lookup.
        if unsafe { get_window_owner(main_connection, wid, &mut owner_connection) } == 0
            && owner_connection != 0
        {
            let mut psn = ProcessSerialNumber::default();
            // SAFETY: `psn` is writable and has the exact 8-byte layout
            // required by the SPI.
            if unsafe { get_connection_psn(owner_connection, &mut psn) } == 0 {
                return Some(psn);
            }
        }
    }
    let fallback = lookup.get_process_for_pid?;
    let mut psn = ProcessSerialNumber::default();
    // SAFETY: `psn` is writable and `fallback` was resolved with the exact
    // GetProcessForPID ABI.
    (unsafe { fallback(pid, &mut psn) } == 0).then_some(psn)
}

/// Posts one focus record to `psn`; `false` when the SPI rejected it.
pub(super) fn post_focus_record(psn: &ProcessSerialNumber, wid: u32, marker: FocusMarker) -> bool {
    let Ok(spi) = spi::required() else {
        return false;
    };
    let record = focus_record(wid, marker);
    // SAFETY: Both the PSN and the complete 248-byte record live through the
    // synchronous SPI call.
    let posted = unsafe { (spi.post_record)(psn, record.as_ptr()) };
    posted == 0
}

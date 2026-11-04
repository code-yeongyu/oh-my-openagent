use std::ffi::{c_void, CStr};
use std::ptr::NonNull;

use senpi_desktop_core::error::ErrorCode;

use super::{resolve_spaces, space_spi_or_unsupported};

const SPACE_SYMBOLS: [&CStr; 9] = [
    c"SLSMainConnectionID",
    c"SLSGetActiveSpace",
    c"SLSCopySpacesForWindows",
    c"SLSMoveWindowsToManagedSpace",
    c"SLSGetWindowOwner",
    c"SLSConnectionGetPID",
    c"SLSSpaceGetType",
    c"SLSCopyManagedDisplays",
    c"SLSManagedDisplayGetCurrentSpace",
];

/// Stands in for every resolved address; resolution only stores it.
static RESOLVED: u8 = 0;

fn resolved() -> NonNull<c_void> {
    NonNull::from(&RESOLVED).cast()
}

#[test]
fn every_space_symbol_resolved_yields_the_set() {
    // Given / When
    let spi = resolve_spaces(|_| Some(resolved()));
    // Then
    assert!(spi.is_some());
}

#[test]
fn any_missing_space_symbol_is_space_unsupported() {
    for missing in SPACE_SYMBOLS {
        // Given: this macOS does not export `missing` (nor its CGS alias)
        let lookup = |name: &CStr| {
            let alias = name == c"CGSMainConnectionID" && missing == c"SLSMainConnectionID"
                || name == c"CGSGetActiveSpace" && missing == c"SLSGetActiveSpace";
            (name != missing && !alias).then(resolved)
        };
        // When
        let spi = resolve_spaces(lookup);
        // Then: no partial set, and the caller is told SpaceUnsupported
        assert!(spi.is_none(), "{missing:?}");
        let error = space_spi_or_unsupported(spi.as_ref()).map(|_| ()).expect_err("unsupported");
        assert_eq!(error.code, ErrorCode::SpaceUnsupported, "{missing:?}");
    }
}

#[test]
fn the_coregraphics_connection_aliases_stand_in_for_skylights() {
    // Given: only the CGS names of the connection and active-Space functions
    let lookup =
        |name: &CStr| distinct_symbol(name).filter(|_| name != c"SLSMainConnectionID" && name != c"SLSGetActiveSpace");
    // When
    let spi = resolve_spaces(lookup).expect("the CGS aliases complete the set");
    // Then: the two fields hold the CGS symbols
    assert_eq!(spi.connection as *const (), distinct(c"CGSMainConnectionID"));
    assert_eq!(spi.active as *const (), distinct(c"CGSGetActiveSpace"));
}

const CGS_ALIASES: [&CStr; 2] = [c"CGSMainConnectionID", c"CGSGetActiveSpace"];

/// One distinct address per Space symbol name (and per CGS alias).
static DISTINCT: [u8; 11] = [0; 11];

fn distinct_symbol(name: &CStr) -> Option<NonNull<c_void>> {
    SPACE_SYMBOLS
        .iter()
        .chain(&CGS_ALIASES)
        .position(|known| *known == name)
        .map(|index| NonNull::from(&DISTINCT[index]).cast())
}

fn distinct(name: &CStr) -> *const () {
    distinct_symbol(name).expect("a known symbol").as_ptr().cast_const().cast()
}

#[test]
fn each_space_field_holds_the_symbol_resolved_under_its_own_name() {
    // Given: every name, SkyLight and CGS alike, resolves to its own address
    // When
    let spi = resolve_spaces(distinct_symbol).expect("every symbol resolved");
    // Then: each field is the symbol named for it, SkyLight's name preferred
    let fields: [(*const (), &CStr); 9] = [
        (spi.connection as *const (), c"SLSMainConnectionID"),
        (spi.active as *const (), c"SLSGetActiveSpace"),
        (spi.copy_spaces as *const (), c"SLSCopySpacesForWindows"),
        (spi.move_windows as *const (), c"SLSMoveWindowsToManagedSpace"),
        (spi.window_owner as *const (), c"SLSGetWindowOwner"),
        (spi.connection_pid as *const (), c"SLSConnectionGetPID"),
        (spi.space_type as *const (), c"SLSSpaceGetType"),
        (spi.copy_displays as *const (), c"SLSCopyManagedDisplays"),
        (spi.display_space as *const (), c"SLSManagedDisplayGetCurrentSpace"),
    ];
    for (field, name) in fields {
        assert_eq!(field, distinct(name), "{name:?}");
    }
}

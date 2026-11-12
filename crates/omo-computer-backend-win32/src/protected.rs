//! The Windows identity the shipped protected table is matched on (d-windows.md '## Identity and
//! permissions', Protected targets): a packaged app by its AUMID, any other process by its image
//! name. The table and its matching are the safety crate's (`protected/windows.json`).

use omo_computer_safety::gate::Identity;

/// The identity of process `pid` running `image`, packaged as `aumid` when it is.
#[must_use]
pub fn identity(pid: u32, image: &str, aumid: Option<&str>) -> Identity {
    let app_key = aumid.map_or_else(
        || image.rsplit(['\\', '/']).next().unwrap_or(image).to_owned(),
        ToOwned::to_owned,
    );
    Identity {
        pid,
        app_key,
        surface: None,
    }
}

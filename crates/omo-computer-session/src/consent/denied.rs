//! The denied-app table, ON by default: the shipped protected-target table's `deniedApps` seeds
//! per OS, keyed as the Scope stage keys a target (macOS bundle id; Windows image name or
//! AUMID package family; Linux `WM_CLASS` / `app_id`).

use omo_computer_safety::gate::Identity;
use omo_computer_safety::protected::{Os, ProtectedTable};

/// The seeds `os` ships.
#[must_use]
pub fn denied_app_seeds(os: Os) -> &'static [String] {
    &ProtectedTable::of(os).denied_apps
}

/// Whether the Scope stage refuses `app_key` on `os` as a denied app; an `<app>:<surface>` key
/// names one surface of its host app, as the table's surface-qualified entries do.
#[must_use]
pub fn is_denied_app(os: Os, app_key: &str) -> bool {
    let (app, surface) = app_key
        .split_once(':')
        .map_or((app_key, None), |(app, surface)| (app, Some(surface.to_owned())));
    ProtectedTable::of(os).is_denied_app(&Identity {
        pid: 0,
        app_key: app.to_owned(),
        surface,
    })
}

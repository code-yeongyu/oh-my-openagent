//! The X11 doctor chain (design row L11): DISPLAY, the accessibility bus, MPX through the
//! uinput ACL, and the compositor - each a tri-state check read without prompting, joined to
//! `diagnose` through `Backend::diagnose` (R62). A bare container reads `ax_bus:unreachable` and
//! `mpx:unavailable{uinput}` and opens no dialog.

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::os::unix::net::UnixStream;
use std::path::Path;

use omo_computer_core::backend::BackendProbes;
use omo_computer_core::results::{PermissionReport, PermissionState, ProbeCheck, ProbeState};

/// What one read of the host found; every field is a read, none prompts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostReads {
    /// A display was reached.
    pub display: bool,
    pub bus: BusReach,
    pub uinput: Uinput,
    /// `None` when there is no display to ask.
    pub compositor: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusReach {
    /// The AT-SPI bus socket answered a connect.
    Answered,
    /// Only the session bus answers; the registry was not reached.
    SessionOnly,
    Unreachable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Uinput {
    Writable,
    Denied,
    Absent,
}

fn check(name: &str, state: ProbeState, reason: Option<&str>) -> ProbeCheck {
    ProbeCheck {
        name: name.to_owned(),
        state,
        reason: reason.map(str::to_owned),
    }
}

/// The checks and the accessibility permission entry of one read.
#[must_use]
pub fn probes(reads: HostReads) -> BackendProbes {
    let display = if reads.display {
        check("display", ProbeState::Ok, None)
    } else {
        check(
            "display",
            ProbeState::Unavailable,
            Some("no_display_server"),
        )
    };
    let (ax_bus, accessibility) = match reads.bus {
        BusReach::Answered => (
            check("ax_bus", ProbeState::Ok, None),
            PermissionState::Granted,
        ),
        BusReach::SessionOnly => (
            check("ax_bus", ProbeState::Unknown, Some("registry_unverified")),
            PermissionState::Unknown,
        ),
        BusReach::Unreachable => (
            check("ax_bus", ProbeState::Unavailable, Some("unreachable")),
            PermissionState::Unknown,
        ),
    };
    let mpx = match reads.uinput {
        Uinput::Writable => check("mpx", ProbeState::Ok, None),
        Uinput::Denied | Uinput::Absent => check("mpx", ProbeState::Unavailable, Some("uinput")),
    };
    let compositor = match reads.compositor {
        Some(true) => check("compositor", ProbeState::Ok, None),
        Some(false) => check("compositor", ProbeState::Unavailable, Some("none_running")),
        None => check("compositor", ProbeState::Unknown, Some("no_display_server")),
    };
    let mut permissions = BTreeMap::new();
    permissions.insert(
        "accessibility".to_owned(),
        PermissionReport {
            state: accessibility,
            settings_url: None,
            relaunch_required: None,
        },
    );
    BackendProbes {
        chain: Vec::new(),
        permissions,
        checks: vec![display, ax_bus, mpx, compositor],
    }
}

fn unix_path(address: &str) -> Option<&str> {
    address
        .split(';')
        .next()?
        .strip_prefix("unix:")?
        .split(',')
        .find_map(|part| part.strip_prefix("path="))
}

fn answers(address: Option<&str>) -> bool {
    address
        .and_then(unix_path)
        .is_some_and(|path| UnixStream::connect(path).is_ok())
}

/// The accessibility bus as the environment names it: the AT-SPI bus first, the session bus
/// after. A connect is the only request made.
#[must_use]
pub fn bus_reach(at_spi: Option<&str>, session: Option<&str>) -> BusReach {
    if answers(at_spi) {
        BusReach::Answered
    } else if answers(session) {
        BusReach::SessionOnly
    } else {
        BusReach::Unreachable
    }
}

/// `/dev/uinput` opened for writing and closed at once; no device is created.
#[must_use]
pub fn uinput_at(path: &Path) -> Uinput {
    if !path.exists() {
        return Uinput::Absent;
    }
    match OpenOptions::new().write(true).open(path) {
        Ok(_) => Uinput::Writable,
        Err(_) => Uinput::Denied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states(probes: &BackendProbes) -> Vec<(String, ProbeState, Option<String>)> {
        probes
            .checks
            .iter()
            .map(|c| (c.name.clone(), c.state, c.reason.clone()))
            .collect()
    }

    #[test]
    fn doctor_tri_states_on_missing_bus() {
        let dir = std::env::temp_dir().join(format!("omo-x11-doctor-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let gone = format!("unix:path={}", dir.join("no-bus").display());
        let reads = HostReads {
            display: false,
            bus: bus_reach(Some(&gone), None),
            uinput: uinput_at(&dir.join("uinput")),
            compositor: None,
        };
        let probes = probes(reads);
        let unknown = |r: &str| Some(r.to_owned());
        assert_eq!(
            states(&probes),
            vec![
                (
                    "display".to_owned(),
                    ProbeState::Unavailable,
                    unknown("no_display_server")
                ),
                (
                    "ax_bus".to_owned(),
                    ProbeState::Unavailable,
                    unknown("unreachable")
                ),
                ("mpx".to_owned(), ProbeState::Unavailable, unknown("uinput")),
                (
                    "compositor".to_owned(),
                    ProbeState::Unknown,
                    unknown("no_display_server")
                ),
            ]
        );
        assert_eq!(
            probes.permissions["accessibility"].state,
            PermissionState::Unknown,
            "a missing bus is never denied"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_check_reaches_each_of_its_states() {
        let ok = probes(HostReads {
            display: true,
            bus: BusReach::Answered,
            uinput: Uinput::Writable,
            compositor: Some(true),
        });
        assert!(ok
            .checks
            .iter()
            .all(|c| c.state == ProbeState::Ok && c.reason.is_none()));
        assert_eq!(
            ok.permissions["accessibility"].state,
            PermissionState::Granted
        );
        let partial = probes(HostReads {
            display: true,
            bus: BusReach::SessionOnly,
            uinput: Uinput::Denied,
            compositor: Some(false),
        });
        assert_eq!(
            states(&partial)[1..],
            [
                (
                    "ax_bus".to_owned(),
                    ProbeState::Unknown,
                    Some("registry_unverified".to_owned())
                ),
                (
                    "mpx".to_owned(),
                    ProbeState::Unavailable,
                    Some("uinput".to_owned())
                ),
                (
                    "compositor".to_owned(),
                    ProbeState::Unavailable,
                    Some("none_running".to_owned())
                ),
            ]
        );
    }

    #[test]
    fn a_listening_bus_socket_answers() {
        let dir = std::env::temp_dir().join(format!("omo-x11-bus-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let socket = dir.join("bus");
        let _listener = std::os::unix::net::UnixListener::bind(&socket).expect("bind");
        let address = format!("unix:path={},guid=00", socket.display());
        assert_eq!(bus_reach(Some(&address), None), BusReach::Answered);
        assert_eq!(bus_reach(None, Some(&address)), BusReach::SessionOnly);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

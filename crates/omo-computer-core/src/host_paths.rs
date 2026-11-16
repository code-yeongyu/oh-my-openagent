//! Where a host-less engine finds the live hand tool host (DESIGN-GAPS-ROW28 revision 2, G1
//! item 1; R70k): the host's local-API address, the persisted `host-latch` file and the hand's
//! `consent.json`. One resolver, so the engine (row 28) and the host (row 37) cannot diverge;
//! the config root is built from the user-database home, never `$HOME` (#13882 M3).
//!
//! Every Unix host API is a socket FILE in the per-uid runtime root, which is owner-only: the
//! directory's permissions keep every other uid from connecting to it or binding the name
//! (#13882 M2; a Linux abstract name has no permissions at all). Under the fake-backend test seam
//! the files sit under `OMO_COMPUTER_RUNTIME_DIR` (B1: a real backend never reads the seam).

use std::path::{Path, PathBuf};

use crate::paths::RUNTIME_DIR_SEAM;

/// The user-database home (paths.rs), never `$HOME`: the config root must not move with the
/// environment, or the host's latch and the engine's read of it name different files (#13882 M3).
#[cfg(unix)]
fn user_home() -> Option<PathBuf> {
    crate::paths::user_home()
}

#[cfg(not(unix))]
const fn user_home() -> Option<PathBuf> {
    None
}

const SOCKET_FILE: &str = "host-api.sock";
const ENDPOINT_FILE: &str = "host-endpoint";

/// The address the authority host binds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostAddress {
    /// A Unix socket file in the owner-only runtime root (Linux, macOS).
    Socket(PathBuf),
    /// The owner-only file the Windows host publishes its pipe name in.
    Endpoint(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPaths {
    /// `<config>`: the directory `computer/` (consent, its sidecar, the host latch) lives in.
    pub config: PathBuf,
    pub address: HostAddress,
}

impl HostPaths {
    /// `<config>/computer/`, which every file below sits in and which is validated as one dir.
    #[must_use]
    pub fn computer_dir(&self) -> PathBuf {
        self.config.join("computer")
    }

    #[must_use]
    pub fn host_latch(&self) -> PathBuf {
        self.computer_dir().join("host-latch")
    }

    #[must_use]
    pub fn consent(&self) -> PathBuf {
        self.computer_dir().join("consent.json")
    }
}

/// Why no host path is named.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostPathsUnavailable {
    /// The runtime-dir seam is set while the backend is real (B1): no name is computed.
    SeamWithRealBackend,
    /// No config root can be named for the effective user.
    NoConfigRoot,
}

/// The host paths for this engine. `fake` says the backend is the fake; only then is the seam read.
///
/// # Errors
/// The seam with a real backend, or no config root.
pub fn resolve(lookup: impl Fn(&str) -> Option<String>, fake: bool) -> Result<HostPaths, HostPathsUnavailable> {
    let seam = lookup(RUNTIME_DIR_SEAM).filter(|dir| !dir.is_empty());
    match (seam, fake) {
        (Some(_), false) => Err(HostPathsUnavailable::SeamWithRealBackend),
        (Some(dir), true) => Ok(under_seam(Path::new(&dir))),
        (None, _) => real(&lookup),
    }
}

fn under_seam(dir: &Path) -> HostPaths {
    let address = if cfg!(windows) {
        HostAddress::Endpoint(dir.join(ENDPOINT_FILE))
    } else {
        HostAddress::Socket(dir.join(SOCKET_FILE))
    };
    HostPaths {
        config: dir.to_path_buf(),
        address,
    }
}

fn real(lookup: &impl Fn(&str) -> Option<String>) -> Result<HostPaths, HostPathsUnavailable> {
    let absolute = |name: &str| lookup(name).map(PathBuf::from).filter(|path| path.is_absolute());
    let home = user_home();
    let config = if cfg!(target_os = "macos") {
        home.map(|home| home.join("Library/Application Support/OmO"))
    } else if cfg!(windows) {
        absolute("APPDATA").map(|dir| dir.join("OmO"))
    } else {
        absolute("XDG_CONFIG_HOME")
            .or_else(|| home.map(|home| home.join(".config")))
            .map(|dir| dir.join("omo"))
    }
    .ok_or(HostPathsUnavailable::NoConfigRoot)?;
    let address = if cfg!(windows) {
        HostAddress::Endpoint(config.join("computer").join(ENDPOINT_FILE))
    } else {
        let runtime = crate::paths::resolve(lookup).map_err(|_| HostPathsUnavailable::NoConfigRoot)?;
        HostAddress::Socket(runtime.runtime.join(SOCKET_FILE))
    };
    Ok(HostPaths { config, address })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| (*value).to_owned())
    }

    #[test]
    fn a_real_backend_with_the_seam_set_computes_no_name() {
        let seam = [(RUNTIME_DIR_SEAM, "/tmp/omo-test"), ("HOME", "/home/u")];
        assert_eq!(resolve(env(&seam), false), Err(HostPathsUnavailable::SeamWithRealBackend));
    }

    #[test]
    fn under_the_seam_every_file_sits_in_the_runtime_dir() {
        let paths = resolve(env(&[(RUNTIME_DIR_SEAM, "/tmp/omo-test")]), true).expect("seam paths");
        assert_eq!(paths.consent(), Path::new("/tmp/omo-test/computer/consent.json"));
        assert_eq!(paths.host_latch(), Path::new("/tmp/omo-test/computer/host-latch"));
        // Review M2 of #13882: an abstract name has no file permissions, so every uid could call
        // the host API or squat it; every Unix host API is a socket file in an owner-only dir.
        if cfg!(unix) {
            assert_eq!(paths.address, HostAddress::Socket(PathBuf::from("/tmp/omo-test/host-api.sock")));
        }
    }

    /// Review M3 of #13882: the host (row 37) roots `computer/` at the user-database home, the
    /// engine read `$HOME`; with the two apart a set latch was written where the engine never
    /// looked, so it read as absent (fail OPEN). One rule for both: the user-database home.
    #[cfg(unix)]
    #[test]
    fn the_config_root_never_follows_home_from_the_environment() {
        let lookup = env(&[("HOME", "/not-the-user-database-home"), ("XDG_RUNTIME_DIR", "/run/user/501")]);
        let paths = resolve(lookup, false).expect("real paths");
        assert!(!paths.config.starts_with("/not-the-user-database-home"), "{:?}", paths.config);
        let tail = if cfg!(target_os = "macos") { "Library/Application Support/OmO" } else { ".config/omo" };
        assert!(paths.config.ends_with(tail), "{:?}", paths.config);
    }

    #[test]
    fn the_real_linux_host_api_is_a_socket_file_in_the_per_uid_runtime_root() {
        let paths = resolve(env(&[("HOME", "/home/u"), ("XDG_RUNTIME_DIR", "/run/user/501")]), false)
            .expect("real paths");
        if cfg!(target_os = "linux") {
            let runtime = crate::paths::resolve(|name| (name == "XDG_RUNTIME_DIR").then(|| "/run/user/501".to_owned()))
                .expect("the runtime root")
                .runtime;
            assert_eq!(paths.address, HostAddress::Socket(runtime.join("host-api.sock")));
            let home = crate::paths::user_home().expect("the user database names a home");
            assert_eq!(paths.consent(), home.join(".config/omo/computer/consent.json"));
        }
    }
}

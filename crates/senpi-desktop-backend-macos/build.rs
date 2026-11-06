//! Builds the persistent ScreenCaptureKit capture helper beside the Rust
//! target when Xcode CLT clang is present, and exports its path (or an empty
//! marker) as `SENPI_DESKTOP_CAPTURE_HELPER` for `include_bytes!`.
//!
//! The signed release build must instead stage a helper signed with the
//! engine's Developer ID identity (`ai.sisyphuslabs.senpi-desktop-engine`)
//! into the directory `SENPI_DESKTOP_CAPTURE_HELPER_SIGNED` names; that path
//! wins over a locally clang-built one, so a release never ships an ad-hoc
//! helper (B9/#9651). The engine stages the helper at a fresh temp path on
//! every start, so the helper holds no Screen Recording grant of its own: TCC
//! charges the responsible process (the app that launched OmO). A manual
//! signed-release QA step (not a CI gate) checks that a second launch does
//! not prompt.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const SOURCE: &str = "native/senpi-desktop-capture-helper.m";
const BINARY: &str = "senpi-desktop-capture-helper";
const ENV_SIGNED: &str = "SENPI_DESKTOP_CAPTURE_HELPER_SIGNED";
const ENV_OUT: &str = "SENPI_DESKTOP_CAPTURE_HELPER";

fn main() {
    println!("cargo:rerun-if-changed={SOURCE}");
    println!("cargo:rerun-if-env-changed={ENV_SIGNED}");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let binary = out_dir.join(BINARY);
    let helper = signed_helper().unwrap_or_else(|| build_helper(&out_dir, &binary));
    println!("cargo:rustc-env={ENV_OUT}={}", helper.display());
}

/// The release pipeline's pre-signed helper, when it staged one. A set
/// directory without the helper is a broken release, never a reason to ship
/// the ad-hoc dev helper instead.
fn signed_helper() -> Option<PathBuf> {
    let directory = env::var_os(ENV_SIGNED)?;
    let candidate = PathBuf::from(directory).join(BINARY);
    assert!(
        candidate.is_file(),
        "{ENV_SIGNED} is set but {} holds no signed capture helper",
        candidate.display()
    );
    println!("cargo:rerun-if-changed={}", candidate.display());
    Some(candidate)
}

/// Local/dev build: clang from Xcode CLT, ad-hoc signature. Missing clang is
/// not fatal — the crate falls back to `screencapture` (`helper bytes empty`).
fn build_helper(out_dir: &Path, binary: &Path) -> PathBuf {
    let source = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir")).join(SOURCE);
    let status = Command::new("/usr/bin/clang")
        .arg("-x")
        .arg("objective-c")
        .arg("-std=c11")
        .arg("-fobjc-arc")
        .arg("-O2")
        .arg("-Wall")
        .arg("-mmacosx-version-min=13.0")
        .arg("-framework")
        .arg("AppKit")
        .arg("-framework")
        .arg("ScreenCaptureKit")
        .arg("-framework")
        .arg("CoreVideo")
        .arg(&source)
        .arg("-o")
        .arg(binary)
        .status();
    match status {
        Ok(status) if status.success() => {
            adhoc_sign(binary);
            binary.to_path_buf()
        },
        outcome => {
            println!(
                "cargo:warning=capture helper clang build unavailable ({outcome:?}); the SCK worker is disabled and screencapture stays the capture path"
            );
            // An empty file makes `include_bytes!` yield `&[]`, which the
            // crate reads as "no helper staged".
            let absent = out_dir.join("senpi-desktop-capture-helper.absent");
            if let Err(error) = std::fs::write(&absent, b"") {
                println!("cargo:warning=cannot write the empty helper marker: {error}");
            }
            absent
        },
    }
}

/// An ad-hoc signature keeps the dev helper launchable; release replaces it
/// with the engine's Developer ID signature before staging.
fn adhoc_sign(binary: &Path) {
    let status = Command::new("/usr/bin/codesign")
        .arg("--force")
        .arg("--sign")
        .arg("-")
        .arg("--identifier")
        .arg("ai.sisyphuslabs.senpi-desktop-engine")
        .arg(binary)
        .status();
    if let Err(error) = status {
        println!("cargo:warning=capture helper ad-hoc signing failed: {error}");
    }
}

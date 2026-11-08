//! The `org.freedesktop.portal.Screenshot` client: a presence probe that
//! only reads the interface version, and a non-interactive, non-modal
//! `Screenshot` request whose file is decoded to RGBA and then removed.

use std::path::Path;
use std::time::Duration;

use ashpd::desktop::screenshot::Screenshot;
use image::{ImageReader, RgbaImage};
use tokio::runtime::Runtime;
use zbus::proxy::CacheProperties;

/// The prefix of every capture error for a missing portal; the contract.
pub const UNAVAILABLE: &str = "Screenshot portal unavailable";

const DESTINATION: &str = "org.freedesktop.portal.Desktop";
const PATH: &str = "/org/freedesktop/portal/desktop";
const INTERFACE: &str = "org.freedesktop.portal.Screenshot";
/// Bound on the presence probe behind `capturePermission`.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// Bound on a screenshot; covers a compositor's one-time consent dialog.
const SHOT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub enum ShotError {
    /// The request was answered with a refusal (`response` 1 or 2).
    Refused(String),
    Failed(String),
}

async fn version() -> zbus::Result<u32> {
    let connection = zbus::Connection::session().await?;
    let proxy: zbus::Proxy<'_> = zbus::proxy::Builder::new(&connection)
        .destination(DESTINATION)?
        .path(PATH)?
        .interface(INTERFACE)?
        .cache_properties(CacheProperties::No)
        .build()
        .await?;
    proxy.get_property("version").await
}

/// Whether the session bus serves the Screenshot portal. ashpd reads a
/// failed `version` lookup as version 1, so the property is read here and
/// any failure means the portal is absent.
///
/// # Errors
/// Why the portal is not served.
pub fn presence(runtime: &Runtime) -> Result<(), String> {
    runtime.block_on(async {
        match tokio::time::timeout(PROBE_TIMEOUT, version()).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => Err(format!("no answer within {} s", PROBE_TIMEOUT.as_secs())),
        }
    })
}

/// Takes one screenshot of the whole desktop.
///
/// # Errors
/// [`ShotError::Refused`] when the portal answers with a refusal, else
/// [`ShotError::Failed`] naming the failed step.
pub fn take(runtime: &Runtime) -> Result<RgbaImage, ShotError> {
    let uri = runtime.block_on(async {
        let request = async {
            Screenshot::request()
                .interactive(false)
                .modal(false)
                .send()
                .await?
                .response()
        };
        match tokio::time::timeout(SHOT_TIMEOUT, request).await {
            Ok(Ok(shot)) => Ok(shot.uri().clone()),
            Ok(Err(ashpd::Error::Response(error))) => Err(ShotError::Refused(format!(
                "Screenshot portal permission: {error}"
            ))),
            Ok(Err(error)) => Err(ShotError::Failed(format!("Screenshot portal: {error}"))),
            Err(_) => Err(ShotError::Failed(format!(
                "Screenshot portal did not answer within {} s",
                SHOT_TIMEOUT.as_secs()
            ))),
        }
    })?;
    let path = uri
        .to_file_path()
        .map_err(|()| ShotError::Failed(format!("Screenshot portal returned a non-file URI {uri}")))?;
    let image = decode(&path);
    // The file exists only for this capture; leaving it would pile full
    // screen contents up in /tmp or ~/Pictures.
    if let Err(error) = std::fs::remove_file(&path) {
        eprintln!(
            "senpi-desktop-backend-wayland: removing screenshot {}: {error}",
            path.display()
        );
    }
    image
}

fn decode(path: &Path) -> Result<RgbaImage, ShotError> {
    let failed = |error: &dyn std::fmt::Display| {
        ShotError::Failed(format!("Screenshot portal file {}: {error}", path.display()))
    };
    let image = ImageReader::open(path)
        .and_then(ImageReader::with_guessed_format)
        .map_err(|error| failed(&error))?
        .decode()
        .map_err(|error| failed(&error))?;
    Ok(image.into_rgba8())
}

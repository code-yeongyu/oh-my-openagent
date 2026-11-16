//! The capture route ladder. The persistent ScreenCaptureKit helper is the default route; the
//! SkyLight window capture runs only when its symbol resolved AND the session opted in (until
//! row 78's receipt makes it the default), and falls back to the helper on an error or a fully
//! transparent frame.

use image::RgbaImage;
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::exclusion::{self, UNTRUSTED};
use super::helper::{FilterKind, HelperRequest, ShotTarget};
use super::pixels::{decode_png, fully_transparent, from_raw};
use super::seam::CaptureOs;
use super::types::CaptureFault;

/// Which route produced the last model frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureRouteTaken {
    Helper,
    SkyLight,
}

/// The refusal a capture fault reads as.
#[must_use]
pub const fn refusal(fault: CaptureFault) -> Refusal {
    match fault {
        CaptureFault::NullFrame => Refusal::new(EngineCode::CaptureFailed, Reason::NullFrame),
        CaptureFault::Timeout => Refusal::new(EngineCode::CaptureFailed, Reason::Timeout),
        CaptureFault::Denied => Refusal::bare(EngineCode::PermissionDenied),
        CaptureFault::HelperGone => Refusal::bare(EngineCode::CaptureFailed),
        CaptureFault::Protocol => UNTRUSTED,
    }
}

/// One window's own pixels.
///
/// # Errors
/// The helper's refusal when no route yields a trusted frame.
pub fn window_still(
    os: &mut dyn CaptureOs,
    id: u64,
    number: u32,
    cursor: bool,
    skylight_opt_in: bool,
) -> Result<(RgbaImage, CaptureRouteTaken), Refusal> {
    if skylight_opt_in {
        let frame = os
            .skylight()
            .and_then(|route| route.capture_window(number, cursor).ok())
            .and_then(from_raw)
            .filter(|image| !fully_transparent(image));
        if let Some(image) = frame {
            return Ok((image, CaptureRouteTaken::SkyLight));
        }
    }
    let target = ShotTarget::Window { window: number };
    let image = helper_still(os, id, target, cursor, &[], FilterKind::Window)?;
    Ok((image, CaptureRouteTaken::Helper))
}

/// One display with `exclude` removed.
///
/// # Errors
/// The helper's refusal, or [`UNTRUSTED`] when the exclusions are not proven.
pub fn display_still(
    os: &mut dyn CaptureOs,
    id: u64,
    display: u32,
    cursor: bool,
    exclude: &[u32],
) -> Result<RgbaImage, Refusal> {
    let target = ShotTarget::Display { display };
    helper_still(os, id, target, cursor, exclude, FilterKind::Display)
}

fn helper_still(
    os: &mut dyn CaptureOs,
    id: u64,
    target: ShotTarget,
    cursor: bool,
    exclude: &[u32],
    expected: FilterKind,
) -> Result<RgbaImage, Refusal> {
    let request = HelperRequest::Screenshot { id, target, cursor, exclude: exclude.to_vec() };
    let frame = os.helper().and_then(|helper| helper.call(&request)).map_err(refusal)?;
    exclusion::prove(&frame.reply, expected, exclude)?;
    let image = decode_png(&frame.png).map_err(refusal)?;
    if image.width() == 0 || fully_transparent(&image) {
        return Err(Refusal::new(EngineCode::CaptureFailed, Reason::BlackFrame));
    }
    Ok(image)
}

//! The region-covering preflight (d-linux.md 'Preflight admission'): libei's absolute-pointer
//! regions are the only source of logical geometry. Until they are announced the frame is
//! `pixels_only` and coordinate input is refused; a point no region covers is refused
//! `no_region`; either way before anything is sent.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

/// One region of the absolute pointer, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    fn covers(self, point: Point) -> bool {
        let (left, top) = (f64::from(self.x), f64::from(self.y));
        point.x >= left
            && point.y >= top
            && point.x < left + f64::from(self.width)
            && point.y < top + f64::from(self.height)
    }
}

/// Admits `points` against `regions`.
///
/// # Errors
/// `InvalidCoordinateFrame{pixels_only}` with no region at all; `InputFailed{no_region}` when
/// a point lies outside every region.
pub fn preflight(regions: &[Region], points: &[Point]) -> Result<(), Refusal> {
    if regions.is_empty() {
        return Err(Refusal::new(
            EngineCode::InvalidCoordinateFrame,
            Reason::PixelsOnly,
        ));
    }
    match points
        .iter()
        .find(|point| !regions.iter().any(|region| region.covers(**point)))
    {
        Some(_) => Err(Refusal::new(EngineCode::InputFailed, Reason::NoRegion)),
        None => Ok(()),
    }
}

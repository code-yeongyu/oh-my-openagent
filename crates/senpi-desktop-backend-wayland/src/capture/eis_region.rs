//! One libei absolute-pointer region, kept free of other crate dependencies so
//! the standalone QA fake EIS (`script/qa/desktop/linux/fake-eis`) can mount it.

/// One libei device region, in the compositor's logical coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EisRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    /// Physical pixels per logical pixel; `<= 0` or non-finite when unset.
    pub scale: f32,
}

impl EisRegion {
    pub(crate) fn right(&self) -> u64 {
        u64::from(self.x) + u64::from(self.width)
    }

    pub(crate) fn bottom(&self) -> u64 {
        u64::from(self.y) + u64::from(self.height)
    }

    pub(crate) fn overlaps(&self, other: &Self) -> bool {
        u64::from(self.x) < other.right()
            && u64::from(other.x) < self.right()
            && u64::from(self.y) < other.bottom()
            && u64::from(other.y) < self.bottom()
    }

    pub(crate) fn reported_scale(&self) -> Option<f64> {
        let scale = f64::from(self.scale);
        (scale.is_finite() && scale > 0.0).then_some(scale)
    }
}

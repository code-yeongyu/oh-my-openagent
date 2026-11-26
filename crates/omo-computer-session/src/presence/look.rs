//! The agent cursor's one look (IS row 52, ADP-61): an arrow with a soft round halo, a colour per
//! session and a badge in the report stream's action vocabulary, described once in
//! `cursor-look.json` so every overlay renderer draws the same mark at the display's backing scale.
//! The arrow's ink and the halo take the session's colour; the halo is drawn at `halo.opacity`.

use std::sync::OnceLock;

use serde::Deserialize;

pub(super) const LOOK_JSON: &str = include_str!("cursor-look.json");

/// The report stream's action vocabulary, the words the badge uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Idle,
    Navigate,
    Click,
    Drag,
    Scroll,
    Text,
    Key,
}

#[cfg(test)]
impl Action {
    pub const ALL: [Self; 7] =
        [Self::Idle, Self::Navigate, Self::Click, Self::Drag, Self::Scroll, Self::Text, Self::Key];
}

/// The arrow as one vector path; the view box is in points and the hotspot is the point that
/// lands on the target.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Arrow {
    pub view_box: [f64; 4],
    pub hotspot: [f64; 2],
    pub path: String,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Halo {
    pub radius_pt: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CursorLook {
    pub v: u32,
    pub arrow: Arrow,
    pub halo: Halo,
    /// The pointer's footprint in points: a hop shorter than this is placed without a glide.
    pub footprint_pt: f64,
    /// The session colours as sRGB hex, by the session's place.
    pub session_colours: [String; 4],
    pub badges: Vec<Action>,
    /// The mark's opacity once the session has been idle for `idle_after_ms`: 0.35 after 700 ms,
    /// the app's agent cursor dim (omo-desktop-app `apps/web/DESIGN.md` §6 "Agent cursor", Dim).
    pub idle_opacity: f64,
    pub idle_after_ms: f64,
}

impl CursorLook {
    /// The shipped look, parsed once.
    ///
    /// # Panics
    /// Never for the compiled-in file: `packaged_cursor_look_is_byte_equal_to_the_crate_description` parses it.
    #[must_use]
    #[expect(clippy::expect_used, reason = "the look is compiled in and its tests parse it")]
    pub fn shipped() -> &'static Self {
        static LOOK: OnceLock<CursorLook> = OnceLock::new();
        LOOK.get_or_init(|| serde_json::from_str(LOOK_JSON).expect("the shipped cursor-look.json parses"))
    }
}

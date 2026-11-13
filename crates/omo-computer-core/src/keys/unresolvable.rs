//! The layout-unresolvable grapheme rule of acceptance 81, as ONE per-target text-route capability.
//!
//! - `Unicode`: every macOS target and an ordinary Windows window. Typed through the
//!   layout-independent route and never refused.
//! - `Remap`: X11 with the opt-in `computer.x11_keymap_remap`. Typed through a scratch keycode;
//!   the core never refuses here, only the backend does, when no keycode is free or the server
//!   refuses the remap.
//! - `None`: X11 by default, Wayland, and a Windows remote-screen window. The first grapheme the
//!   layout cannot produce is refused before any key is sent.
//!
//! The one refusal shape is `InvalidKey{reason:"unresolvable", group, grapheme}`, with
//! `nothingSent:true` and `nextCall:"paste"`. The routes themselves are built by rows 42, 49,
//! 51 and 56. Here a grapheme is one Unicode scalar value; the scalars of a cluster are checked
//! one by one, so a cluster with any unresolvable scalar is refused at that scalar.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::backend::Refusal;
use crate::error::{EngineCode, Reason};

/// How a target types text the keyboard layout cannot produce (acceptance 81).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TextRoute {
    Unicode,
    Remap,
    None,
}

/// The first grapheme the target's layout cannot produce, and the layout group it was looked up in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unresolvable {
    pub group: u32,
    pub grapheme: String,
}

/// The first unresolvable grapheme of `text` under `route`, or `None` when the core lets the
/// text through. `resolvable(group, grapheme)` answers whether the layout produces it.
#[must_use]
pub fn first_unresolvable(
    route: TextRoute,
    text: &str,
    group: u32,
    resolvable: impl Fn(u32, &str) -> bool,
) -> Option<Unresolvable> {
    if route != TextRoute::None {
        return None;
    }
    text.chars().map(String::from).find(|grapheme| !resolvable(group, grapheme)).map(|grapheme| Unresolvable { group, grapheme })
}

impl Unresolvable {
    /// `InvalidKey{reason:"unresolvable"}`; its `group` and `grapheme` go in [`Self::detail`].
    #[must_use]
    pub fn refusal(&self) -> Refusal {
        Refusal::new(EngineCode::InvalidKey, Reason::Unresolvable.wire())
    }

    /// The refusal's members beside its code: `group` and `grapheme`.
    #[must_use]
    pub fn detail(&self) -> serde_json::Value {
        json!({ "group": self.group, "grapheme": self.grapheme })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_level_us_map(_group: u32, grapheme: &str) -> bool {
        grapheme.chars().all(|c| c.is_ascii_graphic() || c == ' ')
    }

    const TEXT: &str = "\u{d55c}\u{ae00}\u{1f600}x";

    #[test]
    fn text_route_none_refuses_unresolvable_before_any_key() {
        let first = first_unresolvable(TextRoute::None, TEXT, 0, two_level_us_map).expect("refused");
        assert_eq!(first, Unresolvable { group: 0, grapheme: "\u{d55c}".to_owned() }, "the FIRST unresolvable grapheme");
        assert_eq!((first.refusal().code, first.refusal().reason), (EngineCode::InvalidKey, Some("unresolvable")));
        assert_eq!(first.detail(), json!({ "group": 0, "grapheme": "\u{d55c}" }));
        assert_eq!(first_unresolvable(TextRoute::None, "plain text", 0, two_level_us_map), None, "a resolvable text is not refused");
    }

    #[test]
    fn text_route_unicode_and_remap_are_not_refused_by_the_core() {
        assert_eq!(first_unresolvable(TextRoute::Unicode, TEXT, 0, two_level_us_map), None);
        assert_eq!(first_unresolvable(TextRoute::Remap, TEXT, 0, two_level_us_map), None);
    }
}

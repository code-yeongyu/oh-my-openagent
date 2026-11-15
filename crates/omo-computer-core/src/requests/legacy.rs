//! Readers of the v1 exec params the corpus replays, and of `openSystemSurface`.

use super::options::At;
use crate::listing::SurfaceKind;
use crate::params::{
    AxPerformParams, AxTypeTextParams, HoldKeysParams, HoldMouseParams, KeyChordParams,
    OpenSystemSurfaceParams, RaiseWindowParams, TypeTextParams,
};

/// A v1 exec call and `openSystemSurface`, as the v1 null-mode stages consume them.
#[derive(Debug, Clone, PartialEq)]
pub enum V1Request {
    TypeText {
        target: String,
        text: String,
    },
    KeyChord {
        target: String,
        keys: Vec<String>,
    },
    HoldKeys {
        target: String,
        keys: Vec<String>,
        duration_ms: u64,
    },
    HoldMouse {
        target: String,
        at: At,
        duration_ms: u64,
    },
    RaiseWindow {
        window: String,
    },
    AxPerform {
        reference: String,
        action: String,
    },
    AxTypeText {
        reference: String,
        text: String,
    },
    OpenSystemSurface {
        kind: SurfaceKind,
    },
}

#[must_use]
pub fn read_type_text(params: TypeTextParams) -> V1Request {
    let TypeTextParams { target, text } = params;
    V1Request::TypeText { target, text }
}

#[must_use]
pub fn read_key_chord(params: KeyChordParams) -> V1Request {
    let KeyChordParams { target, keys } = params;
    V1Request::KeyChord { target, keys }
}

#[must_use]
pub fn read_hold_keys(params: HoldKeysParams) -> V1Request {
    let HoldKeysParams {
        target,
        keys,
        duration,
    } = params;
    V1Request::HoldKeys {
        target,
        keys,
        duration_ms: duration,
    }
}

#[must_use]
pub fn read_hold_mouse(params: HoldMouseParams) -> V1Request {
    let HoldMouseParams {
        target,
        x,
        y,
        duration,
    } = params;
    V1Request::HoldMouse {
        target,
        at: At { x, y },
        duration_ms: duration,
    }
}

#[must_use]
pub fn read_raise_window(params: RaiseWindowParams) -> V1Request {
    let RaiseWindowParams { window_id } = params;
    V1Request::RaiseWindow { window: window_id }
}

#[must_use]
pub fn read_ax_perform(params: AxPerformParams) -> V1Request {
    let AxPerformParams { reference, action } = params;
    V1Request::AxPerform { reference, action }
}

#[must_use]
pub fn read_ax_type_text(params: AxTypeTextParams) -> V1Request {
    let AxTypeTextParams { reference, text } = params;
    V1Request::AxTypeText { reference, text }
}

#[must_use]
pub fn read_open_system_surface(params: OpenSystemSurfaceParams) -> V1Request {
    let OpenSystemSurfaceParams { kind } = params;
    V1Request::OpenSystemSurface { kind }
}

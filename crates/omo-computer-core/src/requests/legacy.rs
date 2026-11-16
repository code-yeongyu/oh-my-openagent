//! Readers of the v1 exec params the corpus replays, and of `openSystemSurface`. They are
//! exec verbs like the v3 ones: each reaches the `mutate()` funnel as an `ExecRequest`
//! carrying the call-bound authority and `observeAfter`.

use super::exec::{aimed, request, Common, ExecRequest, Verb};
use super::options::At;
use crate::listing::SurfaceKind;
use crate::params::{
    AxFocusParams, AxPerformParams, AxTypeTextParams, HoldKeysParams, HoldMouseParams,
    KeyChordParams, OpenSystemSurfaceParams, RaiseWindowParams, TypeTextParams,
};

/// What a v1 exec verb and `openSystemSurface` do, as the v1 null-mode stages consume them.
/// The target or ref the verb aims at is the request's own.
#[derive(Debug, Clone, PartialEq)]
pub enum V1Verb {
    TypeText { text: String },
    KeyChord { keys: Vec<String> },
    HoldKeys { keys: Vec<String>, duration_ms: u64 },
    HoldMouse { at: At, duration_ms: u64 },
    RaiseWindow { window: String },
    AxPerform { action: String },
    AxFocus,
    AxTypeText { text: String },
    OpenSystemSurface { kind: SurfaceKind },
}

fn by_ref(reference: String) -> Common {
    Common {
        reference: Some(reference),
        ..aimed(None)
    }
}

#[must_use]
pub fn read_type_text(params: TypeTextParams) -> ExecRequest {
    let TypeTextParams {
        target,
        text,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::TypeText { text }),
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_key_chord(params: KeyChordParams) -> ExecRequest {
    let KeyChordParams {
        target,
        keys,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::KeyChord { keys }),
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_hold_keys(params: HoldKeysParams) -> ExecRequest {
    let HoldKeysParams {
        target,
        keys,
        duration,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::HoldKeys {
            keys,
            duration_ms: duration,
        }),
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_hold_mouse(params: HoldMouseParams) -> ExecRequest {
    let HoldMouseParams {
        target,
        x,
        y,
        duration,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::HoldMouse {
            at: At { x, y },
            duration_ms: duration,
        }),
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_raise_window(params: RaiseWindowParams) -> ExecRequest {
    let RaiseWindowParams {
        window_id,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::RaiseWindow { window: window_id }),
        aimed(None),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_ax_perform(params: AxPerformParams) -> ExecRequest {
    let AxPerformParams {
        reference,
        action,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::AxPerform { action }),
        by_ref(reference),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_ax_focus(params: AxFocusParams) -> ExecRequest {
    let AxFocusParams {
        reference,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::AxFocus),
        by_ref(reference),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_ax_type_text(params: AxTypeTextParams) -> ExecRequest {
    let AxTypeTextParams {
        reference,
        text,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::AxTypeText { text }),
        by_ref(reference),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_open_system_surface(params: OpenSystemSurfaceParams) -> ExecRequest {
    let OpenSystemSurfaceParams {
        kind,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::V1(V1Verb::OpenSystemSurface { kind }),
        aimed(None),
        call_id,
        run_generation,
        observe_after,
    )
}

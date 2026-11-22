//! Readers of the key, text and clipboard verbs.

use super::{aimed, request, Common, ExecRequest, SendPolicy, Verb};
use crate::params::{
    ClipboardWriteParams, KeyDownParams, KeyUpParams, PasteParams, PressParams, TypeParams,
};

#[must_use]
pub fn read_key_down(params: KeyDownParams) -> ExecRequest {
    let KeyDownParams {
        target,
        chord,
        frame_id,
        force,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let policy = SendPolicy {
        delivery: None,
        force: force.unwrap_or(false),
    };
    let common = Common {
        target: Some(target),
        reference: None,
        frame_id,
        policy,
    };
    request(
        Verb::KeyDown { chord },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_key_up(params: KeyUpParams) -> ExecRequest {
    let KeyUpParams {
        target,
        chord,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::KeyUp { chord },
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_type(params: TypeParams) -> ExecRequest {
    let TypeParams {
        text,
        target,
        reference,
        delivery,
        force,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let policy = SendPolicy {
        delivery,
        force: force.unwrap_or(false),
    };
    request(
        Verb::Type { text },
        Common {
            target,
            reference,
            frame_id: None,
            policy,
        },
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_press(params: PressParams) -> ExecRequest {
    let PressParams {
        chord,
        target,
        reference,
        repeat,
        force,
        delivery,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let policy = SendPolicy {
        delivery,
        force: force.unwrap_or(false),
    };
    let common = Common {
        target,
        reference,
        frame_id: None,
        policy,
    };
    request(
        Verb::Press { chord, repeat },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_paste(params: PasteParams) -> ExecRequest {
    let PasteParams {
        target,
        text,
        format,
        force,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let policy = SendPolicy {
        delivery: None,
        force: force.unwrap_or(false),
    };
    let common = Common {
        target: Some(target),
        reference: None,
        frame_id: None,
        policy,
    };
    request(
        Verb::Paste { text, format },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_clipboard_write(params: ClipboardWriteParams) -> ExecRequest {
    let ClipboardWriteParams {
        text,
        format,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::ClipboardWrite { text, format },
        aimed(None),
        call_id,
        run_generation,
        observe_after,
    )
}

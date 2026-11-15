//! Readers of the element, menu, app and window verbs.

use super::{aimed, request, Common, ExecRequest, SendPolicy, Verb, WindowVerb};
use crate::params::{
    AppsOpenParams, AppsQuitParams, AxSetValueParams, MenuSelectParams, SelectTextParams,
    WindowFrameParams, WindowParams,
};
use crate::requests::options::{read_observe_request, read_text_range};

#[must_use]
pub fn read_set_value(params: AxSetValueParams) -> ExecRequest {
    let AxSetValueParams {
        reference,
        value,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        reference: Some(reference),
        ..aimed(None)
    };
    request(
        Verb::SetValue { value },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_select_text(params: SelectTextParams) -> ExecRequest {
    let SelectTextParams {
        reference,
        range,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        reference: Some(reference),
        ..aimed(None)
    };
    request(
        Verb::SelectText {
            span: read_text_range(range),
        },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_menu_select(params: MenuSelectParams) -> ExecRequest {
    let MenuSelectParams {
        target,
        path,
        delivery,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        policy: SendPolicy {
            delivery,
            force: false,
        },
        ..aimed(Some(target))
    };
    request(
        Verb::MenuSelect { path },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_apps_open(params: AppsOpenParams) -> ExecRequest {
    let AppsOpenParams {
        target,
        activate,
        reveal,
        observe,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let verb = Verb::AppsOpen {
        activate,
        reveal,
        observe: observe.and_then(read_observe_request),
    };
    request(
        verb,
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_apps_quit(params: AppsQuitParams) -> ExecRequest {
    let AppsQuitParams {
        target,
        force,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        policy: SendPolicy {
            delivery: None,
            force: force.unwrap_or(false),
        },
        ..aimed(Some(target))
    };
    request(
        Verb::AppsQuit,
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_window(params: WindowParams, verb: WindowVerb) -> ExecRequest {
    let WindowParams {
        target,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::Window(verb),
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_window_frame(params: WindowFrameParams) -> ExecRequest {
    let WindowFrameParams {
        target,
        x,
        y,
        width,
        height,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::SetFrame {
            x,
            y,
            width,
            height,
        },
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

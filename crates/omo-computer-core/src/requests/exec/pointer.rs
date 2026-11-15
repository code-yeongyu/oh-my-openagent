//! Readers of the pointer verbs.

use super::{aimed, at, request, Common, ExecRequest, SendPolicy, Verb};
use crate::params::{
    ClickParams, DragParams, MouseDownParams, MouseUpParams, MoveParams, ScrollParams,
};
use crate::requests::options::{read_point, At};

#[must_use]
pub fn read_click(params: ClickParams) -> ExecRequest {
    let ClickParams {
        target,
        x,
        y,
        reference,
        frame_id,
        button,
        count,
        modifiers,
        delivery,
        consume,
        force,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let verb = Verb::Click {
        at: at(x, y),
        button,
        count,
        modifiers: modifiers.unwrap_or_default(),
        consume: consume.unwrap_or(false),
    };
    let policy = SendPolicy {
        delivery,
        force: force.unwrap_or(false),
    };
    request(
        verb,
        Common {
            target,
            reference,
            frame_id,
            policy,
        },
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_move(params: MoveParams) -> ExecRequest {
    let MoveParams {
        target,
        x,
        y,
        frame_id,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        frame_id,
        ..aimed(Some(target))
    };
    request(
        Verb::Move { at: At { x, y } },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_mouse_down(params: MouseDownParams) -> ExecRequest {
    let MouseDownParams {
        target,
        button,
        x,
        y,
        frame_id,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let common = Common {
        frame_id,
        ..aimed(Some(target))
    };
    request(
        Verb::MouseDown {
            button,
            at: at(x, y),
        },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_mouse_up(params: MouseUpParams) -> ExecRequest {
    let MouseUpParams {
        target,
        button,
        call_id,
        run_generation,
        observe_after,
    } = params;
    request(
        Verb::MouseUp { button },
        aimed(Some(target)),
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_drag(params: DragParams) -> ExecRequest {
    let DragParams {
        target,
        from,
        to,
        button,
        modifiers,
        frame_id,
        path,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let path = path
        .unwrap_or_default()
        .into_iter()
        .map(read_point)
        .collect();
    let verb = Verb::Drag {
        from: read_point(from),
        to: read_point(to),
        button,
        modifiers: modifiers.unwrap_or_default(),
        path,
    };
    request(
        verb,
        Common {
            frame_id,
            ..aimed(Some(target))
        },
        call_id,
        run_generation,
        observe_after,
    )
}

#[must_use]
pub fn read_scroll(params: ScrollParams) -> ExecRequest {
    let ScrollParams {
        target,
        x,
        y,
        dx,
        dy,
        clicks,
        direction,
        delivery,
        call_id,
        run_generation,
        observe_after,
    } = params;
    let policy = SendPolicy {
        delivery,
        force: false,
    };
    let common = Common {
        target: Some(target),
        reference: None,
        frame_id: None,
        policy,
    };
    request(
        Verb::Scroll {
            at: At { x, y },
            dx,
            dy,
            clicks,
            direction,
        },
        common,
        call_id,
        run_generation,
        observe_after,
    )
}

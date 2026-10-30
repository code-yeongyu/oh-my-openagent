//! Running a press that may open a menu, then settling the menu whatever the
//! press returned, and the errors that report what became of it.

use super::{stops_the_call, MenuWindow, Press, Settled};
use crate::error::{CoreResult, DesktopError, ErrorCode};
use crate::protocol_results::MenuReport;

/// What to do with the menu a press opens: choose a path in it, or (D1)
/// read its items and close it at once, so no background menu is left open
/// to take the user's keyboard.
#[derive(Clone, Copy, Debug)]
pub enum Watch<'a> {
    Choose(&'a [String]),
    ListAndClose,
}

/// Runs `press` on `backend`, then, when `before` lists the target's menu
/// windows from before it, `settle`s a menu the press opened: it chooses
/// `path` there, or closes the menu with nothing chosen. Settling runs
/// whatever the press returned, cancellation included, because an open menu
/// takes the keyboard from the user's app until it closes; a press that failed
/// only has its menu closed. A press whose menu was closed unchosen reports
/// `InputFailed`: it was delivered and may have taken effect, and rerunning it
/// in the foreground would not help, since handing focus back closes the menu
/// again.
///
/// # Errors
/// The press's own error; `InputFailed` for a menu closed unchosen, left
/// open, or expected but not opened; or a settling error that stops the call.
pub fn guard<B>(
    backend: &mut B,
    press: Press<'_>,
    before: Option<&[MenuWindow]>,
    watch: Watch<'_>,
    run: impl FnOnce(&mut B) -> CoreResult<()>,
    settle: impl FnOnce(&mut B, &[MenuWindow], Option<&[String]>) -> CoreResult<Settled>,
) -> CoreResult<Option<MenuReport>> {
    let delivered = run(backend);
    let Some(before) = before else {
        return delivered.map(|()| None);
    };
    // A refusal before anything went out opened no menu.
    if matches!(&delivered, Err(error) if error.code == ErrorCode::BackgroundUnavailable) {
        return delivered.map(|()| None);
    }
    let path = match (&delivered, watch) {
        (Ok(()), Watch::Choose(path)) => Some(path),
        _ => None,
    };
    let settled = settle(backend, before, path);
    match (delivered, settled) {
        (
            _,
            Ok(Settled::Unchosen {
                closed: false,
                items,
                ..
            }),
        ) => Err(DesktopError::input_failed(left_open_message(press, &items))),
        (
            Ok(()),
            Ok(Settled::Unchosen {
                refusal: None,
                items,
                ..
            }),
        ) if matches!(watch, Watch::ListAndClose) => Ok(Some(MenuReport { items })),
        (Ok(()), Ok(Settled::Unchosen { refusal, items, .. })) => Err(DesktopError::input_failed(
            unchosen_message(press, refusal.as_deref(), &items),
        )),
        (Ok(()), Ok(Settled::NoMenu)) if matches!(watch, Watch::Choose(_)) => {
            Err(DesktopError::input_failed(no_menu_message(press)))
        }
        (delivered, Ok(_)) => delivered.map(|()| None),
        // Settling stopped before pressing an item because the call was
        // cancelled, or the user came to or used the app; the menu was closed.
        (_, Err(error)) if stops_the_call(&error) => Err(error),
        // A press that failed is reported over the cleanup's own failure.
        (Err(failed), Err(_)) => Err(failed),
        (Ok(()), Err(error)) => Err(error),
    }
}

fn opened(press: Press<'_>) -> String {
    match press {
        Press::Pointer { kind, id, app } => {
            format!("the {kind} reached window {id} ({app}) and opened a menu")
        }
        Press::Action(action) => format!("{action} opened a menu"),
    }
}

fn aftermath(press: Press<'_>) -> String {
    match press {
        Press::Pointer { kind, .. } => {
            format!(
                "; the {kind} may already have taken effect, so inspect the window before retrying"
            )
        }
        Press::Action(_) => String::new(),
    }
}

fn listed(items: &str) -> String {
    if items.is_empty() {
        String::new()
    } else {
        format!(" Items: {items}.")
    }
}

fn unchosen_message(press: Press<'_>, refusal: Option<&str>, items: &str) -> String {
    let (opened, aftermath, listed) = (opened(press), aftermath(press), listed(items));
    match refusal {
        None => format!(
            "{opened}, which takes the keyboard from the user's app, so it was closed with nothing \
             chosen{aftermath}. To choose an item in the background, pass its path as the menu option, \
             e.g. menu: [\"<item>\", \"<subitem>\"].{listed}"
        ),
        Some(refusal) => format!("{opened}, but {refusal}, so nothing was chosen and the menu was closed{aftermath}.{listed}"),
    }
}

fn left_open_message(press: Press<'_>, items: &str) -> String {
    format!(
        "{} that is still open after Escape, which keeps the keyboard from the user's app; inspect the \
         desktop before retrying.{}",
        opened(press),
        listed(items)
    )
}

fn no_menu_message(press: Press<'_>) -> String {
    match press {
        Press::Pointer { kind, id, app } => {
            format!("the {kind} reached window {id} ({app}) but opened no menu, so nothing was chosen{}", aftermath(press))
        }
        Press::Action(action) => {
            format!("{action} opened no menu, so nothing was chosen; the action may already have taken effect")
        }
    }
}

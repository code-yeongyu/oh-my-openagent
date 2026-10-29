//! The held-key transaction, independent of the native posting transport.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::with_held;
use senpi_desktop_core::keys::KeyName;

use super::keys;

pub(super) fn keys_held<S>(
    state: &mut S,
    held_keys: &[KeyName],
    check_stop: &dyn Fn() -> CoreResult<()>,
    recheck: impl Fn() -> CoreResult<()>,
    mut post: impl FnMut(&mut S, u16, bool, Modifiers) -> CoreResult<()>,
    operation: impl FnOnce(&mut S) -> CoreResult<()>,
) -> CoreResult<()> {
    let codes = held_keys
        .iter()
        .map(|&key| keys::key_code(key).map(|code| (key, code)))
        .collect::<CoreResult<Vec<_>>>()?;
    let check = || {
        check_stop()?;
        recheck()
    };
    with_held(
        &mut (state, Modifiers::default()),
        &codes,
        &check,
        |(state, modifiers), (key, code), down| {
            keys::update_modifier(modifiers, key, down);
            post(state, code, down, *modifiers)
        },
        |(state, _)| operation(state),
    )
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use senpi_desktop_core::error::{DesktopError, ErrorCode};

    use super::*;

    #[test]
    fn keys_held_stops_on_a_failed_recheck_and_releases_only_prior_presses() {
        for failed_check in [1, 2] {
            let rechecks = Cell::new(0);
            let operations = Cell::new(0);
            let mut posts = Vec::new();
            let result = keys_held(
                &mut posts,
                &[KeyName::Shift, KeyName::Meta, KeyName::Char('a')],
                &|| Ok(()),
                || {
                    rechecks.set(rechecks.get() + 1);
                    if rechecks.get() == failed_check {
                        Err(DesktopError::input_failed("the key receiver changed"))
                    } else {
                        Ok(())
                    }
                },
                |posts, code, down, _| {
                    posts.push((code, down));
                    Ok(())
                },
                |_| {
                    operations.set(operations.get() + 1);
                    Ok(())
                },
            );
            assert_eq!(result.unwrap_err().code, ErrorCode::InputFailed);
            assert_eq!(rechecks.get(), failed_check);
            assert_eq!(operations.get(), 0);
            let shift = keys::key_code(KeyName::Shift).unwrap();
            let expected = if failed_check == 1 {
                Vec::new()
            } else {
                vec![(shift, true), (shift, false)]
            };
            assert_eq!(posts, expected);
        }
    }
}

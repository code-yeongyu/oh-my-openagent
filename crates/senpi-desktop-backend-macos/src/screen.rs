//! Lock-screen and display-sleep state for failure notes and
//! `capabilities.displayAsleep`, ported from oh-my-pi
//! `crates/pi-natives/src/desktop/macos/session.rs`.

use objc2_core_graphics::{CGDirectDisplayID, CGDisplayIsAsleep, CGGetOnlineDisplayList};
use senpi_desktop_core::backend::ScreenProbe;
use senpi_desktop_core::types::{DisplaySelector, ScreenState};

const MAX_ONLINE_DISPLAYS: u32 = 32;

/// Reads the state of the displays the session was opened on.
pub(crate) struct MacScreen {
    display: DisplaySelector,
}

impl MacScreen {
    pub(crate) const fn new(display: DisplaySelector) -> Self {
        Self { display }
    }
}

impl ScreenProbe for MacScreen {
    fn screen_state(&self, display: Option<&DisplaySelector>) -> ScreenState {
        let selector = display.unwrap_or(&self.display);
        ScreenState {
            locked: crate::cursor::screen_locked().is_ok_and(|locked| locked),
            display_asleep: displays_asleep(selector, &online_displays(), |id| {
                CGDisplayIsAsleep(id)
            }),
        }
    }
}

/// The selected display for a display id, otherwise every online display,
/// since `active` and `all` can capture any of them; an empty list is awake.
fn displays_asleep(
    selector: &DisplaySelector,
    online: &[CGDirectDisplayID],
    asleep: impl Fn(CGDirectDisplayID) -> bool,
) -> bool {
    if let DisplaySelector::Id(id) = selector {
        if let Some(id) = id
            .trim()
            .parse::<CGDirectDisplayID>()
            .ok()
            .filter(|id| online.contains(id))
        {
            return asleep(id);
        }
    }
    !online.is_empty() && online.iter().all(|&id| asleep(id))
}

fn online_displays() -> Vec<CGDirectDisplayID> {
    let mut ids = [0; MAX_ONLINE_DISPLAYS as usize];
    let mut count = 0;
    // SAFETY: `ids` holds `MAX_ONLINE_DISPLAYS` writable entries and `count`
    // is a valid out-pointer for the synchronous call.
    let error =
        unsafe { CGGetOnlineDisplayList(MAX_ONLINE_DISPLAYS, ids.as_mut_ptr(), &raw mut count) };
    if error.0 != 0 {
        return Vec::new();
    }
    ids[..usize::try_from(count).unwrap_or(0).min(ids.len())].to_vec()
}

#[cfg(test)]
mod tests {
    use super::{displays_asleep, DisplaySelector};

    #[test]
    fn display_sleep_follows_the_sessions_displays_not_the_main_one() {
        // Display 1 is main and awake; secondary 2 sleeps.
        let asleep = |id| id == 2;
        let online = [1, 2];
        assert!(displays_asleep(
            &DisplaySelector::Id("2".into()),
            &online,
            asleep
        ));
        assert!(!displays_asleep(
            &DisplaySelector::Id("1".into()),
            &online,
            asleep
        ));
        assert!(!displays_asleep(&DisplaySelector::Active, &online, asleep));
        assert!(!displays_asleep(&DisplaySelector::All, &online, asleep));
        // Main asleep, secondary usable: not "nothing can be captured".
        assert!(!displays_asleep(&DisplaySelector::All, &online, |id| id == 1));
        assert!(displays_asleep(&DisplaySelector::All, &online, |_| true));
        // An id that is not online falls back to every display.
        assert!(!displays_asleep(
            &DisplaySelector::Id("9".into()),
            &online,
            asleep
        ));
        assert!(!displays_asleep(&DisplaySelector::Active, &[], |_| true));
    }
}

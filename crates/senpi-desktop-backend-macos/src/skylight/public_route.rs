//! The public per-pid pointer post that supplements SkyLight's for plain
//! AppKit, only where it is a separate function (ported from oh-my-pi 18.13.1
//! `macos/route.rs` `Routes::public`). On macOS 26 `CGEventPostToPid`
//! re-exports `SLEventPostToPid`, so posting through both delivered every
//! pointer event twice: a double-click reached its target as two.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::LazyLock;

use core_graphics::event::CGEvent;
use foreign_types::ForeignType;

use super::spi::{cast_symbol, raw_symbol, SLEventPostToPidFn};

/// `CGEventPostToPid`, when it is not `SLEventPostToPid` under another name.
static PUBLIC: LazyLock<Option<SLEventPostToPidFn>> = LazyLock::new(|| {
    separate_public_post(raw_symbol(c"SLEventPostToPid"), raw_symbol(c"CGEventPostToPid"))
        .map(|public| cast_symbol(public.as_ptr()))
});

/// The public post's address when it is a separate implementation from the
/// SkyLight post (`routed`); `None` when it is missing or the same function,
/// where a second post would deliver the event again.
pub(super) fn separate_public_post(
    routed: Option<NonNull<c_void>>,
    public: Option<NonNull<c_void>>,
) -> Option<NonNull<c_void>> {
    public.filter(|public| Some(*public) != routed)
}

/// Posts `event` to `pid` through the public per-pid queue, when that is a
/// separate route ([`separate_public_post`]); otherwise the SkyLight post
/// already delivered it and nothing more is sent.
pub(super) fn post(pid: libc::pid_t, event: &CGEvent) {
    if let Some(post_to_pid) = *PUBLIC {
        // SAFETY: `event` stays retained for the synchronous post, and the
        // public symbol shares the `SLEventPostToPid` ABI.
        unsafe { post_to_pid(pid, event.as_ptr().cast()) };
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use super::separate_public_post;

    static ROUTED: u8 = 0;
    static PUBLIC: u8 = 0;

    fn address(of: &'static u8) -> Option<NonNull<c_void>> {
        Some(NonNull::from(of).cast())
    }

    #[test]
    fn a_public_post_that_is_the_skylight_post_is_not_sent_twice() {
        // Given: CGEventPostToPid re-exports SLEventPostToPid (macOS 26)
        // When
        let public = separate_public_post(address(&ROUTED), address(&ROUTED));
        // Then: one post delivers the event once
        assert_eq!(public, None);
    }

    #[test]
    fn a_separate_public_post_still_supplements_skylight() {
        assert_eq!(separate_public_post(address(&ROUTED), address(&PUBLIC)), address(&PUBLIC));
        assert_eq!(separate_public_post(address(&ROUTED), None), None);
    }
}

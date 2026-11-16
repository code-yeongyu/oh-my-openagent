//! The Wayland clipboard ladder: data-control, then the portal Clipboard interface on the
//! combined session (probed), then none - and with no route a paste never falls back to keys.

use omo_computer_core::backend::Backend;
use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::{EngineCode, Reason};

use super::support::{key, send, Rig, US};
use crate::clipboard::{paste_refusal, ClipboardRoute};
use crate::fake::Mode;

#[test]
fn portal_clipboard_rung_is_probed_and_no_route_answers_unavailable_without_typing() {
    let rig = Rig::new(US, Mode::Serve);

    // The portal reports Clipboard v1 and grants RequestClipboard before Start.
    let portal = rig.portal().with_clipboard(Some(1));
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false))).is_ok());
    assert!(portal.log().clipboard_requested_before_start, "RequestClipboard on the combined session before Start");
    assert_eq!(backend.clipboard_route(), ClipboardRoute::PortalClipboard);
    assert!(backend.clipboard_write("hello").is_ok());
    assert_eq!(portal.log().clipboard, "hello", "written through the portal's selection");

    // No portal Clipboard (xdpw), no data-control: no route.
    let portal = rig.portal().with_clipboard(None);
    let mut backend = rig.portal_backend(CompositorName::Sway, &portal);
    assert!(send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false))).is_ok());
    assert_eq!(backend.clipboard_route(), ClipboardRoute::None);
    assert!(!portal.log().clipboard_requested_before_start, "probed: no Clipboard interface, nothing requested");
    let keys_before = rig.eis.log().keys.len();
    let refusal = backend.clipboard_write("hello").expect_err("no clipboard route");
    assert_eq!((refusal.code, refusal.reason), (EngineCode::Internal, Some(Reason::NoClipboardRoute)));
    assert_eq!(refusal.wire_data()["nextCall"], "type");
    assert_eq!(rig.eis.log().keys.len(), keys_before, "never a silent keystroke fallback");
    let clipboard = backend.clipboard_capability();
    assert!(!clipboard.available, "the clipboard reads unavailable");
    assert_eq!(clipboard.reason.as_deref(), Some("no_clipboard_route"));

    // A secret paste with no route is refused, nothing typed; non-secret answers Unavailable.
    let secret = paste_refusal(ClipboardRoute::None, true).expect("refused");
    assert_eq!(secret.reason, Some(Reason::SecretNoClipboardRoute));
    assert_eq!(paste_refusal(ClipboardRoute::None, false).and_then(|r| r.reason), Some(Reason::NoClipboardRoute));
    assert!(paste_refusal(ClipboardRoute::PortalClipboard, true).is_none());
}

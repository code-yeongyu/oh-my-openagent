//! The engine never passes its EIS fd to a child (d-linux.md RELEASE ON ENGINE DEATH): the
//! socket is close-on-exec on both routes, so a process the engine starts cannot keep the
//! compositor's virtual devices alive after the engine dies.

use std::os::fd::RawFd;
use std::process::Command;

use omo_computer_core::capabilities::CompositorName;

use super::support::{key, send, Rig, US};
use crate::fake::Mode;

fn child_fds() -> Vec<RawFd> {
    let out = Command::new("/bin/sh")
        .args(["-c", "ls /proc/self/fd"])
        .output()
        .expect("child runs");
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .filter_map(|fd| fd.parse().ok())
        .collect()
}

#[test]
fn engine_never_passes_its_eis_fd_to_a_child() {
    let rig = Rig::new(US, Mode::Serve);
    let mut socket = rig.socket_backend(CompositorName::Mutter);
    assert!(socket.connect_input().is_ok());
    let fd = socket.eis_fd().expect("connected on the socket route");
    assert!(fd.cloexec, "socket route: close-on-exec");
    assert!(
        !child_fds().contains(&fd.raw),
        "a child does not inherit fd {}",
        fd.raw
    );

    // The portal hands the fd over D-Bus; this fake hands it WITHOUT close-on-exec.
    let portal = rig.portal().handing_inheritable_fds(true);
    let mut via_portal = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut via_portal, &key("a", true))
        .and_then(|_| send(&mut via_portal, &key("a", false)))
        .is_ok());
    let fd = via_portal.eis_fd().expect("connected on the portal route");
    assert!(
        fd.cloexec,
        "portal route: the engine sets close-on-exec itself"
    );
    assert!(
        !child_fds().contains(&fd.raw),
        "a child does not inherit fd {}",
        fd.raw
    );
    assert_eq!(
        rig.eis.log().connections,
        2,
        "one connection per backend, none from a child"
    );
}

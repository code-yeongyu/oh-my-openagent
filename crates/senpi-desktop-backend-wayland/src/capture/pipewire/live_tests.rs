//! Live check of the runtime-loaded PipeWire grab against a real daemon, with
//! no portal: `SENPI_PW_TEST_NODE` names a video source node (for example
//! `gst-launch-1.0 videotestsrc ! video/x-raw,format=BGRx,width=320,height=240
//! ! pipewiresink`), reached over `$XDG_RUNTIME_DIR/pipewire-0`. Run with
//! `--ignored --nocapture`; it prints machine-read `key=value` facts.

use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

use super::lib::pipewire;
use super::stream::grab_frame;

#[test]
#[ignore = "live: needs a PipeWire daemon and SENPI_PW_TEST_NODE (see the module docs)"]
fn grabs_one_frame_from_a_pipewire_video_node() {
    let node: u32 = std::env::var("SENPI_PW_TEST_NODE").unwrap().parse().unwrap();
    let socket = PathBuf::from(std::env::var("XDG_RUNTIME_DIR").unwrap()).join("pipewire-0");
    let remote = OwnedFd::from(UnixStream::connect(&socket).unwrap());
    let image = grab_frame(pipewire().unwrap(), node, remote).unwrap();
    let nonblack = image.pixels().filter(|pixel| pixel.0[..3] != [0, 0, 0]).count();
    println!(
        "pw_frame={}x{} nonblack_pixels={nonblack}",
        image.width(),
        image.height()
    );
    assert_eq!((image.width(), image.height()), (320, 240));
    assert!(nonblack > 0, "videotestsrc draws color bars");
}

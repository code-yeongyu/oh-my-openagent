//! Fake-helper wire tests (design row M7): framing, ids, faults.

use std::io::Cursor;

use crate::capture::helper::{FrameSource, HelperRequest, LineHelper, ShotTarget, RECORD_MAX_FPS};
use crate::capture::seam::CaptureHelper;
use crate::capture::types::CaptureFault;

fn still(id: u64) -> HelperRequest {
    HelperRequest::Screenshot {
        id,
        target: ShotTarget::Window { window: 7 },
        cursor: true,
        exclude: vec![900],
    }
}

fn helper(reply: &[u8]) -> LineHelper<Cursor<Vec<u8>>, Vec<u8>> {
    LineHelper::new(Cursor::new(reply.to_vec()), Vec::new())
}

#[test]
fn request_is_one_json_line_and_reply_bytes_follow_it() {
    let mut wire =
        b"{\"id\":3,\"ok\":true,\"source\":\"screenshot\",\"filter\":\"window\",\"pngBytes\":4}\n"
            .to_vec();
    wire.extend_from_slice(b"\x89PNG");
    let mut helper = helper(&wire);
    let frame = helper.call(&still(3)).expect("frame");
    assert_eq!(frame.png, b"\x89PNG");
    assert_eq!(frame.reply.source, Some(FrameSource::Screenshot));
    let (_, sent) = helper.into_parts();
    assert_eq!(
        String::from_utf8(sent).expect("utf8"),
        "{\"op\":\"screenshot\",\"id\":3,\"target\":{\"kind\":\"window\",\"window\":7},\"cursor\":true,\"exclude\":[900]}\n"
    );
}

#[test]
fn faults_are_typed() {
    let cases: [(&[u8], CaptureFault); 5] = [
        (b"", CaptureFault::HelperGone),
        (b"not json\n", CaptureFault::Protocol),
        (b"{\"id\":9,\"ok\":true}\n", CaptureFault::Protocol),
        (
            b"{\"id\":3,\"ok\":false,\"error\":\"denied\"}\n",
            CaptureFault::Denied,
        ),
        (
            b"{\"id\":3,\"ok\":true,\"pngBytes\":999999999}\n",
            CaptureFault::Protocol,
        ),
    ];
    for (reply, fault) in cases {
        assert_eq!(
            helper(reply).call(&still(3)).err(),
            Some(fault),
            "{}",
            String::from_utf8_lossy(reply)
        );
    }
}

#[test]
fn recording_never_exceeds_15_fps() {
    assert!(matches!(
        HelperRequest::record_start(1, "/tmp/r.mov".into(), 60),
        HelperRequest::RecordStart {
            fps: RECORD_MAX_FPS,
            ..
        }
    ));
}

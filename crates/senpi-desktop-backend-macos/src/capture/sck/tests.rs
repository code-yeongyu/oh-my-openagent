//! Wire tests against fake helpers: real child processes speaking (or
//! breaking) the helper protocol, so transport, reset, and error mapping all
//! run against the actual pipe code.

use senpi_desktop_core::error::ErrorCode;

use super::client::{ClientError, HelperClient};
use super::protocol::TargetRequest;
use super::test_support::{fake_helper, PY_PREAMBLE};

fn request_batch(targets: &[TargetRequest]) -> Vec<TargetRequest> {
    targets.to_vec()
}

#[test]
fn frame_reply_decodes_rgba_and_bounds() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
read_request()
header({{'kind':'frame','index':0,'width':2,'height':1,'byteLength':8,
        'isOnScreen':True,
        'bounds':{{'x':10.0,'y':20.0,'width':2.0,'height':1.0}}}})
pixels(2, 1, [56, 34, 12, 255, 1, 2, 3, 255])
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let frames = client
        .capture(&request_batch(&[TargetRequest::window(42)]))
        .unwrap();
    assert_eq!(frames.len(), 1);
    let frame = &frames[0];
    assert_eq!(frame.bounds, (10.0, 20.0, 2.0, 1.0));
    assert_eq!(frame.is_on_screen, Some(true));
    assert_eq!(
        frame.image.as_raw(),
        &vec![12, 34, 56, 255, 3, 2, 1, 255]
    );
}

#[test]
fn excluded_titles_reach_the_helper_on_display_requests() {
    let dir = tempfile::tempdir().unwrap();
    let capture_log = dir.path().join("request.json");
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
req = read_request()
open(r'{capture}', 'w').write(json.dumps(req))
header({{'kind':'frame','index':0,'width':1,'height':1,'byteLength':4,
        'bounds':{{'x':0.0,'y':0.0,'width':1.0,'height':1.0}}}})
pixels(1, 1, [0, 0, 0, 255])
",
        capture = capture_log.display()
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let targets = request_batch(&[TargetRequest::display(
        7,
        &["OmO HUD".to_owned(), "Pi".to_owned()],
        &[4242],
    )]);
    client.capture(&targets).unwrap();
    let sent: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&capture_log).unwrap()).unwrap();
    assert_eq!(
        sent["requests"][0]["excludeWindowTitles"],
        serde_json::json!(["OmO HUD", "Pi"])
    );
    assert_eq!(sent["requests"][0]["excludeWindowIds"], serde_json::json!([4242]));
    assert_eq!(sent["requests"][0]["kind"], serde_json::json!("display"));
}

#[test]
fn capture_unavailable_maps_reason_without_resetting_the_worker() {
    let dir = tempfile::tempdir().unwrap();
    let trace = dir.path().join("trace.json");
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
events = []
wire_read_request, wire_header = read_request, header

def read_request():
    request = wire_read_request()
    events.append('request')
    return request

def header(value):
    events.append(value['kind'])
    wire_header(value)

read_request()
header({{'kind':'error','code':'CaptureUnavailable','reason':'minimized',
        'error':'The window is minimized'}})
read_request()
header({{'kind':'frame','index':0,'width':1,'height':1,'byteLength':4,
        'bounds':{{'x':0.0,'y':0.0,'width':1.0,'height':1.0}}}})
with open(r'{trace}', 'w') as output:
    json.dump(events, output)
pixels(1, 1, [9, 9, 9, 255])
",
        trace = trace.display()
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::window(9)])).unwrap_err();
    let ClientError::Reply(error) = error else {
        panic!("expected a synchronized error reply");
    };
    assert_eq!(error.code, ErrorCode::CaptureUnavailable);
    assert_eq!(
        error.capture_unavailable.map(|data| data.reason),
        Some("minimized".to_owned())
    );
    // A reply-level error keeps the worker alive: the next capture succeeds.
    let frames = client.capture(&request_batch(&[TargetRequest::window(9)])).unwrap();
    assert_eq!(frames.len(), 1);
    let events: Vec<String> =
        serde_json::from_str(&std::fs::read_to_string(trace).unwrap()).unwrap();
    assert_eq!(events, ["request", "error", "request", "frame"]);
}

#[test]
fn permission_denied_maps_through_the_tcc_guidance() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
read_request()
header({{'kind':'error','code':'PermissionDenied',
        'error':'Screen Recording permission is not granted'}})
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::display(1, &[], &[])])).unwrap_err();
    let ClientError::Reply(error) = error else {
        panic!("expected a synchronized permission reply");
    };
    assert_eq!(error.code, ErrorCode::PermissionDenied);
}

#[test]
fn a_dead_helper_is_a_transport_failure() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, "#!/usr/bin/env python3\nimport os\nos._exit(1)\n");
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::window(1)])).unwrap_err();
    let ClientError::Transport(error) = error else {
        panic!("expected a transport failure");
    };
    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(
        error.message.contains("exited before returning") || error.message.contains("transport"),
        "{}",
        error.message
    );
}

#[test]
fn a_truncated_frame_is_a_transport_failure() {
    let dir = tempfile::tempdir().unwrap();
    // Announces 16 bytes then closes after 4.
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
read_request()
header({{'kind':'frame','index':0,'width':2,'height':2,'byteLength':16,
        'bounds':{{'x':0.0,'y':0.0,'width':2.0,'height':2.0}}}})
sys.stdout.buffer.write(bytes(4))
sys.stdout.buffer.flush()
import os; os._exit(0)
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::window(1)])).unwrap_err();
    let ClientError::Transport(error) = error else {
        panic!("expected a transport failure");
    };
    assert!(
        error.message.contains("truncated") || error.message.contains("exceeded its"),
        "{}",
        error.message
    );
}

#[test]
fn a_garbage_header_is_a_transport_failure() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(
        &dir,
        concat!(
            "#!/usr/bin/env python3\n",
            "import sys\n",
            "sys.stdout.write('not json\\n')\n",
            "sys.stdout.flush()\n",
        ),
    );
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::window(1)])).unwrap_err();
    let ClientError::Transport(error) = error else {
        panic!("expected a transport failure");
    };
    assert!(error.message.contains("invalid native capture response"), "{}", error.message);
}

#[test]
fn an_unsupported_reply_is_an_internal_bug_on_modern_macos() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
read_request()
header({{'kind':'error','code':'Unsupported','error':'requires macOS 14'}})
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    let error = client.capture(&request_batch(&[TargetRequest::window(1)])).unwrap_err();
    let ClientError::Reply(error) = error else {
        panic!("expected a synchronized unsupported reply");
    };
    assert_eq!(error.code, ErrorCode::Internal);
}

#[test]
fn oversized_dimensions_and_byte_lengths_are_transport_failures() {
    for (width, byte_length) in [(u32::MAX, 4usize), (1, usize::MAX)] {
        let dir = tempfile::tempdir().unwrap();
        let helper = fake_helper(
            &dir,
            &format!(
                "{PY_PREAMBLE}
read_request()
header({{
    'kind': 'frame', 'index': 0, 'width': {width}, 'height': 1,
    'byteLength': {byte_length},
    'bounds': {{'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}}
}})
pixels(1, 1, [0, 0, 0, 255])
"
            ),
        );
        let mut client = HelperClient::start(&helper).unwrap();
        let error = client.capture(&[TargetRequest::window(1)]).unwrap_err();
        assert!(matches!(error, ClientError::Transport(_)), "{error:?}");
    }
}

#[test]
fn ping_waits_for_the_ready_reply() {
    // Given: a helper that answers the warm-up ping
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
assert json.loads(sys.stdin.buffer.readline().decode()) == {{'kind': 'ping'}}
header({{'kind':'ready'}})
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    // When / Then: the ping returns once the ready header arrives
    client.ping(std::time::Duration::from_secs(5)).unwrap();
}

#[test]
fn a_silent_helper_fails_the_ping_within_its_budget() {
    // Given: a helper that reads the ping and never answers
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!(
        "{PY_PREAMBLE}
import time
sys.stdin.buffer.readline()
time.sleep(30)
"
    ));
    let mut client = HelperClient::start(&helper).unwrap();
    // When: the warm-up budget is short
    let started = std::time::Instant::now();
    let error = client.ping(std::time::Duration::from_millis(300)).unwrap_err();
    // Then: it is a transport (start) failure that honors the budget
    assert!(matches!(error, ClientError::Transport(_)), "{error:?}");
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

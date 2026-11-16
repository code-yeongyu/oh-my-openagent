use super::fake::FakeUia;
use crate::uia::cache::{cache_request, Batching, PROPERTIES};
use crate::uia::reader::UiaReader;

const MSAA_PROXY: &str =
    "[pid:4242,providerId:0x0 Main(parent link):Microsoft: MSAA Proxy (unmanaged:uiautomationcore.dll)]";
const CLIENT_SIDE_INPROC: &str =
    "[pid:0,providerId:0x0 Main:Microsoft: Edit Proxy (unmanaged:uiautomationcore.dll)]";

#[test]
fn cache_request_batches_by_provider_class() {
    assert_eq!(
        cache_request(MSAA_PROXY).batching,
        Batching::Batch,
        "a WinForms MSAA proxy named by pid"
    );
    assert_eq!(
        cache_request(CLIENT_SIDE_INPROC).batching,
        Batching::Skip,
        "client-side in-process providers only"
    );
    assert_eq!(
        cache_request(
            "[pid:900,providerId:0x0 Main:Nested [pid:900] (managed:UIAutomationProvider)]"
        )
        .batching,
        Batching::Batch
    );
    for property in [
        "Name",
        "ControlType",
        "AutomationId",
        "IsPassword",
        "RuntimeId",
        "Value.Value",
        "BoundingRectangle",
        "HasKeyboardFocus",
    ] {
        assert!(PROPERTIES.contains(&property), "{property} is cached");
    }
    let mut reader = UiaReader::new(FakeUia::winforms());
    let root = reader.root_of("4660").expect("root");
    let handle = root.node.handle.expect("root handle");
    let omo_computer_core::ax::Slice::Read(children) = reader.read_children(handle, 0, 250) else {
        panic!("children answered");
    };
    assert_eq!(children.len(), 2);
    let requests = &reader.source().requests;
    assert_eq!(requests.len(), 1, "one cache request for the read");
    assert_eq!(
        requests[0].batching,
        Batching::Batch,
        "the root's provider chose it"
    );
}

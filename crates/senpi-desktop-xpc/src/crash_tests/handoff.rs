//! A spawn-inherited Mach right carries an XPC endpoint, without a named
//! service or launchd job. libxpc serializes rights; copying port numbers over
//! a Unix socket would not. The right travels as a registered port, so the
//! child's bootstrap port stays launchd's: libSystem may use it before the
//! fixture runs (it does on macOS 14), and that traffic must never reach us.
use super::wait::Event;
use crate::{
    dictionary::Dictionary,
    native::{Endpoint, Object, Raw},
};
use std::ptr;

// SAFETY: Mach/spawn declarations follow the SDK. Pipe ABI matches the
// exported libxpc SPI used by Chromium's sandbox/mac/xpc.h. Test-only SPI;
// production endpoint discovery remains the authenticated named listener.
unsafe extern "C" {
    static mach_task_self_: u32;
    fn mach_port_allocate(task: u32, right: u32, name: *mut u32) -> i32;
    fn mach_port_insert_right(task: u32, name: u32, poly: u32, disposition: u32) -> i32;
    fn mach_port_mod_refs(task: u32, name: u32, right: u32, delta: i32) -> i32;
    fn mach_port_deallocate(task: u32, name: u32) -> i32;
    fn mach_ports_lookup(task: u32, ports: *mut *mut u32, count: *mut u32) -> i32;
    fn vm_deallocate(task: u32, address: usize, size: usize) -> i32;
    pub(super) fn posix_spawnattr_set_registered_ports_np(
        attr: *mut libc::posix_spawnattr_t,
        ports: *mut u32,
        count: u32,
    ) -> i32;
    fn xpc_pipe_create_from_port(port: u32, flags: i32) -> Raw;
    fn xpc_pipe_receive(port: u32, message: *mut Raw) -> i32;
    fn xpc_pipe_routine(pipe: Raw, request: Raw, reply: *mut Raw) -> i32;
    fn xpc_pipe_routine_reply(reply: Raw) -> i32;
}

fn task() -> u32 {
    // SAFETY: initialized by libSystem before Rust main and immutable thereafter.
    unsafe { mach_task_self_ }
}

struct SendRight(u32);
impl SendRight {
    /// Takes the first registered port; releases the others and the array.
    fn registered() -> Self {
        let mut ports: *mut u32 = ptr::null_mut();
        let mut count = 0;
        // SAFETY: current task and writable out-pointers; the kernel returns an
        // out-of-line array holding one send reference per non-null entry.
        assert_eq!(unsafe { mach_ports_lookup(task(), &mut ports, &mut count) }, 0);
        assert!(count >= 1 && !ports.is_null());
        // SAFETY: the kernel returned `count` initialized entries at `ports`.
        let entries = unsafe { std::slice::from_raw_parts(ports, count as usize) }.to_vec();
        // SAFETY: this out-of-line array was allocated for us and is no longer read.
        let size = entries.len() * std::mem::size_of::<u32>();
        assert_eq!(unsafe { vm_deallocate(task(), ports as usize, size) }, 0);
        for &extra in entries.iter().skip(1).filter(|&&port| port != 0) {
            drop(Self(extra));
        }
        assert_ne!(entries[0], 0, "no registered handoff port");
        Self(entries[0])
    }
}
impl Drop for SendRight {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns one send reference.
        assert_eq!(unsafe { mach_port_deallocate(task(), self.0) }, 0);
    }
}

pub(super) struct Handoff {
    pub(super) port: u32,
    ready: Event,
}
impl Handoff {
    pub(super) fn new() -> Self {
        let mut port = 0;
        // SAFETY: allocate one receive right in our own task namespace.
        assert_eq!(unsafe { mach_port_allocate(task(), 1, &mut port) }, 0);
        // SAFETY: MAKE_SEND creates a send right from the owned receive right.
        assert_eq!(unsafe { mach_port_insert_right(task(), port, port, 20) }, 0);
        let ready = Event::subscribe(port as usize, libc::EVFILT_MACHPORT, 0);
        Self { port, ready }
    }

    pub(super) fn reply(&self, endpoint: &Endpoint) {
        self.ready.wait();
        let mut raw = ptr::null_mut();
        // SAFETY: readiness established a message on our private receive right.
        assert_eq!(unsafe { xpc_pipe_receive(self.port, &mut raw) }, 0);
        // SAFETY: successful pipe receive transfers its result reference.
        let request = unsafe { Object::owned(raw) }.unwrap();
        // SAFETY: request is an actual live libxpc pipe dictionary.
        let dictionary = unsafe { Dictionary::received(request.raw()) }.unwrap();
        let mut reply = dictionary.reply().unwrap();
        reply.put_endpoint(endpoint);
        // SAFETY: reply retains the actual request's send-once reply context.
        assert_eq!(unsafe { xpc_pipe_routine_reply(reply.raw()) }, 0);
    }
}
impl Drop for Handoff {
    fn drop(&mut self) {
        // SAFETY: remove our send reference before destroying our receive right.
        assert_eq!(unsafe { mach_port_deallocate(task(), self.port) }, 0);
        // SAFETY: exactly one owned receive reference, with no further users here.
        assert_eq!(unsafe { mach_port_mod_refs(task(), self.port, 1, -1) }, 0);
    }
}

pub(super) fn receive() -> Endpoint {
    let inherited = SendRight::registered();
    // SAFETY: the registered port is a valid send right to the parent.
    let pipe = unsafe { Object::owned(xpc_pipe_create_from_port(inherited.0, 0)) }.unwrap();
    let request = Dictionary::new().unwrap();
    let mut raw = ptr::null_mut();
    // SAFETY: live pipe/request and writable result pointer.
    assert_eq!(
        unsafe { xpc_pipe_routine(pipe.raw(), request.raw(), &mut raw) },
        0
    );
    // SAFETY: successful routine transfers a reply reference.
    let reply = unsafe { Object::owned(raw) }.unwrap();
    // SAFETY: reply is the received live pipe dictionary.
    let dictionary = unsafe { Dictionary::received(reply.raw()) }.unwrap();
    dictionary.test_endpoint().unwrap()
}

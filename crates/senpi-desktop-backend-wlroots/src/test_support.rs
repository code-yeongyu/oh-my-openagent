//! Test fakes: a recording command runner, an in-memory sway IPC, a fake
//! sway event socket and a fake compositor speaking the Wayland wire
//! protocol, so no test needs a real desktop.

use std::collections::VecDeque;
use std::io::{Read as _, Write as _};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use parking_lot::Condvar;
use senpi_desktop_core::error::CoreResult;

use crate::command::{CommandRunner, RunFailure};
use crate::ipc::{self, SwayIpc};

/// One output, captured from sway 1.10: HDMI-A-1 at 0,0 1920x1200.
pub(crate) const OUTPUTS_JSON: &str = r#"[{
  "id": 13, "type": "output", "name": "HDMI-A-1", "make": "RZD", "model": "HDMI", "serial": "NA",
  "active": true, "dpms": true, "power": true, "primary": false, "layout": "output", "orientation": "none",
  "percent": 1.0, "urgent": false, "marks": [], "border": "none", "current_border_width": 0,
  "focus": [11], "fullscreen_mode": 0, "sticky": false, "floating": null, "scratchpad_state": null,
  "scale": 1.0, "transform": "normal", "current_workspace": "1", "window": null, "refresh": null,
  "nodes": [], "floating_nodes": [],
  "rect": { "x": 0, "y": 0, "width": 1920, "height": 1200 },
  "deco_rect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "window_rect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "geometry": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "modes": [ { "width": 1920, "height": 1200, "refresh": 59997, "picture_aspect_ratio": "none" } ],
  "current_mode": { "width": 1920, "height": 1200, "refresh": 59997, "picture_aspect_ratio": "none" }
}]"#;

/// A tree captured from sway 1.10: one output, one workspace, a focused
/// kitty window and a floating XWayland window.
pub(crate) const TREE_JSON: &str = r#"{
  "id": 1, "name": "root", "type": "root", "border": "none", "layout": "splith",
  "rect": { "x": 0, "y": 0, "width": 1920, "height": 1200 }, "focused": false,
  "nodes": [
    {
      "id": 13, "name": "HDMI-A-1", "type": "output", "focused": false,
      "rect": { "x": 0, "y": 0, "width": 1920, "height": 1200 },
      "nodes": [
        {
          "id": 11, "name": "1", "type": "workspace", "focused": false,
          "rect": { "x": 0, "y": 0, "width": 1920, "height": 1200 },
          "nodes": [
            {
              "id": 12, "name": "archlinux: dori", "type": "con", "app_id": "kitty", "shell": "xdg_shell",
              "focused": true, "visible": true, "pid": 1311138, "window": null, "window_properties": null,
              "rect": { "x": 20, "y": 56, "width": 1880, "height": 1124 },
              "nodes": [], "floating_nodes": []
            }
          ],
          "floating_nodes": [
            {
              "id": 15, "name": "floaty", "type": "con", "app_id": null, "shell": "xwayland",
              "focused": false, "visible": true, "pid": 999, "window": 4194304,
              "window_properties": { "class": "XFloat", "instance": "xfloat", "title": "floaty" },
              "rect": { "x": 100, "y": 100, "width": 400, "height": 300 },
              "nodes": [], "floating_nodes": []
            }
          ]
        }
      ],
      "floating_nodes": []
    }
  ],
  "floating_nodes": []
}"#;

/// The command runner the tests drive: records every invocation and replays
/// queued outcomes, including scripted spawned children.
pub(crate) struct FakeRunner {
    calls: Mutex<Vec<(String, Vec<String>)>>,
    replies: Mutex<VecDeque<Result<Vec<u8>, RunFailure>>>,
    /// Children waiting to be spawned, in queue order.
    children: Mutex<VecDeque<Arc<Mutex<FakeChildInner>>>>,
    /// Every child handed out by `spawn`, in spawn order.
    spawned_children: Mutex<Vec<Arc<Mutex<FakeChildInner>>>>,
    spawned: Mutex<Vec<Vec<String>>>,
}

impl FakeRunner {
    pub(crate) fn new(replies: Vec<Result<Vec<u8>, RunFailure>>) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            replies: Mutex::new(replies.into()),
            children: Mutex::new(VecDeque::new()),
            spawned_children: Mutex::new(Vec::new()),
            spawned: Mutex::new(Vec::new()),
        }
    }

    /// Queues one spawned child: `None` from `try_wait` until it has been
    /// polled `polls_to_exit` times, then the given exit code.
    pub(crate) fn queue_child(&mut self, polls_to_exit: u32, exit: i32) {
        self.children
            .lock()
            .unwrap()
            .push_back(Arc::new(Mutex::new(FakeChildInner {
                polls_to_exit,
                polls: 0,
                killed: false,
                exit: None,
                scripted_exit: exit,
            })));
    }

    /// The argument vectors of every `spawn`, in order.
    pub(crate) fn spawns(&self) -> Vec<Vec<String>> {
        self.spawned.lock().unwrap().clone()
    }

    /// Every spawned child's final state, in spawn order.
    pub(crate) fn child_states(&self) -> Vec<FakeChildState> {
        self.spawned_children
            .lock()
            .unwrap()
            .iter()
            .map(|state| {
                let inner = state.lock().unwrap();
                FakeChildState {
                    polls: inner.polls,
                    killed: inner.killed,
                    exit: inner.exit.unwrap_or(inner.scripted_exit),
                }
            })
            .collect()
    }

    /// A PNG `grim` would print, filled with one color.
    pub(crate) fn png(width: u32, height: u32, pixel: [u8; 4]) -> Result<Vec<u8>, RunFailure> {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba(pixel));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .expect("encode png");
        Ok(bytes.into_inner())
    }

    /// wtype's usage failure when it is run with no arguments.
    pub(crate) fn usage() -> Result<Vec<u8>, RunFailure> {
        Err(RunFailure::Exit {
            program: "wtype".to_owned(),
            code: 1,
            stderr: "Usage: wtype <text-to-type>".to_owned(),
        })
    }

    pub(crate) fn calls(&self) -> Vec<(String, Vec<String>)> {
        self.calls.lock().unwrap().clone()
    }

    /// The argument vectors of every `program` invocation, in order.
    pub(crate) fn args_of(&self, program: &str) -> Vec<Vec<String>> {
        self.calls()
            .into_iter()
            .filter(|(invoked, _)| invoked == program)
            .map(|(_, args)| args)
            .collect()
    }
}

impl CommandRunner for FakeRunner {
    fn run(&mut self, program: &str, args: &[String]) -> Result<Vec<u8>, RunFailure> {
        self.calls
            .lock()
            .unwrap()
            .push((program.to_owned(), args.to_vec()));
        self.replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(Vec::new()))
    }

    fn spawn(
        &mut self,
        program: &str,
        args: &[String],
    ) -> Result<Box<dyn crate::command::SpawnedChild>, RunFailure> {
        self.calls
            .lock()
            .unwrap()
            .push((program.to_owned(), args.to_vec()));
        self.spawned.lock().unwrap().push(args.to_vec());
        let state = self
            .children
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
                Arc::new(Mutex::new(FakeChildInner {
                    polls_to_exit: 1,
                    polls: 0,
                    killed: false,
                    exit: None,
                    scripted_exit: 0,
                }))
            });
        self.spawned_children
            .lock()
            .unwrap()
            .push(Arc::clone(&state));
        Ok(Box::new(FakeChild { state }))
    }
}

/// What a scripted child ended up doing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FakeChildState {
    pub(crate) polls: u32,
    pub(crate) killed: bool,
    pub(crate) exit: i32,
}

/// A scripted child: exits after `polls_to_exit` `try_wait` calls, or when
/// killed.
pub(crate) struct FakeChild {
    state: Arc<Mutex<FakeChildInner>>,
}

struct FakeChildInner {
    polls_to_exit: u32,
    polls: u32,
    killed: bool,
    exit: Option<i32>,
    scripted_exit: i32,
}

impl crate::command::SpawnedChild for FakeChild {
    fn try_wait(&mut self) -> std::io::Result<Option<i32>> {
        let mut inner = self.state.lock().unwrap();
        inner.polls = inner.polls.saturating_add(1);
        if inner.exit.is_some() || inner.polls >= inner.polls_to_exit {
            Ok(inner.exit.or(Some(inner.scripted_exit)))
        } else {
            Ok(None)
        }
    }

    fn kill(&mut self) {
        let mut inner = self.state.lock().unwrap();
        inner.killed = true;
        inner.exit = Some(1);
    }
}

/// What the fake sway IPC recorded: one (message type, payload) per request.
type IpcLog = Arc<Mutex<Vec<(u32, Vec<u8>)>>>;

/// The in-memory sway IPC: replies with the fixtures, records requests.
#[derive(Clone, Default)]
pub(crate) struct FakeSwayIpc {
    pub requests: IpcLog,
}

impl SwayIpc for FakeSwayIpc {
    fn round_trip(&mut self, kind: u32, payload: &[u8]) -> CoreResult<Vec<u8>> {
        self.requests.lock().unwrap().push((kind, payload.to_vec()));
        let reply = match kind {
            kind if kind == ipc::message::GET_OUTPUTS => OUTPUTS_JSON.as_bytes().to_vec(),
            kind if kind == ipc::message::GET_TREE => TREE_JSON.as_bytes().to_vec(),
            kind if kind == ipc::message::RUN_COMMAND => br#"[{"success": true}]"#.to_vec(),
            kind if kind == ipc::message::SUBSCRIBE => br#"{"success": true}"#.to_vec(),
            _ => Vec::new(),
        };
        Ok(reply)
    }
}

/// A fake sway IPC socket: accepts the first (client) connection, answers
/// its SUBSCRIBE request, and lets the test push binding events to that
/// same client through a clone of the accepted stream.
pub(crate) struct FakeSway {
    _dir: tempfile::TempDir,
    pub path: PathBuf,
    events: Mutex<Option<std::sync::mpsc::Receiver<UnixStream>>>,
    client: Option<UnixStream>,
    subscribed: Arc<Mutex<Option<Vec<u8>>>>,
}

impl FakeSway {
    pub(crate) fn start() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sway-ipc.fake.sock");
        let listener = UnixListener::bind(&path).expect("bind fake sway socket");
        let subscribed = Arc::new(Mutex::new(None));
        let recorded = Arc::clone(&subscribed);
        let (events_tx, events_rx) = std::sync::mpsc::channel::<UnixStream>();
        std::thread::Builder::new()
            .name("fake-sway".to_owned())
            .spawn(move || {
                let Ok((mut client, _)) = listener.accept() else {
                    return;
                };
                if let Ok(clone) = client.try_clone() {
                    let _ = events_tx.send(clone);
                }
                let request = read_sway_frame(&mut client);
                if let Some((kind, payload)) = request {
                    if kind == ipc::message::SUBSCRIBE {
                        *recorded.lock().unwrap() = Some(payload);
                        write_sway_frame(
                            &mut client,
                            ipc::message::SUBSCRIBE,
                            br#"{"success": true}"#,
                        );
                    } else {
                        write_sway_frame(&mut client, kind, br#"{"success": false}"#);
                    }
                }
                // Drain until the client goes away.
                let mut sink = [0u8; 4096];
                while !matches!(client.read(&mut sink), Ok(0) | Err(_)) {}
            })
            .expect("spawn fake sway");
        Self {
            _dir: dir,
            path,
            events: Mutex::new(Some(events_rx)),
            client: None,
            subscribed,
        }
    }

    /// The events this fake sway was asked to subscribe to, once seen.
    pub(crate) fn subscribed_to(&self) -> Option<String> {
        self.subscribed
            .lock()
            .unwrap()
            .as_ref()
            .map(|payload| String::from_utf8_lossy(payload).into_owned())
    }

    /// Pushes one binding event to the subscribed client, waiting until the
    /// fake sway has accepted it.
    pub(crate) fn send_binding_event(&mut self, json: &str) {
        self.send_raw(&sway_event_frame(ipc::event::BINDING, json.as_bytes()));
    }

    /// Writes raw bytes to the subscribed client — split frames, partial
    /// headers, whatever framing the test wants to feed the reader.
    pub(crate) fn send_raw(&mut self, bytes: &[u8]) {
        let mut client = match self.client.take() {
            Some(client) => client,
            None => {
                let receiver = self.events.lock().unwrap().take().expect("events channel");
                match receiver.recv_timeout(Duration::from_secs(2)) {
                    Ok(client) => client,
                    Err(error) => panic!("no client connection: {error}"),
                }
            }
        };
        client.write_all(bytes).expect("write raw frame");
        client.flush().expect("flush raw frame");
        self.client = Some(client);
    }
}

fn write_sway_frame(stream: &mut UnixStream, kind: u32, payload: &[u8]) {
    stream
        .write_all(&sway_event_frame(kind, payload))
        .expect("write sway frame");
    stream.flush().expect("flush sway frame");
}

/// The i3-ipc framing of one event, split up by the caller for resumability
/// tests.
fn sway_event_frame(kind: u32, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(14 + payload.len());
    frame.extend_from_slice(b"i3-ipc");
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&kind.to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn read_sway_frame(stream: &mut UnixStream) -> Option<(u32, Vec<u8>)> {
    let mut header = [0u8; 14];
    stream.read_exact(&mut header).ok()?;
    let length = u32::from_le_bytes(header[6..10].try_into().expect("four bytes")) as usize;
    let kind = u32::from_le_bytes(header[10..14].try_into().expect("four bytes"));
    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload).ok()?;
    Some((kind, payload))
}

/// One request the fake compositor observed on the wire.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum WireRequest {
    Bind {
        name: u32,
        interface: String,
        version: u32,
        id: u32,
    },
    CreatePointer {
        seat: u32,
        id: u32,
    },
    MotionAbsolute {
        x: u32,
        y: u32,
        x_extent: u32,
        y_extent: u32,
    },
    Button {
        code: u32,
        state: u32,
    },
    Axis {
        axis: u32,
        value: f64,
    },
    Frame,
    Other {
        object: u32,
        opcode: u32,
    },
}

struct WireShared {
    requests: parking_lot::Mutex<Vec<WireRequest>>,
    changed: Condvar,
}

/// A fake compositor: speaks just enough of the Wayland wire protocol to
/// answer the virtual pointer handshake and record what the client sends.
pub(crate) struct FakeWayland {
    _dir: tempfile::TempDir,
    pub path: PathBuf,
    shared: Arc<WireShared>,
}

impl FakeWayland {
    pub(crate) fn start() -> Self {
        Self::start_with_globals(&[
            (42, "zwlr_virtual_pointer_manager_v1", 2),
            (43, "wl_seat", 9),
            (44, "wl_compositor", 6),
        ])
    }

    /// A compositor that never advertises the virtual pointer manager.
    pub(crate) fn start_without_manager() -> Self {
        Self::start_with_globals(&[(43, "wl_seat", 9), (44, "wl_compositor", 6)])
    }

    fn start_with_globals(globals: &[(u32, &'static str, u32)]) -> Self {
        let globals = globals.to_vec();
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("wayland-fake.sock");
        let listener = UnixListener::bind(&path).expect("bind fake wayland socket");
        let shared = Arc::new(WireShared {
            requests: parking_lot::Mutex::new(Vec::new()),
            changed: Condvar::new(),
        });
        let server_shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("fake-wayland".to_owned())
            .spawn(move || {
                let Ok((mut client, _)) = listener.accept() else {
                    return;
                };
                while let Some((object, opcode, payload)) = read_wayland_message(&mut client) {
                    match (object, opcode) {
                        (1, 1) => {
                            // get_registry: advertise the scripted globals.
                            for (name, interface, version) in &globals {
                                send_wayland_message(
                                    &mut client,
                                    2,
                                    0,
                                    &registry_global(*name, interface, *version),
                                );
                            }
                        }
                        (1, 0) => {
                            // sync: answer the callback the payload names.
                            let callback =
                                u32::from_le_bytes(payload[..4].try_into().expect("four bytes"));
                            send_wayland_message(&mut client, callback, 0, &0u32.to_le_bytes());
                        }
                        (2, 0) => {
                            let (name, interface, version, id) = parse_bind(&payload);
                            record(
                                &server_shared,
                                WireRequest::Bind {
                                    name,
                                    interface,
                                    version,
                                    id,
                                },
                            );
                        }
                        (3, 0) => {
                            let seat =
                                u32::from_le_bytes(payload[..4].try_into().expect("four bytes"));
                            let id =
                                u32::from_le_bytes(payload[4..8].try_into().expect("four bytes"));
                            record(&server_shared, WireRequest::CreatePointer { seat, id });
                        }
                        (6, 1) => {
                            let word = |offset: usize| {
                                u32::from_le_bytes(
                                    payload[offset..offset + 4].try_into().expect("four bytes"),
                                )
                            };
                            record(
                                &server_shared,
                                WireRequest::MotionAbsolute {
                                    x: word(4),
                                    y: word(8),
                                    x_extent: word(12),
                                    y_extent: word(16),
                                },
                            );
                        }
                        (6, 2) => {
                            let code =
                                u32::from_le_bytes(payload[4..8].try_into().expect("four bytes"));
                            let state =
                                u32::from_le_bytes(payload[8..12].try_into().expect("four bytes"));
                            record(&server_shared, WireRequest::Button { code, state });
                        }
                        (6, 3) => {
                            let axis =
                                u32::from_le_bytes(payload[4..8].try_into().expect("four bytes"));
                            let fixed =
                                i32::from_le_bytes(payload[8..12].try_into().expect("four bytes"));
                            record(
                                &server_shared,
                                WireRequest::Axis {
                                    axis,
                                    value: f64::from(fixed) / 256.0,
                                },
                            );
                        }
                        (6, 4) => record(&server_shared, WireRequest::Frame),
                        (object, opcode) => {
                            record(&server_shared, WireRequest::Other { object, opcode })
                        }
                    }
                }
            })
            .expect("spawn fake wayland");
        Self {
            _dir: dir,
            path,
            shared,
        }
    }

    /// Waits until the requests satisfy `predicate`, then returns them.
    pub(crate) fn wait_for(
        &self,
        timeout: Duration,
        predicate: impl Fn(&[WireRequest]) -> bool,
    ) -> Vec<WireRequest> {
        let mut requests = self.shared.requests.lock();
        self.shared
            .changed
            .wait_while_for(&mut requests, |requests| !predicate(requests), timeout);
        requests.clone()
    }

    /// A stable snapshot for the cases where nothing more can arrive: the
    /// caller holds an error return that precedes any input, so waiting
    /// would only burn the timeout.
    pub(crate) fn requests(&self) -> Vec<WireRequest> {
        self.shared.requests.lock().clone()
    }
}

fn record(shared: &WireShared, request: WireRequest) {
    shared.requests.lock().push(request);
    shared.changed.notify_all();
}

fn registry_global(name: u32, interface: &str, version: u32) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&name.to_le_bytes());
    payload.extend_from_slice(&(interface.len() as u32 + 1).to_le_bytes());
    payload.extend_from_slice(interface.as_bytes());
    payload.push(0);
    while !payload.len().is_multiple_of(4) {
        payload.push(0);
    }
    payload.extend_from_slice(&version.to_le_bytes());
    payload
}

fn parse_bind(payload: &[u8]) -> (u32, String, u32, u32) {
    let name = u32::from_le_bytes(payload[..4].try_into().expect("four bytes"));
    let length = u32::from_le_bytes(payload[4..8].try_into().expect("four bytes")) as usize;
    let interface = String::from_utf8_lossy(&payload[8..8 + length.saturating_sub(1)]).into_owned();
    let version = u32::from_le_bytes(
        payload[8 + length..8 + length + 4]
            .try_into()
            .expect("four bytes"),
    );
    let id = u32::from_le_bytes(
        payload[8 + length + 4..8 + length + 8]
            .try_into()
            .expect("four bytes"),
    );
    (name, interface, version, id)
}

fn read_wayland_message(stream: &mut UnixStream) -> Option<(u32, u32, Vec<u8>)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header).ok()?;
    let object = u32::from_le_bytes(header[..4].try_into().expect("four bytes"));
    let word = u32::from_le_bytes(header[4..].try_into().expect("four bytes"));
    let opcode = word & 0xFFFF;
    let size = usize::try_from(word >> 16).unwrap_or(0);
    let mut payload = vec![0u8; size.saturating_sub(8)];
    stream.read_exact(&mut payload).ok()?;
    Some((object, opcode, payload))
}

fn send_wayland_message(stream: &mut UnixStream, object: u32, opcode: u32, payload: &[u8]) {
    let size = (payload.len() + 8) as u32;
    let mut frame = Vec::with_capacity(payload.len() + 8);
    frame.extend_from_slice(&object.to_le_bytes());
    frame.extend_from_slice(&((size << 16) | opcode).to_le_bytes());
    frame.extend_from_slice(payload);
    stream.write_all(&frame).expect("write wayland message");
    stream.flush().expect("flush wayland message");
}

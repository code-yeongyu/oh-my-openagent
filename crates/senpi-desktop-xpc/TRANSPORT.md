# Inactive O2 transport

`senpi-desktop-engine --xpc-agent <mach-service>` is an opt-in macOS 13+
listener. The flag must be first. It installs no job, is not selected by any
existing client, and cannot be combined with another engine mode. All legacy
launches still pass the responsibility gate. The only eligible requester is
O1's native-controller role; Electron main remains ineligible.

## Handshake and framing

Every received dictionary is checked against its actual XPC sender using O1
before decoding fields or JSON. Both listeners install O1's requirement and
their event handlers before activation. A failed requirement aborts startup.
The listener also checks peer EUID against its own EUID.

1. Named discovery sends exactly `version: uint64(1)` and `challenge: data(32)`
   using a fresh CSPRNG challenge. The reciprocal server requirement must be
   installed before activation. The reply must pass O1's server verification,
   echo the challenge and carry `epoch: data("xpc-1")` and an `endpoint`.
2. Connect to that anonymous endpoint, install the reciprocal requirement, and
   repeat the public challenge. Its authenticated reply advertises
   `max_request_bytes` (1 MiB), `max_response_bytes` (128 MiB), and
   `max_approval_frames` (64). The response bound covers sixteen current inline
   capture budgets after base64 expansion plus JSON/AX headroom, rounded upward.
3. After the trusted native UI approves a finite immutable batch, send an
   approval dictionary: `version: 1`, `kind: 1`, `hashes: data` containing up to
   64 concatenated SHA-256 hashes of the exact upcoming NDJSON frames, and
   `ttl_ms: uint64` in 1..60000. This is an authenticated controller assertion,
   never a proposal-source `approved` boolean. O3 supplies that UI; O2 does not.
   A batch cannot replace another unfinished batch.
4. The authenticated approval reply carries `kind: 1` and the connection's
   CSPRNG 256-bit `capability`. Send data dictionaries with exactly `version`,
   `kind: 2`, `capability`, `sequence: uint64`, and `payload: data`. Sequences
   start at 1 and increase by one. Approval consumes the next exact frame hash.
   JSON-RPC payloads and request IDs are unchanged. Replies and notifications
   use the same envelope with an independent monotonically increasing sequence.

Neither discovery connection carries tokens, approval, or RPC. An error,
interruption, invalid frame, stale capability, wrong sequence, expired approval,
or identity refusal closes that live connection. There is no reconnect or replay
path. A new engine instance requires fresh discovery and fresh approval.

## Session ownership

Backend construction waits for an authenticated, approved, structurally valid
`session.open`; `engine.hello` needs no backend. Each connection owns its Engine,
outbox, IDs, cancellation and resume token. Physical input arbitration and the
native stop listener are process-wide. Disconnect cancels queued/in-flight
requests, releases held input, and closes only that session. Client deadlines
never terminate the agent. Each session has its own reporting policy and
transition watermark, so one session cannot change another's policy or consume
its `stopPath.changed` notification.

The shared stop latch cannot be cleared with a connection's `stopPath.resume`.
Restarting revokes connections and requires fresh approval, and restores an
existing stop marker. O2 has no reset RPC or persistent-marker deletion operation.
A future signed O3 controller or desktop action is the intended authorized lift
path, but exclusive user control across restarts is not yet enforced: the
same-user deletion residual below remains. A connection's resume token cannot
become global reset authority.

## Durable user stop

The agent resolves its effective UID's home from the OS account database, not
`HOME`, and uses
`~/Library/Application Support/OmO/ComputerControl/xpc-v1/global-stop`.
The private `xpc-v1` directory is created with mode 0700 and must belong to that
UID. The marker must be a regular, non-symlink file owned by the same UID with
mode 0600 and the exact bytes `omo-global-stop-v1\n`. There is no production
environment variable, command-line option or feature flag for changing this
location.

The agent loads the marker before activating either listener. A missing marker
means not stopped. An unreadable or malformed marker, wrong owner or permission
bits, symlink, non-regular file, or invalid private directory starts the agent
stopped and logs the reason. No session or backend is needed for restoration.

**Residual: the marker is writable by the same user.** While the agent is down,
a same-user process can delete it and thereby lift a persisted stop at the next
startup, because a missing marker means not stopped. A stop during a live
session remains latched in memory and is unaffected by deleting the marker.
No external anchor is implemented in this delta; the anchor design is tracked in
[#10238](https://github.com/code-yeongyu/oh-my-openagent/issues/10238).
File ownership, permissions and descriptor-relative access do not
prevent this deletion.

All stop sources, including the native hotkey, pass through the shared
supervisor's release and commit boundary. The tap callback immediately latches
in-memory suspension, so new input is refused even when foreground preparation
is stuck. It queues the stop to a prestarted worker without waiting for input
scopes, locks or disk I/O. Disabled-by-timeout and disabled-by-user-input tap
events re-enable the tap; recovery logging also runs off the callback.

The worker requests physical input release and allows one second in aggregate
for active scopes to finish. On timeout it attempts tracked key/button ups via
an independent backend handle, without borrowing the blocked backend or waiting
for its foreground scope. The release work has a 5 ms budget, clocked by the
prestarted release worker once it runs, so scheduling delay cannot skip it; no
new handle starts after the budget. The exiting thread waits at most 100 ms in
total, which lets a post started inside the budget finish before exit. Preparation that has
emitted no down has no held ledger entry to release. Emergency release is best
effort: a stalled or failed native post cannot delay fatal termination
indefinitely. A timed-out stop commits the latch and exits without an ACK.

Releasing input does not publish or acknowledge a stop; held-request replies
wait for publication. Persistence creates an exclusive 0600 temp file,
writes the marker, fsyncs the file, renames it atomically, and fsyncs the
directory. Marker reads, creation, rename and temporary cleanup use the
validated directory descriptor rather than resolving its pathname again.
Newly created directory entries are also synced through their parents.
Only after commit may the stop epoch, outward suspended status,
`stopPath.changed` or RPC acknowledgement be published. A durable-write failure
is logged and terminates the agent after normal release or the bounded emergency
attempt, without acknowledging the stop or accepting more input. Legacy engine
modes retain in-memory rather than file-backed stop storage.

## Automated crash regression

Plain `cargo test -p senpi-desktop-xpc` runs the macOS real-child SIGKILL test;
it is neither ignored nor GUI-dependent. The desktop native contract macOS job
includes it through `cargo test --workspace --locked`. A spawn-inherited Mach
port carries the anonymous XPC endpoint to the child using libxpc serialization;
no launchd job or named service is registered. The child restores its bootstrap
port before opening the connection. Only the crate-local `cfg(test)` constructor
injects identity; production listeners retain O1 requirements and verification.

The child uses real libxpc, `agent.rs`, and `Incoming::receive`. The fixture
retains both duplex halves and uses the same `forward_frames` half-close as
engine `xpc::serve`, then drives the actual Session worker and ControlSlot.
Removing that shutdown must fail after observed key-down and SIGKILL because
key-up/session-close never arrive. The engine's own split regression and the
signed full-engine case below additionally exercise `xpc::serve` itself.

## Manual acceptance

`TMPDIR=/tmp/cu10207 bash crates/senpi-desktop-xpc/scripts/signed-transport.sh`
builds real binaries, signs temporary bundles, and exercises a task-owned GUI
Mach service. It covers valid/unauthorized/old-epoch requesters, squatting,
anonymous endpoint invalidation, fresh reconnect and stale-capability rejection.
It also invokes `signed-crash.sh`: a signed controller obtains control and holds
a fake key through the actual signed engine's `xpc::serve`; the script sends
`kill -9` and requires the subscribed key-up, session-close event and a fresh
signed controller's successful grant. This uses real bidirectional O1 checks;
only the engine's `cfg(test)` hardware factory and event reporting are substituted.
The trap boots out only its exact random labels and removes its fixture files.
It neither installs a permanent LaunchAgent nor changes TCC grants.

`TMPDIR=/tmp/cu10207 bash crates/senpi-desktop-xpc/scripts/signed-latch.sh`
signs the engine's `cfg(test)` process harness and uses the real `--xpc-agent`
dispatcher and O1 verifier. Only that test build accepts an isolated state path
and uses fake input hardware. The proof observes the startup state before any
client, acknowledges a stop, SIGKILLs the process, and restarts on the same
directory. It then requires stopped before and after a new authenticated client,
`Suspended` for input, and refusal of RPC reset. FIFO startup events replace
timing sleeps; the trap verifies job/process/fixture teardown.

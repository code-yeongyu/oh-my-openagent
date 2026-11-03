# Desktop engine attach and `--serve` multi-connection threat model (#12229)

This is the security design that has to be in place before the engine's
`--serve` daemon accepts concurrent clients and the desktop SDK ships an
`attach` transport. It does not change any code. It records what today's code
does (cited as `path:line` at `origin/dev` 37c0448f4d) and what the follow-up
changes must do and prove:

- **P3b**: concurrent same-uid `--serve` clients, the peer credential check,
  and the SDK `attach` (UDS) client. This is computer-use v2 plan row 25.
- **Stop-marker policy**: stop persistence stays XPC-only, and the daemon
  restart path is pinned for v1 consumers. This is plan row 31.

Paths are relative to `crates/` unless they start with `packages/` or `docs/`.

## Assets

| Id | Asset | Where it lives |
| --- | --- | --- |
| A1 | Desktop input authority: synthesized keyboard and mouse in the user's session | the session's backend; the foreground grant is held in the one `ControlSlot` per process (`senpi-desktop-session/src/grant.rs:61-82`) |
| A2 | Screen content: captures, frames, element refs, the artifact dir, the audit log | the daemon session opened from its CLI flags (`senpi-desktop-engine/src/daemon.rs:1-4,26-42`) |
| A3 | Stop authority: stop paths, latched stop, the resume token | `StopPaths` shared by every session in the process (`senpi-desktop-engine/src/sessions.rs:1,34-47`); the token file is 0600 on unix (`daemon.rs:84-94`; the non-unix writer at `daemon.rs:97-100` sets no mode); the persistent latch exists only on the XPC agent path (`stop_latch.rs:1`, `sessions.rs:26-32`) |
| A4 | TCC grants (Accessibility, Screen Recording) of the responsible process | macOS charges requests to the responsible process (`senpi-desktop-backend-macos/src/launch_gate.rs:3-12`) |
| A5 | The omo host's per-call permission preflight (`computer:read` / `computer:exec`) | the tool pipeline; kernels reach the engine only through it (`toolBridge`) |

## Trust boundaries

### B1: UDS `--serve` (Linux, macOS daemon mode)

- **Today.** The listener binds the endpoint and serves one client at a time
  (`senpi-desktop-engine/src/serve.rs:1-4,30-46`). It does no peer credential
  check. The only access control is the directory. The default endpoint is
  `$XDG_RUNTIME_DIR/senpi-desktop/<uid>.sock`, or the same path under the temp
  dir, and that directory is created 0700 (`client.rs:15-29,40-49`). An explicit
  `--serve <path>` outside that directory has no protection beyond the socket
  file mode, which the umask sets.
- **P3b target.** After `accept`, the daemon reads the peer's effective uid
  (`getpeereid` on macOS/BSD, `SO_PEERCRED` on Linux) in a new `peer.rs`. If it
  is not the daemon's euid, or the lookup fails, the daemon closes the
  connection without writing a byte and writes one audit line.
- **Strength.** This stops other uids. It does not stop a different process
  running as the same uid: every same-uid peer is equally trusted.
- **Method exposure is client-side.** The host-only filter (`session.open`,
  `control.grant`, `stopPath.resume`, ...: `senpi-desktop-core/src/methods.rs:89-130`)
  runs in the `--oneshot` / `--mcp` client process (`oneshot.rs:1-5,18-31`). The
  daemon's line handler routes every method it parses
  (`connection.rs:174-218`). `--resume` relies on that: it sends
  `stopPath.resume` over the socket with the token from the 0600 file
  (`client.rs:162-177`).
- **Windows named pipe.** It is created with `first_pipe_instance(true)` and
  the default security descriptor (`serve.rs:48-63`). There is no client-SID
  check. The access the default descriptor grants to other accounts is
  UNVERIFIED in this document.

### B2: XPC agent (`--xpc-agent`, macOS only)

Each check below must pass before the next one runs:

1. **Same euid at accept.** The connection is cancelled if the peer's euid
   differs (`senpi-desktop-xpc/src/peers.rs:21-25`, `native.rs:97-101`).
2. **Code-signature peer auth on every message.** The peer must match the role
   requirement (team `523JNR86LZ`, a fixed identifier per role:
   `roles.rs:1-30`). It must be validly signed, hardened (runtime, hard, kill),
   not debugged, free of the forbidden entitlements, and on the current
   security epoch (`policy.rs:98-164`). A verification result covers one
   message and is never cached or cloned (`policy.rs:43-52`).
3. **Finite approval and replay boundary per live connection.** A capability is
   bound per connection, and the message sequence must match
   (`senpi-desktop-xpc/src/connection.rs:1,63-77,172`).
4. **Engine admission.** Only after the checks above does the engine accept a
   valid `session.open`, and it uses no environment-selected backend
   (`senpi-desktop-engine/src/xpc.rs:68-116`).

**Strength.** This is the only boundary in the design that stops a same-uid
process. Such a process cannot speak to the engine unless it is one of our
signed, hardened, non-debugged binaries in the expected role. Code execution
inside such a binary is out of scope.

### B3: omo-hosted kernels never attach

The js and py kernels' `computer` global goes through `toolBridge`, which is one
`tool.computer` call per helper. That keeps the host's per-call preflight (A5)
on every call. Kernels use neither `attach` nor `spawn` (DESIGN §3 attach,
§6). The omo host never starts its own engine as `--serve`: that would let any
same-uid process skip A5 (Q decision 2, MCP exposure).

### B4: Launch and responsibility (macOS)

Every mode except `--xpc-agent` runs the #10207 gate first (`main.rs:45-56`).
That gate refuses an engine that is its own responsible process, or one whose
responsible process cannot be resolved (`launch_gate.rs:14-41`). A launchd job
gets no exception (`launch_gate.rs:10-12`). On other platforms the gate is a
no-op (`main.rs:158`). `--enable-daemon` only prevents an accidental daemon; it
is not a protection (`cli.rs:34-37`).

## Session model: shared on UDS, per connection on XPC only

| | UDS `--serve` daemon (P3b) | XPC agent |
| --- | --- | --- |
| Session | ONE session, opened by the daemon itself from its CLI flags (`daemon.rs:44-60`, `main.rs:126-135`); clients cannot open their own (`session.open` is host-only: `tests/serve_oneshot.rs:146-157`) | one Engine per approved anonymous connection (`sessions.rs:1`, `xpc.rs:28-64`) |
| Frames and refs | shared: client 2 may act on a frame that client 1 captured (`tests/serve_oneshot.rs:88-100`) | per connection |
| Stop paths | shared; a stop from any client suspends all of them | shared across sessions in the process (`sessions.rs:1,59`) |
| ControlSlot | one per process; a second grant is refused, never stolen (`grant.rs:61-82`) | the same |
| Ordering | session requests are serialized FIFO in arrival order across connections; replies are matched to their own connection and id | per connection |
| Disconnect | cancels that connection's input holds only (`connection.rs:132-134`); other clients keep running | cancels everything on that connection (`connection.rs:134`) |

DESIGN §3 still says "one session per connection, UDS like XPC". That sentence
is superseded: per-connection sessions stay XPC-only, because bunshin v1
consumers rely on frames carrying across `--oneshot` calls.

## Attacker models

### M1: another uid on the same host

- **UDS, default endpoint.** The 0700 directory denies `connect`. With P3b, the
  peer uid check closes the connection without a reply, which also covers an
  explicit `--serve` path or a loose directory.
- **UDS, endpoint squatting (open finding F1).** When `XDG_RUNTIME_DIR` is
  unset, the path lives in the shared temp dir. `private_dir` does not check an
  existing directory: `create` with `recursive(true)` succeeds on it without
  changing its mode, and the socket is then named after the directory's
  *owner*, not the caller (`client.rs:25-28,41-49`).
  - The attack: another uid pre-creates `<tmp>/senpi-desktop` with an open
    mode and binds `<its-uid>.sock`.
  - The result: the victim's `--oneshot` / `--mcp` / `--resume` connect to the
    attacker's daemon, which receives the requests and forges the replies.
  - Why P3b's check does not help: the daemon-side peer check protects the
    daemon, not the client.
  - Mitigation, tested under P3b: the SDK `attach` client refuses an endpoint
    whose parent directory is not owned by the caller's uid or is accessible
    to group or other. The same check in the Rust client (`client.rs`) is
    outside P3b's write scope and needs its own issue.
  - Status: found by reading the code, not reproduced here (reproducing it
    needs two uids).
- **Windows pipe.** P3b keeps single-client behavior and refuses a second
  concurrent client until a client-SID check exists. That check is recorded as
  a follow-up, not designed here.
- **XPC.** Refused at accept by the euid check (B2.1).

### M2: a different process, same uid

- **UDS: not stopped.** That process can connect and call every daemon method,
  host-only ones included (B1, method exposure). It can read the 0600 resume
  token and resume a stop. It can kill and restart the daemon, which clears a
  UDS stop (plan row 31 pins this as the v1 behavior). It can read every
  client's frames and refs. It can start the engine binary directly.
- **What still limits it on UDS.** Nothing at the protocol level. On macOS, TCC
  still charges every request to the responsible process (B4); the launch gate
  refuses a self-responsible engine.
- **XPC: stopped**, unless the process is one of our signed binaries (B2.2).

### M3: model code inside an omo kernel (js or py eval)

- **Intended path.** `toolBridge` only; every call passes A5 (B3).
- **Raw socket.** Model code that opens the daemon socket itself is M2. The
  boundary is the eval tool's own permission gate, which decides whether that
  code runs at all (DESIGN §3 spawn, first boundary).
- **Spawning its own engine** (`spawn` inside a session), handled in three
  layers:
  1. The SDK refuses with `ControlRequired{reason: "spawn_inside_session"}`
     when it sees the host-created kernel marker `SENPI_DESKTOP_HOST=1`. The
     marker carries no secret and grants nothing. This refusal is an accident
     guard, not a security boundary: same-uid code can unset the variable.
  2. B4 refuses a self-responsible engine.
  3. An engine started by a kernel that was launched with the
     responsibility-disclaim attribute inherits the kernel as its responsible
     process. TCC then charges the interpreter, which on an ordinary machine
     holds no grant, so every capture and input ends `PermissionDenied`. On a
     machine where the user granted the interpreter, only the eval permission
     gate remains.

### M4: replayed or late connection

- **UDS.** There is no per-message authentication. The connection is the
  authority, and P3b checks the peer once, at accept.
  - Replaying a recorded request line is the same as issuing it, and only a
    peer that passed the check can do it.
  - A late connection joins the shared session. It sees the stop state and the
    frames and refs earlier clients created. It can act on them only through
    the ControlSlot and the stop paths, like any client.
  - The resume token is regenerated on every daemon start (`sessions.rs:43`).
  - A socket fd handed to another process (`SCM_RIGHTS`) keeps the original
    peer's credentials, so handing one over is already same-uid cooperation
    (M2).
- **XPC.** Verification is per message and never cached (`policy.rs:43-52`).
  The approval is finite and the sequence check refuses a replayed or
  reordered message (`senpi-desktop-xpc/src/connection.rs:25-29,172`).

## Refusal table

| Condition | Where | Response | Proven by |
| --- | --- | --- | --- |
| UDS peer euid != daemon euid | `serve.rs` accept -> `peer.rs` (P3b) | close without a reply; one audit line; daemon keeps serving | T25-6 |
| UDS peer credential lookup fails | the same | close without a reply (fail closed) | T25-7 |
| Other uid connects to the default endpoint | kernel (0700 directory) | `connect` fails | OS behavior |
| Endpoint directory not owned by the caller or group/other accessible | SDK `attach` client (P3b) | refuse before connecting | T25-13 |
| Second concurrent Windows pipe client | `serve.rs` (P3b) | refused; the first client continues | T25-8 |
| Host-only method through `--oneshot` / `--mcp` / SDK `attach` | client-side bridge (`oneshot.rs:18-31`) | `hostOnly` rejection | `tests/serve_oneshot.rs:146-157`, T25-12 |
| XPC peer euid differs | `peers.rs:21-25` | connection cancelled | existing XPC tests |
| XPC signature, role, team, hardening, entitlement or epoch failure | `policy.rs:98-164` | message rejected | `policy/tests` |
| XPC approval missing, or sequence mismatch | `senpi-desktop-xpc/src/connection.rs:25-29,172` | message rejected | existing transport tests |
| Engine is its own responsible process, or unresolved | `launch_gate.rs:23-41`, `main.rs:53-56` | refuse before any mode (except `--xpc-agent`) | `tests/launch_gate.rs` |
| `--serve` / `--oneshot` / `--mcp` without `--enable-daemon` | `cli.rs:151` | usage error (accident guard only) | existing CLI tests |
| `spawn` inside an omo session | SDK | `ControlRequired{reason: "spawn_inside_session"}`; the boundary is the eval permission gate plus TCC (M3) | SDK spawn tests |

## Residual risk

1. **Same-uid code is not stopped on UDS.** On UDS, any same-uid process can use
   every daemon method, resume a stop, restart the daemon to clear a stop, and
   read all shared frames. XPC code-signature auth is the only same-uid
   boundary, and kernels use neither transport. Accepted for daemon mode: its
   consumers (bunshin `--oneshot`, `--mcp`, Linux) run as the user.
2. **Endpoint squatting in a shared temp dir** (F1). Open finding: the SDK
   `attach` check ships with P3b, and the Rust client check needs its own
   issue.
3. **Windows pipe.** The ACL is UNVERIFIED and there is no client-SID check;
   single-client behavior is kept until one exists.
4. **Granted interpreter.** TCC grants given to an interpreter remove the TCC
   layer of M3; only the eval permission gate remains.

## Rejected options

- **Environment tokens** (a shared secret in the environment that authenticates
  attach clients). Rejected:
  - Same-uid code can read another process's environment, and kernels inherit
    it, so a token adds no boundary against M2 or M3.
  - It adds secret handling.
  - It risks leaking through process listings.
- **Engine flag exemptions** (a flag that skips the peer check, admits a
  self-responsible engine, or lifts a refusal). Rejected: any same-uid process
  can pass the same flag, so every protection would become opt-out.
  `--enable-daemon` stays an accident guard and gains no exemption meaning.
- **Host-spawned `--serve` for omo's own engine.** Rejected: same-uid processes
  would skip A5 (Q decision 2).
- **Daemon-side host-only filtering on UDS.** Not in this plan. It would not
  stop M2, who can read the token file anyway, and `--resume` needs
  `stopPath.resume` over the socket. Recorded as a possible later hardening.

## Required tests

### P3b: concurrent `--serve` (plan row 25)

| Id | Test |
| --- | --- |
| T25-1 | Two concurrent UDS clients both complete `engine.hello` and `capabilities` |
| T25-2 | Client 2 clicks a frame that client 1 captured (shared refs) |
| T25-3 | Interleaved requests from two clients each get their own reply; the same request id used on both connections does not collide |
| T25-4 | Exec requests from two clients run in arrival order (FIFO across connections) |
| T25-5 | `stopPath.stop` from one client suspends both; the other's next exec is refused as stopped |
| T25-6 | An injected peer-uid mismatch closes the connection before any byte is written (no `engine.hello` reply), writes one audit line, and a same-uid client is still served |
| T25-7 | An injected peer-credential lookup failure is treated as a mismatch |
| T25-8 | Windows: a second concurrent pipe client is refused while the first is connected; single-client behavior is unchanged |
| T25-9 | Client A disconnecting cancels only A's input holds; B's in-flight requests are still answered |
| T25-10 | `--idle-ms` counts from the last client disconnect; the daemon never exits while any client is connected |
| T25-11 | Existing `--oneshot` / `--mcp` tests pass unchanged, including the `hostOnly` refusals (`tests/serve_oneshot.rs:146-157`) |
| T25-12 | The SDK `attach` client refuses host-only methods without sending them |
| T25-13 | The SDK `attach` client refuses an endpoint whose parent directory is not owned by the caller's uid or is accessible to group or other (F1) |
| T25-14 | Residual pin: a raw same-uid socket client is answered for a host-only method, so a future daemon-side filter is a deliberate change rather than drift |

### Stop-marker policy (plan row 31)

| Id | Test |
| --- | --- |
| T31-1 | v1 restart case: stop, `--resume`, kill, restart `--serve`, then `session.open` succeeds and the session is not Suspended |
| T31-2 | Stop-latch tests write no file under the real per-user directory (asserted) |
| T31-3 | The doctor prints the INFO line saying stop persistence exists only on the XPC agent path |
| T31-4 | `docs/reference/computer.md` says, in its stop paragraph, that persistence across restarts is XPC-agent-only |

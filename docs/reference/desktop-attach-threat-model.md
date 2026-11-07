# Desktop engine attach and `--serve` multi-connection threat model (#12229)

This is the security design that has to be in place before the engine's
`--serve` daemon accepts concurrent clients and the desktop SDK ships an
`attach` transport. It does not change any code. It records what today's code
does (cited as `path:line` at `origin/dev` 37c0448f4d) and what the follow-up
changes must do and prove:

- **P3b**: concurrent same-uid `--serve` clients, the peer credential checks,
  the endpoint checks, and the SDK `attach` (UDS) client. This is computer-use
  v2 plan row 25.
- **Stop-marker policy**: stop persistence stays XPC-only, and the daemon
  restart path is pinned for v1 consumers. This is plan row 31.

Reading the references: a "plan row N" is one numbered deliverable of the
computer-use v2 work tracked under #12229, delivered as one PR; "P3a", "P3b"
and "P4b" are phases of that work (P3a is this document, P3b is the
concurrent `--serve` and `attach` change above, and P4b is the later phase
that may run the py kernel as a separate process); a "Q decision N" is a
numbered product decision by the maintainer, restated where it is used; and
"DESIGN §n" names a section of the internal computer-use v2 design notes,
whose relevant content this document restates in place.

Paths are relative to `crates/` unless they start with `packages/` or `docs/`.
A bare file name (`client.rs`, `connection.rs`, `engine.rs`, `main.rs`, ...)
means `senpi-desktop-engine/src/<name>`, and a bare `tests/...` means
`senpi-desktop-engine/tests/...`. Files in other crates carry their crate
prefix (`senpi-desktop-xpc/src/...`, `senpi-desktop-session/src/...`), and
the XPC-only files `peers.rs`, `native.rs`, `agent.rs`, `dictionary.rs`,
`roles.rs` and `policy.rs` mean `senpi-desktop-xpc/src/<name>`.

## Assets

| Id | Asset | Where it lives |
| --- | --- | --- |
| A1 | Desktop input authority: synthesized keyboard and mouse in the user's session | the session's backend; the foreground grant is held in the one `ControlSlot` per process (`senpi-desktop-session/src/grant.rs:1-7,61-82`) |
| A2 | Screen content: captures, frames, element refs, the artifact dir, the audit log | the daemon session opened from its CLI flags (`senpi-desktop-engine/src/daemon.rs:1-4,26-42,50-72`) |
| A3 | Stop authority: stop paths, latched stop, the resume token | **UDS daemon:** the token is random per process (`engine.rs:60-62`) and written by `daemon.rs:70-71` through `write_token`, 0600 at creation on unix (`daemon.rs:84-94`; the non-unix writer at `daemon.rs:97-100` sets no mode). **XPC agent:** `StopPaths` are shared by its sessions (`sessions.rs:1,34-47`; `sessions` compiles only under `cfg(any(test, target_os = "macos"))`, `main.rs:21-22`) and the persistent latch exists only there (`stop_latch.rs:1`, `sessions.rs:26-32`) |
| A4 | TCC grants (Accessibility, Screen Recording) of the responsible process | macOS charges requests to the responsible process (`senpi-desktop-backend-macos/src/launch_gate.rs:3-12`) |
| A5 | The omo host's per-call permission preflight (`computer:read` / `computer:exec`) | the tool pipeline; kernels reach the engine only through it (`toolBridge`) |
| A6 | Request content in transit: `typeText` text, `clipboard.write` content, the `--resume` token | the request lines a client sends to whatever answers at the endpoint |

## Trust boundaries

### B1: UDS `--serve` (Linux, macOS daemon mode)

- **Today.** The listener binds the endpoint and serves one client at a time
  (`senpi-desktop-engine/src/serve.rs:1-4,30-46`). It does no peer credential
  check. The only access control is the directory.
  - The default endpoint is `$XDG_RUNTIME_DIR/senpi-desktop/<uid>.sock`, or the
    same path under the temp dir (`client.rs:15-29`).
  - The directory is created 0700 only when it does not exist yet. On an
    existing directory, `create` with `recursive(true)` succeeds and changes
    neither mode nor owner. The socket is then named after the directory's
    *owner*, not the caller (`client.rs:41-49`).
  - An explicit `--serve <path>` outside that directory has no protection
    beyond the socket file mode, which the umask sets.
- **The directory rule** (daemon and clients). The rule covers two
  components:
  - **The endpoint's parent:** not a symlink, owned by the caller's euid, and
    no group or other permission bits.
  - **The grandparent:** owned by the caller's euid or by root, and not
    writable by group or other unless it is sticky (like the 1777 `/tmp`).
    Anything else is refused. This is one rule: a root-owned 0755 grandparent
    passes, and a non-sticky group- or other-writable one fails.

  The rule binds every endpoint, including whatever bunshin passes as
  `--endpoint`. A sticky `/tmp` blocks swapping the victim's directory but not
  pre-creating it; the ownership check on the parent catches the
  pre-creation squat.

  The rule checks two levels only. A writable ancestor three or more levels up
  lets another uid swap the whole subtree between a path-based check and a
  path-based `bind` or `connect`. That is why the directory rule is not the
  last line on any platform: the server-uid check below (client side) is what
  stops a client from talking to a swapped-in socket.
- **P3b target, daemon side.** The daemon applies the rule through a directory
  fd, not by path:
  - It opens the parent with `O_DIRECTORY|O_NOFOLLOW` and `fstat`s that fd.
  - It binds through the fd (`/proc/self/fd/<n>/<name>` on Linux). macOS has
    no fd-relative bind, so there the bind goes by path after the fd check. A
    subtree swap above the grandparent can then relocate the daemon's socket;
    that degrades to denial of service, because the client's server-uid check
    refuses any socket the daemon's euid does not serve, and the peer check
    closes an attacker that reaches the relocated socket.

  Startup order:
  0. **Take the instance lock first.** Lock semantics, end to end: the lock
     is taken exactly once, at start, with one non-blocking try
     (`flock(LOCK_EX|LOCK_NB)`) on a lock file opened with `openat` relative to
     the parent fd (`O_CREAT|O_NOFOLLOW`, mode 0600). Nothing ever waits on
     it. A daemon whose try succeeds holds the lock for its whole life,
     including its idle exit, and never re-acquires it; every step below and
     the exit cleanup run under that one hold. A daemon whose try fails (a
     daemon is running, starting or still exiting) exits non-zero at once,
     without touching the socket or the token. A start refused while the
     previous daemon is still exiting succeeds only because P3b changes the
     client to retry the whole start ("Start retry" under P3b target,
     client side). Today's client does not: `exchange_or_start` starts the
     daemon once (`client.rs:120`) and then only reconnects until
     `START_GUARD` runs out (`client.rs:121`, loop at `client.rs:79-85`), so
     with today's client a refused successor leaves nothing bound and the
     client fails with "daemon did not start". This one rule covers every
     start, not only a cold one:
     - **Already-running daemon:** `--serve` on a live endpoint, or an
       auto-start that lost to a live daemon, exits without unlinking the live
       socket or overwriting the live token. The client then connects to the
       live daemon.
     - **Two daemons recovering one stale socket:** without the lock, both
       fail to `connect` and both unlink, so the second unlinks the first's
       fresh socket and orphans it. The lock admits only one.
     - **Restart while the old daemon is exiting, or an orphan's idle exit:**
       today the idle exit removes the socket by path
       (`std::fs::remove_file(endpoint)`, `serve.rs:44`), which deletes a
       live successor's socket. The exiting daemon must first close its
       listener fd, then remove its socket and token. Stopping accepts
       while the listener stays open is not enough: a client's `connect`
       still completes into the backlog and is reset when the fd closes,
       losing the request. The removal runs under the hold it took at start (it
       does not take the lock again, so the exit never blocks), and only if
       the socket's inode (device and inode from `lstat`) is still the one
       it bound. It closes the lock fd last, which releases the lock. A
       successor that tries the lock during this window is refused, exits
       non-zero, and the P3b client start retry starts it again after the
       release. The inode check covers a socket replaced by anything
       else (a same-uid process, or a daemon started without the lock).

     The lock is held across the probe `connect`, the stale-socket unlink, the
     bind and the token write. Without it, two daemons auto-started after a
     SIGKILL both fail `connect` on the stale file, both unlink it and both
     bind, the second unlink removing the first's fresh socket. Both then
     write the token, so the last writer wins, possibly for the daemon nobody
     can reach, and `--resume` breaks. The orphan later idle-exits and removes
     the successor's socket by path.

     The lock is the same-uid instance guard only. It is not a security
     boundary: a same-uid process can hold it to keep the daemon down, which
     is the M2 denial of service already conceded.
  1. **Bind.** A stale socket file, left by a killed daemon (the socket is
     removed only at idle exit: `serve.rs:44`), is unlinked only after a
     `connect` to it fails, and only inside the already-checked parent. A
     killed daemon's lock is released by the kernel, so a restart can take it.
  2. **Write the resume token only after a successful bind.** The token is
     created with `openat` relative to the parent fd, using
     `O_CREAT|O_EXCL|O_NOFOLLOW` and mode 0600, after unlinking any existing
     file. Today the token is written before the bind (`main.rs:131-132`).
     When two clients race to auto-start (`client.rs:117-127`), the losing
     daemon overwrites the winner's token and then fails `bind`, so
     `--resume` breaks until a restart.

  After `accept`, the daemon reads the peer's effective uid (`getpeereid` on
  macOS/BSD, `SO_PEERCRED` on Linux) in a new `peer.rs`. If that uid is not
  the daemon's euid, or the lookup fails, it closes the connection without
  writing a byte and writes one audit line.

  A race against these checks in a shared grandparent degrades to denial of
  service, not a boundary loss:
  - `O_EXCL|O_NOFOLLOW` keeps the token 0600 and owned by the victim.
  - The peer check closes an attacker that reaches a relocated socket.
  - The client's fd check refuses an attacker-owned parent (Linux), and on
    every platform the client's server-uid check refuses a socket not served
    by its own euid.

  If P3b shipped the daemon check without both the peer check and the client
  fd check, the race would become a boundary loss.
- **P3b target, client side.** The Rust client (`--oneshot`, `--mcp`,
  `--resume`: `client.rs`) and the SDK `attach` client apply the same directory
  rule before they connect or auto-start a daemon. The check must not be a
  stat-then-connect sequence. Open the directory with `O_DIRECTORY|O_NOFOLLOW`,
  `fstat` that fd, and connect relative to it (`/proc/self/fd/<n>/<name>` on
  Linux; `connectat` exists only on FreeBSD). macOS has no fd-relative
  connect, so there the connect goes by path after the check.

  **Start retry (required P3b client change).** When the connect after an
  auto-start fails, the Rust client must start the daemon again, not only
  reconnect, until `START_GUARD` (`client.rs:11`) runs out. Today
  `exchange_or_start` calls `start_detached` once (`client.rs:120`) and then
  only reconnects (`client.rs:121`, loop at `client.rs:79-85`). Without this
  change, a successor refused the instance lock while the previous daemon is
  exiting leaves nothing bound.

  The client also retries a request once when its connection is reset before
  the first reply byte arrives, which covers a `connect` that reached an
  exiting daemon just before it closed its listener. A reset after the first
  reply byte is an error, not a retry. A daemon that crashes mid-request also
  resets before replying, so the retried request may already have run; that
  is why the retry is limited to one.

  **Server-uid check (every platform with UDS).** After `connect` and before
  writing the first byte, the client reads the server's effective uid on the
  connected socket (`getpeereid` on macOS/BSD, `SO_PEERCRED` on Linux). If it
  is not the client's own euid, or the lookup fails, the client closes the
  socket without sending anything and refuses to auto-start a daemon at that
  endpoint. This check is on the connected socket itself, so a subtree swap
  at any ancestor level cannot defeat it: a swapped-in socket is served by
  the attacker's uid. It is the UDS counterpart of B3's Windows client-side
  server check, and it is what keeps A6 (request content) from reaching
  another uid when the directory rule is raced.
- **Strength.** This stops other uids. It does not stop a different process
  running as the same uid: every same-uid peer is equally trusted.
- **Method exposure is client-side.** The host-only filter (`session.open`,
  `control.grant`, `stopPath.resume`, ...: `senpi-desktop-core/src/methods.rs:89-130`)
  runs in the `--oneshot` / `--mcp` client process (`oneshot.rs:1-5,18-31`). The
  daemon's line handler routes every method it parses
  (`connection.rs:174-218`, `route.rs:27-30`). `--mcp` deliberately forwards
  one host-only method, `stopPath.heartbeat`, when started with
  `--allow-host-relay-only-stop` (`mcp/catalog.rs:25-30`, `mcp/call.rs:21-22`). `--resume` relies on that: it
  sends `stopPath.resume` over the socket with the token from the token file
  (`client.rs:162-177`).

### B2: XPC agent (`--xpc-agent`, macOS only)

Each check below must pass before the next one runs:

1. **Same euid at accept.** The connection is cancelled if the peer's euid
   differs (`senpi-desktop-xpc/src/peers.rs:21-25`, `native.rs:97-101`).
2. **Code-signature peer auth.** The listener carries a code-signing
   requirement. Every received message is also verified on its own
   (`agent.rs:140-146` -> `dictionary.rs:78-85` -> `policy.rs:98-164`):
   - team `523JNR86LZ` and a fixed identifier per role (`roles.rs:1-30`);
   - a valid signature;
   - hardened (runtime, hard, kill) and not debugged;
   - none of the forbidden entitlements;
   - the current security epoch.

   A verification result covers one message and is never cached or cloned
   (`policy.rs:43-52`).
3. **Finite approval and replay boundary per live connection.** A capability is
   bound per connection, and the approval and message sequence are checked
   (`senpi-desktop-xpc/src/connection.rs:1,63-77,166-182`).
4. **Engine admission.** Only after the checks above does the engine accept a
   valid `session.open`, and it uses no environment-selected backend
   (`senpi-desktop-engine/src/xpc.rs:68-116`).

**Strength.** This is the only boundary in the design that stops a same-uid
process. Such a process cannot speak to the engine unless it is one of our
signed, hardened, non-debugged binaries in the expected role. Code execution
inside such a binary is out of scope.

### B3: Windows named pipe (`--serve`)

- **Today.** The default endpoint is the predictable global name
  `\\.\pipe\senpi-desktop-<USERNAME>` (`client.rs:21-23`). The pipe is created
  with `first_pipe_instance(true)` and the default security descriptor
  (`serve.rs:48-63`).
  - The server checks nothing about the client.
  - The client opens whatever answers with plain read/write `OpenOptions`
    (`client.rs:104-107`). It sets no `SECURITY_SQOS_PRESENT |
    SECURITY_IDENTIFICATION` and does not check the server.
  - The access the default descriptor grants to other accounts is UNVERIFIED in
    this document.
- **P3b target.** P3b keeps single-client behavior and refuses a second
  concurrent client. It ships no Windows peer check.
- **Follow-up.** The Windows follow-up (one issue) needs both sides:
  - **Client:** open with `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`, and
    verify the server before sending anything: the user SID of the token of
    `GetNamedPipeServerProcessId` must equal the caller's.
  - **Server:** check the client SID, then admit concurrent clients.

### B4: omo-hosted kernels never attach

The js and py kernels' `computer` global goes through `toolBridge`, which is one
`tool.computer` call per helper. That keeps the host's per-call preflight (A5)
on every call. Kernels use neither `attach` nor `spawn` (DESIGN §3 attach,
§6). The omo host never starts its own engine as `--serve`: that would let any
same-uid process skip A5 (Q decision 2, MCP exposure).

The SDK ships into the kernels as a prelude asset that includes the `attach`
transport. It therefore refuses `attach` with
`ControlRequired{reason: "attach_inside_session"}` when it sees the
host-created kernel marker `SENPI_DESKTOP_HOST=1`, the same way it refuses
`spawn` (M3). This catches naive model code attaching to the user's running
daemon and silently skipping A5. It is an accident guard, not a boundary; the
boundary is the eval permission gate.

### B5: Launch and responsibility (macOS)

Every mode except `--xpc-agent` runs the #10207 gate first (`main.rs:45-56`).
That gate refuses an engine that is its own responsible process, or one whose
responsible process cannot be resolved (`launch_gate.rs:14-41`). A launchd job
gets no exception (`launch_gate.rs:10-12`). On other platforms the gate is a
no-op (`main.rs:158`). `--enable-daemon` only prevents an accidental daemon; it
is not a protection (`cli.rs:34-37`).

## Session model: shared on UDS, per connection on XPC only

| | UDS `--serve` daemon (P3b) | XPC agent |
| --- | --- | --- |
| Session | ONE session, opened by the daemon itself from its CLI flags (`daemon.rs:50-72`, `main.rs:126-135`). A bridge client cannot open its own (`session.open` is host-only at the bridge: `tests/serve_oneshot.rs:143-154`), but a raw socket client can call `session.open`, which re-creates the backend for everyone (see M2) | one Engine per approved anonymous connection (`sessions.rs:1,50-62`, `xpc.rs:39-43`) |
| Frames and refs | shared: client 2 may act on a frame that client 1 captured (`tests/serve_oneshot.rs:88-100`) | per connection |
| Stop paths | shared; a stop from any client suspends all of them | shared across sessions in the process |
| Foreground grant | one session, so the grant is that session's. Any client's `control.grant` re-grants with a fresh generation (`grant.rs:150-172`), and the grant then covers every client | one `ControlSlot` per process; a second session's grant is refused `InputBusy`, never stolen (`grant.rs:1-7,150-172`) |
| Ordering | session requests are serialized FIFO in arrival order across connections; replies are matched to their own connection and id | per connection |
| Notifications | today one engine-wide `Outbox` takes every audit event and `stopPath.changed` (`engine.rs:92-96`), and whichever connection is delivering a reply drains all of them (`connection.rs:240-250`), so with concurrent clients a notification reaches one arbitrary connection. P3b broadcasts every notification to every live connection (T25-18) | per connection |
| Disconnect | cancels that connection's input holds only (`connection.rs:132-134`); other clients keep running | cancels everything on that connection (`connection.rs:134`) |

DESIGN §3 still says "one session per connection, UDS like XPC". That sentence
is superseded: per-connection sessions stay XPC-only, because bunshin v1
consumers rely on frames carrying across `--oneshot` calls.

## Attacker models

### M1: another uid on the same host

**UDS, default endpoint, private parent.** The 0700 directory denies `connect`.
With P3b, the peer uid check closes the connection without a reply, which also
covers an explicit `--serve` path or a loose directory.

**UDS, shared temp parent: squatting (F1).**

- **Precondition.** The parent is shared and non-sticky at the
  `senpi-desktop` level. That happens on Linux without `XDG_RUNTIME_DIR` and
  with `TMPDIR` unset or shared, or on macOS with `TMPDIR` unset (the normal
  macOS `$TMPDIR` is per-user).
- **Setup.** Another uid pre-creates `<tmp>/senpi-desktop` with an open mode.
  Every consequence below follows from `client.rs:41-49` and is verified by
  reading the code, not reproduced here (reproducing needs two uids):
  - **Client spoofing and confidentiality loss.** The victim's `--oneshot`,
    `--mcp` and `--resume` connect to `<tmp>/senpi-desktop/<attacker-uid>.sock`.
    If the attacker answers there, it receives every request (A6) and forges
    every reply.
  - **Hijack after a real daemon is up.** If nothing answers,
    `exchange_or_start` starts a real victim daemon on that path
    (`client.rs:114-143`). Its socket inode then lives in a directory the
    attacker controls, so the attacker can unlink or replace it at any time.
  - **Token write through attacker-planted files.** Before binding,
    `main.rs:131` runs `open_daemon_session`, which writes
    `<attacker-dir>/<attacker-uid>.resume` with
    `write|create|truncate` and neither `O_NOFOLLOW` nor `O_EXCL`
    (`daemon.rs:84-94`).
    - A pre-planted symlink makes the victim's daemon truncate and overwrite
      any file the victim can write. `fs.protected_symlinks` does not apply,
      because the directory is not sticky.
    - A pre-created attacker-owned 0666 file receives the token, which the
      attacker can then read, since mode 0600 applies only at creation. That
      defeats A3.
- **Mitigation (P3b scope, not a separate issue).** P3b ships the daemon-side
  directory check and the `O_EXCL|O_NOFOLLOW` token write (B1). It also ships
  the same fd-based directory check in both the Rust client and the SDK
  `attach` client.
- **Tests:** T25-13, T25-15, T25-16, T25-17.

**Windows pipe-name squatting.**

- **Attack.** Any account can create `\\.\pipe\senpi-desktop-<USERNAME>` first.
  `first_pipe_instance(true)` (`serve.rs:52`) then makes the victim's own
  daemon fail to create the pipe. The victim's client opens the attacker's
  pipe without checking it (`client.rs:104-107`). The attacker receives every
  request (A6) and forges every reply.
- **Impersonation.** Because the client sets no SQOS flags, a server holding
  `SeImpersonatePrivilege` can impersonate the victim's client token.
- **Mitigation.** The Windows follow-up described in B3. Until it lands, the
  Windows daemon endpoint is not a boundary against other accounts. This is
  recorded under residual risk.

**XPC.** Refused at accept by the euid check (B2.1).

### M2: a different process, same uid

- **UDS: not stopped.** That process can connect and call every daemon method,
  host-only ones included (B1, method exposure). In particular:
  - **`control.grant`.** It grants itself the foreground control grant that is
    meant to be human-confirmed (`grant.rs:1-7`), with no human in the loop,
    and the grant then covers every client (session table).
  - **`session.open`.** It re-creates the backend with the caller's options,
    including `audit_path` and `artifact_dir`, so it can re-point the daemon's
    audit log. It also invalidates every client's refs and frames
    (`senpi-desktop-session/src/worker.rs:85-120`), and rewrites the engine's
    stop policy (`allow_host_relay_only`) for every client (`route.rs:56-61`).
  - **The resume token.** It can read the token file, or receive the token in
    a `session.open` reply (`engine.rs:171-177,221-224`, `stop_path.rs:5-7`),
    and resume a stop.
  - **Other clients' notifications.** It receives audit events and stop-path
    changes caused by other clients (session table, Notifications).
  - **Daemon restart.** It can kill and restart the daemon, which clears a UDS
    stop even when nobody resumed it (plan row 31 pins this as the v1
    behavior, T31-5).
  - **Shared content.** It can read every client's frames and refs.
  - **The engine binary.** It can start the engine directly.
- **What still limits it on UDS.** Nothing at the protocol level. On macOS, TCC
  still charges every request to the responsible process (B5), and the launch
  gate refuses a self-responsible engine.
- **XPC: stopped**, unless the process is one of our signed binaries (B2.2).

### M3: model code inside an omo kernel (js or py eval)

- **Intended path.** `toolBridge` only; every call passes A5 (B4).
- **Raw socket.** Model code that opens the daemon socket itself is M2. The
  boundary is the eval tool's own permission gate, which decides whether that
  code runs at all (DESIGN §3 spawn, first boundary).
- **Spawning its own engine** (`spawn` inside a session), handled in three
  layers:
  1. **The SDK accident guard.** The SDK refuses with
     `ControlRequired{reason: "spawn_inside_session"}` when it sees the
     host-created kernel marker `SENPI_DESKTOP_HOST=1`. The marker carries no
     secret and grants nothing. This refusal is not a security boundary:
     same-uid code can unset the variable.
  2. **The launch gate.** B5 refuses a self-responsible engine.
  3. **TCC (P4b-conditional; no code for it exists today).** An out-of-process
     kernel (py) launched with `POSIX_SPAWN_SETDISCLAIM` becomes its own
     responsible process, and an engine it starts inherits it. TCC then
     charges the interpreter, which on an ordinary machine holds no grant, so
     every capture and input ends `PermissionDenied`.
     - **Grants on the interpreter:** if the user granted the interpreter, this
       layer does not stand.
     - **In-process kernels (js in the host process):** this layer does not
       exist. An engine spawned from such a kernel inherits the host's
       responsible process and its grants.
     - **What remains in both cases:** only layer 1's eval permission gate.

### M4: replayed or late connection

- **UDS.** There is no per-message authentication. The connection is the
  authority, and P3b checks the peer once, at accept.
  - Replaying a recorded request line is the same as issuing it, and only a
    peer that passed the check can do it.
  - A late connection joins the shared session. It sees the stop state and the
    frames and refs earlier clients created. It can act on them only through
    the grant and the stop paths, like any client.
  - The daemon's resume token is regenerated on every daemon start
    (`engine.rs:60-62`, written at `daemon.rs:70-71`).
  - A socket fd handed to another process (`SCM_RIGHTS`) keeps the original
    peer's credentials, so handing one over is already same-uid cooperation
    (M2).
- **XPC.** Every message is verified, and the result is never cached
  (`agent.rs:140-146`, `policy.rs:43-52`). The approval is finite, and the
  sequence check refuses a replayed or reordered message
  (`senpi-desktop-xpc/src/connection.rs:166-182`).

## Refusal table

| Condition | Where | Response | Proven by |
| --- | --- | --- | --- |
| UDS peer euid != daemon euid | `serve.rs` accept -> `peer.rs` (P3b) | close without a reply; one audit line; daemon keeps serving | T25-6 |
| UDS peer credential lookup fails | the same | close without a reply (fail closed) | T25-7 |
| Other uid connects to a private default endpoint | kernel (0700 directory) | `connect` fails | OS behavior |
| Endpoint parent is a symlink, not owned by the daemon's euid, or group/other accessible | daemon start (P3b) | refuse to start; no token written, no bind | T25-15 |
| Token path exists (file or symlink) when the daemon writes it | daemon start (P3b) | unlink, then `O_EXCL\|O_NOFOLLOW` create; a symlink target is never written | T25-16 |
| Endpoint parent fails the same rule | Rust client and SDK `attach` client (P3b), fd-based | refuse before connecting or auto-starting | T25-13, T25-17 |
| Second concurrent Windows pipe client | `serve.rs` (P3b) | refused; the first client continues | T25-8 |
| Windows client facing an unverified pipe server | Windows follow-up (client) | refuse before sending | follow-up issue |
| UDS client connected to a socket whose server euid != the client's euid, or whose server credential lookup fails | Rust client and SDK `attach` client (P3b) | close before sending a byte; no auto-start at that endpoint | T25-25 |
| Host-only method through `--oneshot` / `--mcp` / SDK `attach` | client-side bridge (`oneshot.rs:18-31`) | `hostOnly` rejection | `tests/serve_oneshot.rs:143-154`, T25-12 |
| XPC peer euid differs | `peers.rs:21-25` | connection cancelled | existing XPC tests |
| XPC signature, role, team, hardening, entitlement or epoch failure | `policy.rs:98-164` | message rejected | `policy/tests` |
| XPC approval missing, or sequence mismatch | `senpi-desktop-xpc/src/connection.rs:166-182` | message rejected | existing transport tests |
| Engine is its own responsible process, or unresolved | `launch_gate.rs:23-41`, `main.rs:53-56` | refuse before any mode (except `--xpc-agent`) | `tests/launch_gate.rs` |
| `--serve` / `--oneshot` / `--mcp` without `--enable-daemon` | `cli.rs:151` | usage error (accident guard only) | existing CLI tests |
| `attach` inside an omo session | SDK | `ControlRequired{reason: "attach_inside_session"}` (accident guard, not a boundary; the boundary is the eval permission gate) | T25-21 |
| Stale socket at the endpoint | daemon start (P3b) | unlinked only after a failed `connect`, inside the checked parent | T25-20 |
| A second daemon racing a cold start | daemon start (P3b) | instance lock refused before bind; no token written; the first daemon's token is untouched | T25-19 |
| A daemon started while one is already running (explicit `--serve` or a lost auto-start) | daemon start (P3b) | instance lock refused; exits non-zero; the live socket and token are untouched; clients use the live daemon | T25-22 |
| Two daemons recovering the same stale socket | daemon start (P3b) | only the lock holder unlinks and binds; the other exits | T25-23 |
| A daemon exiting while its successor starts, or an orphan's idle exit | daemon exit (P3b) | the exiting daemon closes its listener fd, then removes its socket and token under the hold it took at start (no re-acquire, no wait), only if the socket's inode is the one it bound, then releases the lock; a successor refused during the exit exits non-zero and the P3b client start retry (a required client change; today's client starts once) starts it after the release | T25-24 |
| `spawn` inside an omo session | SDK | `ControlRequired{reason: "spawn_inside_session"}` (accident guard). The boundary is the eval permission gate, plus TCC only for a P4b out-of-process kernel without interpreter grants (M3) | SDK spawn tests |

## Residual risk

1. **Same-uid code is not stopped on UDS.** On UDS, any same-uid process can:
   - use every daemon method;
   - self-grant the foreground grant with no human;
   - re-point the audit log through `session.open`;
   - rewrite the stop policy (`allow_host_relay_only`) for every client
     through `session.open` (`route.rs:56-61`);
   - resume a stop, or restart the daemon to clear one;
   - read all shared frames;
   - receive audit events and stop-path changes caused by other clients.

   XPC code-signature auth is the only same-uid boundary, and kernels use
   neither transport. Accepted for daemon mode, whose consumers (bunshin
   `--oneshot`, `--mcp`, Linux) run as the user. The self-grant, the audit
   re-point and the stop-policy rewrite are named here so that this
   acceptance is an explicit decision.
2. **Windows pipe.** Another account can squat the pipe name, read every
   request and forge replies, and SQOS impersonation is possible, until the
   Windows follow-up (B3) lands. The ACL is UNVERIFIED.
3. **Granted interpreter or in-process kernel.** In either case, TCC is no
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
  - `--enable-daemon` stays an accident guard and gains no exemption meaning.
  - The P3b peer-check failure tests (T25-6, T25-7) inject through a
    compile-time `#[cfg(test)]` seam only.
  - No environment variable or flag that a non-test build honors may change
    the peer check, unlike the existing fake-backend environment hooks
    (`config.rs:31-37,55-60`, `stop_path.rs:33-36`).
- **Host-spawned `--serve` for omo's own engine.** Rejected: same-uid processes
  would skip A5 (Q decision 2).
- **Daemon-side host-only filtering on UDS.** Not in this plan.
  - **What it would stop:** an accidental or naive raw client calling
    `control.grant`, `stopPath.start` or `session.open`. None of those need the
    token, so the filter would remove the silent self-grant, the audit
    re-point, and the token leak through the `session.open` reply from casual
    misuse.
  - **What it would not stop:** M2, which can start its own engine or replace
    the daemon.
  - **What it would break:** `--resume`, which needs `stopPath.resume` over the
    socket.
  - **Status:** recorded as a candidate later hardening for Q to weigh against
    residual risk 1.

## Required tests

### P3b: concurrent `--serve` (plan row 25)

| Id | Test |
| --- | --- |
| T25-1 | Two concurrent UDS clients both complete `engine.hello` and `capabilities` |
| T25-2 | Client 2 clicks a frame that client 1 captured (shared refs) |
| T25-3 | Interleaved requests from two clients each get their own reply; the same request id used on both connections does not collide |
| T25-4 | Exec requests from two clients run in arrival order (FIFO across connections) |
| T25-5 | `stopPath.stop` from one client suspends both; the other's next exec is refused as stopped |
| T25-6 | In-crate unit test against `listen` / `serve_connection` (the integration harness runs the non-test binary, so it cannot reach the seam): a peer-uid mismatch injected through a `#[cfg(test)]` seam closes the connection before any byte is written (no `engine.hello` reply), writes one audit line, and a same-uid client is still served; no environment variable or flag in a non-test build reaches the seam |
| T25-7 | In-crate unit test, same seam: a peer-credential lookup failure is treated as a mismatch |
| T25-8 | Windows: a second concurrent pipe client is refused while the first is connected; single-client behavior is unchanged |
| T25-9 | Client A disconnecting cancels only A's input holds; B's in-flight requests are still answered |
| T25-10 | `--idle-ms` counts from the last client disconnect; the daemon never exits while any client is connected |
| T25-11 | Existing `--oneshot` / `--mcp` tests pass with their harness endpoint directories created 0700 (today `create_dir_all` under the temp dir: `tests/serve.rs:36-37`, `tests/serve_oneshot.rs:26-27`) and assertions unchanged, including the `hostOnly` refusals (`tests/serve_oneshot.rs:143-154`) and the `--mcp` heartbeat relay under `--allow-host-relay-only-stop` |
| T25-12 | The SDK `attach` client refuses host-only methods without sending them |
| T25-13 | The SDK `attach` client refuses an endpoint whose parent directory is a symlink, not owned by the caller's uid, or accessible to group or other, and checks through a directory fd, not stat-then-connect |
| T25-14 | Residual pin: a raw same-uid socket client is answered for a host-only method, so a future daemon-side filter is a deliberate change rather than drift |
| T25-15 | The daemon refuses to start (no bind, no token file) when the endpoint's parent is a symlink, owned by another uid, or group/other accessible |
| T25-16 | With a symlink or a pre-existing file at the token path, the daemon never writes through the symlink and never writes into the pre-existing inode; the new token file is 0600 and owned by the daemon's euid |
| T25-17 | The Rust client (`--oneshot`, `--mcp`, `--resume`) refuses, and does not auto-start a daemon, when the endpoint's parent fails the same rule |
| T25-18 | A notification (audit event, `stopPath.changed`) caused by client A reaches every live connection, not one arbitrary connection |
| T25-19 | Two clients that find no daemon both auto-start: one daemon serves, the loser is refused the instance lock without binding or writing a token, and `--resume` works with the surviving daemon's token |
| T25-20 | After a daemon is SIGKILLed, a restart takes the released lock, unlinks the stale socket (only after a failed `connect`, inside the checked parent) and binds |
| T25-21 | The SDK refuses `attach` with `ControlRequired{reason: "attach_inside_session"}` when `SENPI_DESKTOP_HOST=1` is set |
| T25-22 | With a daemon already serving, a second `--serve` on the same endpoint (and an auto-start that finds it) fails its one non-blocking lock try and exits non-zero at once (no wait); the live daemon's socket inode and token bytes are unchanged, and an existing client keeps being served |
| T25-23 | Two daemons started together over a stale socket: exactly one wins the non-blocking lock try and binds, the other exits non-zero without unlinking anything; the socket that remains is the one the lock holder bound, and its token matches that daemon |
| T25-24 | A client that auto-starts while the previous daemon is idle-exiting: the first start is refused the lock and exits non-zero, the exiting daemon never blocks on the lock and removes only its own socket and token (inode check), and the client's start retry (the required P3b client change) brings up a daemon that serves within the start guard. A client whose `connect` lands while the old daemon is exiting still gets its reply: the exiting daemon closes its listener before removing the socket, and a reset before the first reply byte is retried once. The same scenario with today's start-once client fails with "daemon did not start", which pins that the change was made. Separately, a daemon whose socket was replaced by another process idle-exits without removing the replacement or its token |
| T25-25 | The Rust client and the SDK `attach` client, connected to a socket served by another euid (injected through an in-crate `#[cfg(test)]` seam on the connected socket) or whose credential lookup fails, close before writing any byte and do not auto-start; no environment variable or flag in a non-test build reaches the seam |
| T25-26 | After a SIGKILL, two concurrent auto-starts (two `--oneshot` clients at once) leave exactly one daemon bound, the token file matches that daemon, `--resume` works, and the losing daemon never unlinks the winner's socket |

### Stop-marker policy (plan row 31)

| Id | Test |
| --- | --- |
| T31-1 | v1 restart case: stop, `--resume`, kill, restart `--serve` (the restart relies on the stale-socket handling of T25-20); then `desktop.stopPath.status` reports not suspended and an admitted `desktop.click` succeeds (the daemon opens its own session; `desktop.session.open` stays `hostOnly` at the bridge) |
| T31-2 | Stop-latch tests write no file under the real per-user directory (asserted) |
| T31-3 | The doctor prints the INFO line saying stop persistence exists only on the XPC agent path |
| T31-4 | `docs/reference/computer.md` says, in its stop paragraph, that persistence across restarts is XPC-agent-only |
| T31-5 | UDS stop is cleared by a restart (the behavior M2 and residual risk 1 rely on): stop, no `--resume`, kill, restart `--serve`; then `desktop.stopPath.status` reports not suspended. T31-1 alone cannot prove this, because its stop is already lifted before the kill |

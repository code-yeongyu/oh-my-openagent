# @oh-my-opencode/senpi-desktop-service

Runs one `senpi-desktop-engine` child process per agent session and talks JSON-RPC to it over stdio. It also runs each `computer` tool call's steps against the desktop facade over that engine. It executes no model-written code: model code lives in the eval kernel, which calls the tool once per helper.

## `DesktopService`

- The child starts lazily. `open(params)` spawns it, sends `engine.hello` (the ABI must match, otherwise it throws `DesktopEngineAbiMismatchError`), then sends `session.open`, forwarding `params` unchanged. The `resumeToken` in the reply stays inside the service. Only `resume()` sends it back, as `stopPath.resume {token}`.
- `ensureStopPath(chord)` sends `stopPath.start {chord}` once per chord. Asking again for the same chord only reads `stopPath.status`. `stop()` sends `stopPath.stop {source: "host-relay"}`.
- `call(method, params, {signal, timeoutMs})` multiplexes requests by id, so replies may arrive in any order. An abort or an expired timeout sends `$/cancel {id}`. If the engine has not answered `GRACE_MS` (750 ms) later, the service kills the child and rejects with `desktop engine restarted; captures and ax refs were reset` (`engineRestarted: true`). The next call starts a fresh child and replays `session.open`, the armed chord, and any stop latch.
- While a session is open, `stopPath.heartbeat` goes out every `HEARTBEAT_MS` (500 ms). When the child exits, every pending call rejects with `DesktopServiceError` code `Closed`.
- `open` and `close` run one at a time. Calls run concurrently because the engine serializes mutations itself. `close()` sends `session.close`, ends stdin, and kills the child if it has not exited within `CLOSE_TIMEOUT_MS` (1.5 s). Starting times out after `START_TIMEOUT_MS` (10 s) with `Timed out starting desktop engine`.
- Notifications: `onAudit(cb)` receives `audit` and `onStopPathChange(cb)` receives `stopPath.changed`. `onError(cb)` receives heartbeat failures and malformed notifications. The engine persists audit records and enforces every policy (capture budget, stop policy). The service only forwards them.
- Tests inject a `ChildFactory` that runs `test/fake-engine.mjs` through `node`.

## `runComputerSteps`

- `runComputerSteps({toolCallId, snapshot, timeoutMs, signal}, {service, confirmControl?}, program)` runs one tool call's `program` against a desktop facade bound to that call and resolves to `ComputerRunOk {displays, returnValue, screenshots, audit}`. `program` is host-written data interpretation, never model code: `interpretChain(desktop, chain)` for a `call` chain, the `computer_actions` step interpreter for a CUA batch. It receives `{desktop, sleep}`.
- `interpretChain` executes the chain as data: the first step on the facade, each next step on the handle the previous one resolved to. A dotted method (`clipboard.read`, `menu.select`) is a member path, and arguments cross as JSON. A name that is no facade function throws `<method> is not a function`; the tool classified every name against the tier tables before.
- The call's signal aborts on the caller's `signal`, on `timeoutMs`, or when the call ends. Every engine request carries it, so an aborted or timed-out call sends `$/cancel` for its in-flight request and rejects at once with `ComputerRunError` (`aborted` or `timeout`). A failed or aborted call revokes the control grant.
- Facade methods on the desktop root, window handles, and element handles pass through `guardRun`. In a read-only call, a method tagged `exec` in the `-protocol` tier tables (`DESKTOP_METHODS`, `WINDOW_METHODS`, `ELEMENT_METHODS`) throws `read-only call: '<method>' sends input, which needs the exec tier` before any request is sent. A method missing from the tables counts as `exec`.
- Window and element handles keep a snapshot of their identity fields and send every call by window id or AX ref. Coordinate frames live in the engine: input sent before the target's first capture rejects with the engine's `InvalidCoordinateFrame` error, unchanged. The return value is detached from the facade (structured clone, else JSON), so a handle comes back as its identity fields.
- `screenshot()` sends `capture {target, caps}`, with the caps taken from the snapshot. An inline result is displayed as a caption plus the image. An artifact-only result is displayed as the caption with its path plus the engine's note. Artifacts are listed in `screenshots`. The engine owns the byte budget.
- `audit` holds the engine `audit` notifications received during the call, projected to `AuditRecord`s with the call's `sessionId` and its `toolCallId`. The engine persists its own audit lines.
- Each call owns a facade bound to its `RunContext` (`signal`, `readOnly`, `snapshot`, `output`, `screenshots`). Async work leaked from an ended call therefore keeps that call's aborted signal instead of borrowing the next call's.

## Call budget

- `DesktopService` counts the requests sent through `call` and refuses the first one past `callBudget` (option, default 20,000 per session) with `DesktopCallBudgetError` (`reason: "CallBudgetExceeded"`, `limit`) before an engine starts or anything is sent. `close()` (the tool's `close` action and `/computer off`) resets it.

## Engine spawn contract

- `@oh-my-opencode/senpi-desktop-engine` locates the binary. In development that is `target/release/senpi-desktop-engine` or the vendored `native/prebuilds/<host>/senpi-desktop-engine[.exe]`. In a compiled senpi binary it is the sidecar copy at `<execDir>/native/prebuilds/<host>/senpi-desktop-engine[.exe]`.
- The service spawns that binary with the single argument `--stdio` and piped stdin, stdout, and stderr.
- The child inherits `SENPI_DESKTOP_BACKEND` (tests use it to select the fake backend). On Linux it also inherits `DISPLAY`, `WAYLAND_DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, and `XDG_RUNTIME_DIR`.
- The engine is an asset, not a bundled entry. It adds no senpi compile entry and no argv discriminator, and it does not change `session-worker-compile`.

## Settings

None yet.

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-protocol` and `@oh-my-opencode/senpi-desktop-prelude` import no workspace package.
- `@oh-my-opencode/senpi-desktop-engine` may import `-protocol`.
- `@oh-my-opencode/senpi-desktop-service` may import `-protocol`, `-engine`, and `-prelude`.
- `@oh-my-opencode/senpi-desktop-tool` may import `-protocol`, `-engine`, `-prelude`, and `-service`.
- Only omo-senpi's computer-use component imports these packages, and only `-tool` and `-service`. senpi itself imports none of them.
- No desktop package imports `pi-agent-core`, `pi-ai`, or `pi-tui`. There is no shared utils package: the five desktop packages are the whole set.

The Rust side runs the other way: `senpi-desktop-core` <- `-safety` <- `-session` <- backends <- `senpi-desktop-engine` (the binary). The TS packages reach it only through the engine's stdio JSON-RPC.

# @oh-my-opencode/senpi-desktop-sdk

The typed computer-use SDK. `connect(transport)` returns a `Computer` (windows, the desktop target, control, the stop path, audit and epoch streams, `verify`, `batch`); `Window`, `Element`, `Frame`, `Pointer` and `Keyboard` hang off it. Every engine reply is validated at the boundary, every input action returns an `ActionReport`, and every failure is a `ComputerError` with `code`, `disposition`, `data` and `nothingSent`. Importing the package has no side effects.

## Transports

- `{ kind: "inProcess", port }` wraps an `RpcPort` (`@oh-my-opencode/senpi-desktop-protocol`) the host already owns, such as the desktop service's engine connection. `computer.close()` detaches the SDK; the port stays with its owner.
- `spawn`, `toolBridge` and `attach` are not in this package yet.

## Reports and verify

- An engine without the `action-report` feature, or a session opened with `reportMode: "null"`, replies `null` to an input action. The SDK maps that to `delivered_unverified` / `unsafe`, `effect: "unverifiable"`, `legacy: true`.
- `computer.verify(expectation, { timeoutMs })` polls READ calls (`ax.node`, `ax.attributes`, `windows`) until the expectation holds or the deadline passes, and answers `satisfied`, `unsatisfied` (read at the deadline and still false) or `unknown` (a read failed). It sends no input and adds no engine method.
- An action called with `verify: { expectation, timeoutMs }` reads back after sending and sets the report's `effect` to `confirmed` or `no_change`; an `unknown` verdict leaves the engine's `effect`.
- The SDK never retries.

## Facade manifest

`facade-manifest.json` is generated from the TSDoc tags (`@tier`, `@policy`, `@wire`) of `src/facade.ts` with `bun run generate`. Never edit it by hand; the test suite fails when it drifts.

## Settings

None.

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-sdk` imports only `-protocol`, and no process or network builtin (`child_process`, `net`, `tls`, `http`, `https`, `dgram`, `cluster`, `worker_threads`).
- `@oh-my-opencode/senpi-desktop-service` and `@oh-my-opencode/senpi-desktop-tool` may import `-sdk`.

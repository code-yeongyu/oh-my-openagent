# Final security review blockers

## RPC descendant process survival

### RED

Command:

`bun test packages/senpi-task/src/runners/rpc/terminate.test.ts`

Observed:

- direct RPC child exited after escalation;
- TERM-ignoring descendant remained running;
- assertion failed with `Expected: false`, `Received: true`;
- suite result: 3 pass, 1 fail.

The fixture launches a real child process that launches a long-lived descendant. No shell is involved.

### GREEN

Production change:

- POSIX RPC roots launch as owned process groups;
- termination signals the process group with SIGTERM and bounded SIGKILL escalation;
- Windows termination uses `taskkill.exe /PID <pid> /T /F` with `shell: false`;
- the test distinguishes an executing process from a terminated POSIX zombie without sleeps.

Commands:

- `bun test packages/senpi-task/src/runners/rpc/terminate.test.ts`
- `bun test packages/senpi-task/src/runners`
- `bun run --cwd packages/senpi-task typecheck`

Observed:

- termination suite: 4 pass, 0 fail;
- focused runner/termination suite: 15 pass, 0 fail;
- package typecheck: exit 0.

## Forgeable generated-bundle freshness marker

### RED

Command:

`bun test packages/omo-senpi/plugin/scripts/build-artifact.test.mjs`

Observed:

- an injected JavaScript body retained the reviewed source digest;
- its editable body digest was recomputed;
- `artifactsMatch()` returned `true`;
- assertion failed with `Expected: false`, `Received: true`.

### GREEN

Production change:

- the gate validates both artifact markers against their bodies;
- current and freshly generated body digests must match;
- current and freshly generated bodies must be byte-identical;
- Bun identifier mangling was replaced with reproducible syntax/whitespace minification plus pinned `terser@5.44.0` identifier mangling;
- the minifier version is part of the build settings digest.

Commands:

- `bun test packages/omo-senpi/plugin/scripts/build-artifact.test.mjs`
- `npm exec --yes --package=bun@1.3.12 -- bash -c 'node packages/omo-senpi/plugin/scripts/build-extension.mjs --check'`
- `bun test packages/omo-senpi/src/bundle-size.test.ts`

Observed:

- forgery regression: 1 pass, 0 fail;
- cross-process exact body check: exit 0;
- `omo.js`: 764,648 bytes, below the 1,050,000-byte budget;
- bundle size and artifact integrity gates: 2 pass, 0 fail.

## Full Senpi gate after security fixes

Command:

`bun run test:senpi`

Observed:

- 1,715 pass;
- 1 intentional Windows-only production-driver skip;
- 0 fail;
- 4,844 expectations across 1,716 tests in 148.41 seconds.

No provider token, credential body, authorization header, private key, or raw environment dump is retained.

## Relative executable path substitution

### RED

Command:

`bun test packages/senpi-task/src/runners/rpc/spawn.test.ts`

Observed:

- a relative `SENPI_BIN` was validated relative to the parent process and returned unchanged;
- a relative `PATH` entry likewise returned a relative executable;
- both regression assertions failed because a later task-controlled `cwd` could resolve those paths to different files.

### GREEN

Production change:

- every explicit override, sibling candidate, and PATH candidate is resolved to an absolute path;
- `realpathSync.native` canonicalizes symlinks and platform path aliases;
- `statSync(...).isFile()` rejects directories and non-file candidates before spawn.

Observed:

- executable-resolution suite: 23 pass, 0 fail;
- both relative-path cases return canonical absolute paths;
- senpi-task typecheck and LSP diagnostics: clean.

## Process-containment boundary

`terminateRpcChild` guarantees teardown of the owned RPC process group on POSIX, the discoverable process tree through `taskkill /T /F` on Windows, and direct-child fallback for non-group-leader callers. Real TERM-ignoring child and descendant fixtures pass without sleeps.

This runner is not an operating-system sandbox. Code already trusted to run with the agent's filesystem, network, and credential access can deliberately daemonize into a new session or create irreversible external side effects. Preventing that requires a separate sandbox/container architecture and is not claimed by this PR's child-process lifecycle contract. The platform QA requirement is satisfied by proving the owned RPC tree exits and no recorded child PID remains.

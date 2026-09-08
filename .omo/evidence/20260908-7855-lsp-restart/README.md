# PR 7855: real vanished-endpoint restart proof

## Scope and result

Addresses review [discussion_r3944865688](https://github.com/code-yeongyu/oh-my-openagent/pull/7855#discussion_r3944865688)
on source head `da130a5550e78c2181f412fb7373e4c1ba2e8d4b`, for issue #7827.
This remediation adds evidence only; it does not change ownership behavior.

**PASS:** real OpenCode 1.18.4 invoked `lsp_status` through the PR-built daemon's
stdio MCP proxy after a dead owner's persisted Unix endpoint had disappeared.
The daemon replaced PID **692** / nonce `bcce7221-e59b-4fea-826f-91be257eab19`
with live PID **743** / nonce `f605a639-eb96-40a3-9897-39ff96bee275`, recreated
the socket, rotated authentication, answered an authenticated owner ping and
tool call, and rejected the old token. No token is included in this evidence.

## What was tested

The matching OpenCode QA guidance selected an isolated server/tool surface,
not a TUI smoke or an in-process daemon substitute. `replay.mjs` drives:

1. A task-owned child that exits naturally; its PID is confirmed dead by ESRCH.
2. A real temporary Unix socket whose device/inode identity is captured before
   closing it. The socket is confirmed absent before stale owner, PID, endpoint
   and auth metadata are written. An authenticated ping fails with ENOENT.
3. Real `opencode serve`, configured with a local MCP command pointing directly
   at this worktree's built `packages/lsp-daemon/dist/cli.js`, not an installed
   or main-checkout runtime. Its bundle SHA-256 is in `result.json`.
4. A synchronous HTTP prompt whose deterministic local provider selects the
   actual LSP tool advertised by OpenCode. The completed tool part is read back
   from OpenCode's session messages; the model and daemon are not mocked.
5. Replacement-owner and authentication checks, followed by owned-process and
   sandbox teardown. Event waits are registered before triggers and bounded;
   the driver has no fixed sleeps or polling delays.

Only the model responses are scripted. The test used Node 24.18.0 and Bun 1.4.0
inside an ARM64 disposable `omo-qa` container. Docker inspection confirmed its
only host mount was the task repository; no real-home configuration, credential,
database, or daemon state was mounted. One isolated session was created and
removed with the sandbox. The container was removed after capture.

## Replay

Use a disposable ARM64 container with OpenCode, Node, Bun 1.4.0, and sqlite3.
Mount a checkout of the tested PR at `/repo`, with no host configuration mounts.
Install workspace dependencies and build this checkout's daemon, then run:

```sh
npm --prefix packages/lsp-daemon ci
npm --prefix packages/lsp-daemon run typecheck
npm --prefix packages/lsp-daemon run build
node .omo/evidence/20260908-7855-lsp-restart/replay.mjs /repo
```

Run the driver **inside the disposable container**, not against a real home.
The command emits sanitized JSON and fails if the required assertions fail.
The provider is bound to loopback; no live model account is needed.

## Captures and validation

- `result.json`: exact successful harness tool output, before/after ownership,
  auth booleans, runtime digest, isolation and cleanup receipts.
- `checks.txt`: successful typecheck/build, lead-provided 13/13 focused test
  result, independent 162/162 package-suite result, and all observed setup,
  driver and lint failures with their disposition.
- `replay.mjs`: reviewer-repeatable driver used for the successful capture.

The package lint command still reports **11 existing format/import-order
errors** on unchanged PR source/test files. They are not hidden or fixed by this
evidence-only patch. The root automatic prepare build hit a container Git-pointer
limitation; only the relevant daemon build is claimed green.

## Why this is enough, and limits

The reported failure happens before daemon startup can reclaim metadata. The
fixture preserves the exact persisted `kind: "unix"` versus absent endpoint
mismatch, and a real harness tool request triggers recovery without a manual
metadata sweep. The new PID/nonce, rebuilt socket, authenticated responses and
old-token rejection prove ownership and authentication were re-established.
The existing ownership tests cover live-owner deferral and ownership guards.

This scoped proof exercises the actual daemon MCP package with a direct local
OpenCode MCP registration. It does not claim full OMO adapter bootstrap, a
language-server diagnostics session, concurrent restart coverage, or Windows
coverage; the status response honestly reports zero installed language servers.

## What was omitted

Auth tokens, auth headers, provider request bodies, unrelated environment or
configuration, host-specific checkout paths, and unrelated logs are omitted.
Sandbox paths are normalized. Public ownership nonces are retained to identify
the state transition; they are not authentication tokens. No private prompt or
personal-skill content was loaded or copied into the capture.

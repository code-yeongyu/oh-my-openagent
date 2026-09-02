# Herdr agent-state lifecycle QA

## What was tested

Worktree:

`<repo-root>`

### Focused automated checks

```sh
bun test \
  ./packages/omo-senpi/src/components/herdr-agent-state/index.test.ts \
  ./packages/omo-senpi/src/extension/index.test.ts

bun run --cwd packages/omo-senpi typecheck

node packages/omo-senpi/plugin/scripts/build-extension.mjs --check
```

The post-rebase build and tests used Bun 1.4.0, matching the repository's
`bun-types` version at `5ec0b7917`.

### Full package gate

The caller's real agent and Herdr environment were removed from the test process:

```sh
env -u OMO_CODING_AGENT_DIR \
    -u HERDR_ENV \
    -u HERDR_BIN_PATH \
    -u HERDR_PANE_ID \
    bun run test:senpi
```

### Real Herdr surface

The component was imported from the worktree and each event was dispatched through
`FakeExtensionAPI`; command execution was not injected, so the production `spawn` path called
the real `$HERDR_BIN_PATH` against the current `$HERDR_PANE_ID`. After each dispatch,
`herdr agent get` read the pane's semantic state.

## What was observed

### Automated checks

- Focused component and registry tests: **7 passed, 0 failed**.
- TypeScript typecheck: **passed**.
- LSP diagnostics on both new TypeScript files and both changed registry files: **0 diagnostics**.
- TypeScript no-excuse audit: **0 violations in 4 files**.
- Generated extension freshness check: **passed**.
- Full Senpi gate: **2286 passed, 1 Windows-only skip, 0 failed** across 314 files.
- `senpi-qa` driver self-test: **passed**.
- Real isolated Senpi driver: **PASS**, including `realSenpiUntouched=true`,
  `ultraworkInjected=true`, and `commentChecker=PASS`.

Sanitized machine-readable results are stored in `post-rebase-drive.json` and
`post-rebase-herdr.json`. The Ctrl-D shutdown reproduction and fix are captured in
`post-rebase-shutdown.json`.

### Real Herdr lifecycle

| Dispatched event | `herdr agent get` observation |
|---|---|
| `session_start` | `agent="omo"`, `agent_status="idle"` |
| `agent_start` | `agent="omo"`, `agent_status="working"` |
| `agent_settled` | `agent="omo"`, `agent_status="done"` |
| `session_shutdown` | `agent_not_found` from both `agent get` and `agent explain` |

The state sequence increased after every report, proving Herdr accepted three distinct
lifecycle transitions.
The component sends `idle` for `agent_settled`; after a preceding `working` state, Herdr
normalizes that settled edge to the user-facing `done` status.
`agent_not_found` after shutdown proves `release-agent` removed the component's ownership.

### Ctrl-D shutdown fallback

The first real Ctrl-D reproduction returned the pane to zsh while Herdr retained the prior
OMO status for more than 30 seconds. A synchronous marker proved Senpi had emitted no
`session_shutdown` event. Calling `release-agent` alone did not invalidate that materialized
status; synchronously reporting a final `idle` before release changed the readback to
`agent_not_found`. Repeating the exact Ctrl-D flow with the rebuilt native branch returned to
zsh and immediately produced `agent_not_found`.

### Original checkout preservation

The original checkout's four pre-existing generated-file changes remained untouched. The
three stale Codex generated files from the task worktree are preserved in a named Git stash
after they could not be safely replayed over 1,160 newer upstream commits. They remain
excluded from the Herdr commits.

## Why this is enough

The unit tests pin the command contract, no-op boundary, non-zero failure handling, and registry
wiring. Typecheck and diagnostics cover the adapter integration. The generated-bundle check
proves the shipped extension matches the source. The isolated real Senpi driver proves the
rebased plugin loads without touching the real agent directory. The real Herdr run verifies the
exact user surface that was broken: readiness, work, completion, and release are now observable
semantic states rather than process-title inference. The process-exit test and Ctrl-D run cover
the host path that omits `session_shutdown`.

## What was omitted

No raw environment dump, session transcript, credentials, user content, local username, pane id,
terminal id, or absolute sandbox path was recorded. Temporary paths and local identifiers in the
raw driver output were replaced with bounded placeholders in the committed JSON.

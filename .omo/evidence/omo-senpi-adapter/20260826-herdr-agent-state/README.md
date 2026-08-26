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

The build and tests used Bun 1.3.14, matching the repository's `bun-types` version. The
machine-default Bun 1.3.5 lacks the `--metafile` option required by the existing extension
build script.

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

- Focused component and registry tests: **6 passed, 0 failed**.
- TypeScript typecheck: **passed**.
- LSP diagnostics on both new TypeScript files and both changed registry files: **0 diagnostics**.
- TypeScript no-excuse audit: **0 violations in 4 files**.
- Generated extension freshness check: **passed**.
- Full Senpi gate: **1569 passed, 2 failed** across 239 files.

The two failures are pre-existing in
`packages/omo-senpi/src/components/memory/worker/completion.test.ts`:

- pending offline completion expected one appended entry but observed none;
- throwing reflection UI expected one appended entry but observed none.

The same two tests fail identically in the untouched original checkout at the same HEAD, so
they are unrelated to the Herdr component. The first non-isolated gate also exposed existing
tests that assume `OMO_CODING_AGENT_DIR` is unset; removing the caller environment made those
tests pass.

### Real Herdr lifecycle

| Dispatched event | `herdr agent get` observation |
|---|---|
| `session_start` | `agent="omo"`, `agent_status="idle"` |
| `agent_start` | `agent="omo"`, `agent_status="working"` |
| `agent_settled` | `agent="omo"`, `agent_status="idle"` |
| `session_shutdown` | `agent_not_found` from both `agent get` and `agent explain` |

The state sequence increased after every report, proving Herdr accepted three distinct
lifecycle transitions.
`agent_not_found` after shutdown proves `release-agent` removed the component's ownership.

### Original checkout preservation

The original checkout's four pre-existing generated-file changes remained untouched. The
three Codex generated files recreated in the task worktree were byte-identical to those
pre-existing files and are excluded from the Herdr commit. The worktree Senpi bundle contains
the new Herdr warning marker; the original checkout bundle does not.

## Why this is enough

The unit tests pin the command contract, no-op boundary, non-zero failure handling, and registry
wiring. Typecheck and diagnostics cover the adapter integration. The generated-bundle check
proves the shipped extension matches the source. The real Herdr run verifies the exact user
surface that was broken: readiness, work, settlement, and release are now observable semantic
states rather than process-title inference.

## What was omitted

No raw environment dump, session transcript, credentials, or user content was recorded. Pane and
state identifiers above are non-secret local QA identifiers.

# PR7857 verified upstream refresh

PR head before refresh: 771eefe2b8cda74816127655b69c22f522677c9b.
Merged dev: 496dcce68d62f223c37895e3792f6d5f65920769.

The merge was clean. The PR's affected OpenCode implementation and tests are
unchanged from the previously verified head. This refresh incorporates upstream
repairs for the Windows failures that blocked the prior run. Upstream CI
[35424381441](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/35424381441)
passed all three operating-system root-test and Senpi jobs.

## Local checks

Bun 1.4.0 and Node 24.18.0 were explicitly selected on PATH.

| Command | Observed result |
| --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | Exit 0, 466 packages installed |
| Six-domain command below | Exit 0, 1603 tests passed across 140 files, 38.70 seconds |
| `node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json` | Exit 0 |
| `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always bun run build` | Exit 0 |
| `bun run typecheck` | Exit 0, full workspace |
| `bun test script/tracked-ignored-paths-audit.test.ts` | 1 pass, 0 fail, 2 assertions, exit 0 |

The local file transport allowance is command-scoped for pre-existing local
submodule URLs; no global Git configuration was changed.

```sh
bun test \
  packages/omo-opencode/src/plugin/background-task-events.test.ts \
  packages/omo-opencode/src/plugin/event.test.ts \
  packages/omo-opencode/src/features/background-agent/ \
  packages/omo-opencode/src/tools/delegate-task/ \
  packages/omo-opencode/src/hooks/runtime-fallback/ \
  packages/omo-opencode/src/hooks/background-notification/
```

The command emitted, in order:

```text
Ran 1603 tests across 140 files. [38.70s]
RELATED_TESTS_PASS
ADAPTER_TYPES_PASS
BUILD_PASS
WORKSPACE_TYPES_PASS
exit_code: 0
```

## Actual OpenCode QA

Case B used the verified source-built probe and driver copied into this directory.
It drives actual OpenCode 1.18.30 with a loopback Responses provider, real native
tool execution, production hook composition, manager, fallback and continuation.
The driver subscribes to SSE before triggering work and matches actual event IDs.
The public built-in skill assets are staged alongside the bundled probe.

- `live-disabled.json`: passed. Both distinct error events were forwarded once,
  notification injection was disabled, and caller output equaled the matching
  SSE error. The child contained two user messages and no assistant message.
- `live-recovery.json`: passed. Errors stayed hidden while recovery was pending,
  including the controlled future-clock getter check; the provider released
  `PR7857_RECOVERED`, which reached the real synchronous caller.
- Both runs used fresh HOME/XDG roots with no inherited config, credentials or
  personal skills. Host database session counts were 8104 before and after each
  case. Sandboxes and server processes were removed.

Replay from the worktree root with the selected binaries on PATH:

```sh
bun build .omo/evidence/20260919-pr7857-refresh/live-probe.ts \
  --outfile .local-ignore/pr7857-refresh/probe.js --target bun --format esm
export QA_BUNDLE="$PWD/.local-ignore/pr7857-refresh/probe.js"
export QA_HOST_DB="$HOME/.local/share/opencode/opencode.db"
QA_CASE=disabled node .omo/evidence/20260919-pr7857-refresh/live-qa.mjs
QA_CASE=recovery node .omo/evidence/20260919-pr7857-refresh/live-qa.mjs
```

## Scope and limitations

The source regression is already covered by the prior failing-first evidence.
No new production behavior was introduced during this clean merge. Sibling-path
LSP diagnostics are unavailable; actual compiler checks passed instead.

The full repository test matrix, remote-provider authentication, full OMO
category selection and Windows runtime QA were not run locally. Current PR CI
must determine integration status; the earlier failing runs are not relabeled
green. Generated Codex/Senpi build drift and raw server logs remain unstaged.
Only this public evidence directory is added beyond the upstream merge.

# OmO native task RPC v2 evidence

## What was tested

- Rebased adversarial RED:
  - `bun test packages/omo-senpi/src/components/task/event-bridge.test.ts packages/omo-senpi/src/components/task/index.test.ts packages/omo-senpi/src/bundle-size.test.ts`
  - observed before the fix: 25 passed, 8 failed.
- Focused task bridge behavior after the test split:
  - event RPC snapshots, session lifecycle, task telemetry/control, security/bounds, and task component wiring.
  - observed: 32 passed, 0 failed, 115 assertions before the final live-cap case; the final security file passed 6/6 with 29 assertions.
- Full OmO Senpi gate:
  - `bun run test:senpi`
  - observed: generated artifacts rebuilt, package typecheck passed, 1,141 tests passed across 168 files, 0 failed.
- Full task engine:
  - `bun test packages/senpi-task`
  - observed: 1,367 tests passed across 205 files, 0 failed.
  - `tsgo --noEmit -p packages/senpi-task/tsconfig.json`
  - observed: exit code 0.
- Repository type safety:
  - `bun run typecheck`
  - observed: root, scripts, and every workspace package typecheck exited 0.
- Generated artifact integrity:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  - observed: every staged runtime and generated extension artifact was current.
  - `bun test packages/omo-senpi/src/bundle-size.test.ts packages/omo-senpi/src/bundle-purity.test.ts`
  - observed: 3 passed, 0 failed.
  - main `omo.js`: 604,347 bytes.
  - lazy `omo-task.js`: 485,075 bytes.
- Patch hygiene:
  - `git diff --check`
  - observed: exit code 0.
  - all changed hand-authored source and test modules are below 250 pure LOC.

## What was observed

- Controls are unavailable until `session_start` explicitly attaches a parent session.
- `session_before_switch` detaches listeners and later store mutations cannot reattach the old parent.
- Shutdown leaves registered handlers fenced even though Senpi has no unregister API.
- Send, output, and cancel accept task ids at this desktop boundary; cancellation cannot fall through to a foreign task name.
- Foreign and absent task ids return the same generic not-found result, revealing no owner/session
  metadata or `all_scope` escalation guidance.
- Messages, cancel reasons, task collections, terminal results, and errors are bounded with explicit truncation metadata.
- Bounded collections retain live tasks before filling the remaining slots with recent terminal tasks.
- Terminal records use durable run stats; only pending/running records may use live tracker snapshots.
- The main packaged extension resolves the task component through `#omo-task-runtime`; freshness and static-import purity cover both generated artifacts.

## Why this is enough for the OmO increment

The RED suite directly exercised every independent review blocker and failed for the expected
reason. Focused tests then proved each boundary, the full package gate covered adapter regressions,
the task-engine suite covered reused output/send/cancel semantics, and clean artifact reproduction
proved the shipped generated files match source. The desktop repository still owns the final
end-to-end browser QA because that is the first real consumer of these extension events and
requests; it will be run with `agent-browser` before the cross-repository goal is completed.

## Omitted and redacted

- No credential, token, environment dump, private transcript, or raw task message is stored here.
- Browser QA is not claimed for this isolated OmO increment. Earlier projection QA remains under
  `/tmp/omo-desktop-task-rpc-qa-20260811/`; the hardened controls will receive a fresh integrated
  desktop `agent-browser` pass after the desktop consumer is implemented.

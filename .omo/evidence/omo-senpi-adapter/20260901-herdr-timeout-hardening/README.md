# Herdr agent-state timeout hardening QA

Follow-up round responding to the review on PR #7357. The branch was rebased onto
current `dev`, every Herdr invocation was bounded with a timeout, raw stderr and
exception logging was replaced with bounded non-sensitive failure metadata, and
deterministic coverage was added for the timeout, nonzero, throw, exit-handler
unregistration, and safe-logging paths.

## Environment

- Node 24.18.0 (matches the repository's Node 24 CI runtime; the local default
  `node` is v20.19.3, which cannot load `@code-yeongyu/senpi@2026.8.31` because the
  engine imports `globSync` from `node:fs`, added in Node 22).
- `@code-yeongyu/senpi` `2026.8.31`, matching the rebased branch pin.
- Bun 1.4.0.

## What was tested

### Focused automated checks

```sh
bun test ./packages/omo-senpi/src/components/herdr-agent-state/index.test.ts
node_modules/.bin/tsgo --noEmit -p packages/omo-senpi/tsconfig.json
node packages/omo-senpi/plugin/scripts/build-extension.mjs
```

The component suite drives the real `runCommand` and `runCommandSync` against a
child that never exits (`setInterval`) to prove the async and synchronous timeouts
resolve as bounded failures, and against a child that exits nonzero to prove the
nonzero path. The remaining new cases assert exit-handler unregistration after
`session_shutdown` and that only bounded metadata (`reason`, `code`, `stderrBytes`,
`errorName`) reaches the logger.

### Full package gate

```sh
env -u OMO_CODING_AGENT_DIR -u HERDR_ENV -u HERDR_BIN_PATH -u HERDR_PANE_ID \
  bun run test:senpi
```

### Hermetic real-Senpi lifecycle with a temporary Herdr recorder

The real `senpi` engine was driven through the sandboxed QA harness
(`packages/omo-senpi/scripts/qa/drive.mjs` sandbox helpers) with `HERDR_ENV=1`,
`HERDR_PANE_ID=qa:herdr-lifecycle`, and `HERDR_BIN_PATH` pointed at a throwaway
recorder that appends each invocation's argv to a temp log and exits 0. No real
Herdr binary or pane was involved, so the run is hermetic. The recorded argv were
checked for the full lifecycle sequence and that every call targeted the given pane
with the `omo-senpi` source and `omo` agent.

## Adversarial cross-review

An independent GPT-model agent reviewed the implementation against the three review
requirements and found three real defects, all now fixed and covered by tests:

- The exception log wrote `error.name` verbatim, which a thrower can set to arbitrary
  multi-line or oversized content. `safeErrorName` now bounds it to a short
  letters-only token (max 40 chars) and falls back to `unknown`, so the safe-logging
  requirement holds even for hostile inputs.
- Synchronous failure classification inferred a timeout from the `SIGKILL` signal,
  which also fires on a stderr buffer overflow (`ENOBUFS`); timeout is now detected
  only from the `ETIMEDOUT` error code, and signal-terminated runs are reported with
  a dedicated `signal` reason instead of a fabricated exit code.
- The async timeout killed the child but left its stderr pipe and any descendant
  attached, which can keep the process alive at exit. The timeout path now destroys
  the stderr stream, removes listeners, and unrefs the child so a wedged binary
  cannot hold the process open.

The independent timeout-focused pass was inconclusive twice due to model
interruptions; the timeout defect it would have covered was confirmed by two other
independent passes and Node's documented behavior.

## What was observed

- Focused component and timeout suite: **12 passed, 0 failed** (30 assertions),
  including the bounded-error-name and signal-classification cases added for the
  fixes above.
- TypeScript typecheck: **passed**.
- Generated `omo.js` bundle regenerated; the timeout path is present in the shipped
  bundle (`stderrBytes` x9, `SIGKILL` present; the prior bundle had neither).
- Full Senpi gate: **2475 passed, 0 failed** across 328 files.
- Baseline senpi drive (`drive.mjs`): **PASS** with `ultraworkInjected=true`,
  `commentChecker=PASS`, `realSenpiUntouched=true` (confirms the harness itself is
  healthy under Node 24, isolating the earlier failures as a Node-version artifact).
- Hermetic recorder lifecycle: **PASS**. Recorded five calls in order
  `report idle` (session_start), `report working` (agent_start), `report idle`
  (agent_settled), then `report idle` + `release-agent` on shutdown. senpi exited 0
  with no kill signal, proving the bounded Herdr calls did not hold exit hostage.

Machine-readable results: `herdr-lifecycle-recorder.json`, `gate-summary.json`.

## Why it is enough

The timeout requirement is proven at the source-command level for both the async
and synchronous paths (real child processes, real kill on timeout), the safe-logging
requirement is proven by asserting the exact bounded warning payload and that no raw
stderr or error message leaks, and the end-to-end wiring is proven by a real senpi
lifecycle whose Herdr calls were captured hermetically. The `session_shutdown`
unregistration is pinned so the process-exit fallback cannot release twice.

## What was omitted

The recorder captured only each invocation's argv, which carry no secrets
(`pane`, action, pane id, source/agent/state). No env dumps, tokens, or credential
files were copied. The `build-extension.mjs --check` freshness gate also validates
the vendored `lsp-daemon` runtime manifest, which is regenerated by
`bun run build:lsp-daemon` (an npm build the local worktree had not run and CI
performs); that manifest is untouched by this branch.

# Memory reflection isolation and health alert QA

## What was tested

### RED to GREEN: reflection child isolation

- RED command: `bun test packages/omo-senpi/src/components/memory/worker/runner-fork-spawn.test.ts`
- GREEN command: focused 9-file worker/model/spawn suite recorded in `green-runner.txt`
- Behavior: inputs that previously selected parent-session fork must produce the bounded
  `TRANSCRIPT_PATH` child contract with its own system prompt, `bash,edit` allowlist,
  discovery disabled, isolated session directory, quick candidate model, and worktree cwd.

### RED to GREEN: fresh-session health warning

- RED command: `bun test packages/omo-senpi/src/components/memory/wiring.test.ts --test-name-pattern "memory wiring health alert delivery"`
- GREEN command: focused 9-file health/completion/cursor/reservation suite recorded in
  `green-health.txt`
- Behavior: a fresh bind with three consumed historical failures and zero pending
  completions emits no health transcript entry; one newly pending failed completion still
  emits exactly one health alert and keeps identity status.

### Automated gates

- `bun test packages/omo-senpi/src/components/memory`
- `./node_modules/.bin/tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun run test:senpi`
- `bun run build`
- `bun packages/omo-senpi/scripts/qa/memory-reflection-isolation-e2e.mjs --self-test`
- `node --check packages/omo-senpi/scripts/qa/memory-reflection-isolation-e2e.mjs`

### Real surface

- Command:
  `bun packages/omo-senpi/scripts/qa/memory-reflection-isolation-e2e.mjs --evidence-slug 20260905-reflection-isolation-live3`
- Surface: worktree-local real Senpi binary, a real PTY/TUI, the locally built OMO extension,
  a localhost scripted model, real memory tool execution, a real detached reflection child,
  durable completion records, and real fresh-session completion draining.
- Visual replay:
  `bun script/qa/web-terminal-visual-qa.mjs --title "OMO memory reflection isolation" --from-file <live3>/trigger.terminal.raw --evidence-dir <live3>/visual`

## What was observed

- Runner RED: legacy argv contained `--fork <parent>` and omitted the isolated worker flags.
- Runner GREEN: 62 passed, 0 failed; the child launch contract is isolated.
- Health RED: historical bind expected zero health entries but received one.
- Health GREEN: 83 passed, 0 failed; historical bind stays silent and a new failure alerts.
- Memory component: 1046 passed, 0 failed.
- Full Senpi gate: 2678 passed, 32 existing platform/capability skips, 0 failed.
- Build: exit 0, `build: all steps completed`.
- Live TUI QA: `result: PASS`, 25 checks, zero errors.
- Reflection `reflection-run-1` completed as `merged` in 1.1 seconds.
- Captured child argv contains no `--fork`; it includes `--system-prompt`,
  `--tools bash,edit`, all four discovery-disable flags, its run-local session directory,
  and model `omo-reflection-qa/mock-1`.
- The parent-only memory marker was present in parent model requests and absent from every
  child system request and the child persona.
- No captured terminal, parent session, child session, stdout, or stderr artifact contains
  `ModelUsabilityBudgetError`.
- A new TUI session with three consumed historical failures emitted zero health alerts.
- A separate new TUI session consuming one pending failure emitted exactly one streak-4
  `senpi-memory.health` entry.

## Isolation and cleanup

- Successful live run sandbox: removed automatically.
- Owned-process survivors: none.
- Real `~/.senpi/agent` protected snapshot: complete and unchanged.
- Real `~/.omo/memory` changed only under the concurrently active lead identity; no changed
  path contained the QA sandbox, QA identity, QA session IDs, or reflection run token.
- Failed-run sandboxes from the earlier print-mode and harness-development attempts were
  removed, with no process survivors.
- The successful result and cleanup receipt are in
  `../20260905-reflection-isolation-live3/result.json`.

## Why it is enough

The unit RED cases fail on the two reported regressions. Their GREEN runs prove the
source-level contracts. The live driver then uses the real Senpi TUI and detached child
pipeline to prove the same behavior through the shipped adapter surface, including actual
HTTP model requests, durable session/completion records, merge output, historical-health
suppression, new-failure alert preservation, protected-state isolation, and cleanup.

## What was omitted

- The model is a localhost scripted provider; this evidence proves routing, isolation,
  tools, persistence, and lifecycle behavior, not external model quality.
- Raw environment dumps, auth files, credentials, and production memory contents are not
  copied.
- The session LSP MCP could not initialize TypeScript in the worktree. The standalone LSP
  verifier also failed in its own path handling. The required `tsgo` package gate passed
  without diagnostics; details are recorded in `focused-tests.txt`.

## Artifacts

- `red-runner.txt`
- `green-runner.txt`
- `red-health.txt`
- `green-health.txt`
- `focused-tests.txt`
- `senpi-gate.txt`
- `build.txt`
- `red-live-driver.txt`
- `../20260905-reflection-isolation-live3/result.json`
- `../20260905-reflection-isolation-live3/model-requests.jsonl`
- `../20260905-reflection-isolation-live3/sessions/`
- `../20260905-reflection-isolation-live3/reflection-run/`
- `../20260905-reflection-isolation-live3/completions/`
- `../20260905-reflection-isolation-live3/visual/terminal.png`
- `../20260905-reflection-isolation-live3/visual/terminal.txt`

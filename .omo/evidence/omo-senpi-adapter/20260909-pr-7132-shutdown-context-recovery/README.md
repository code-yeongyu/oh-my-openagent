# PR #7132 shutdown-context recovery

## What was tested

- Resolved this directory with the canonical command:
  `node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --repo-root <repo-root> --slug 20260909-pr-7132-shutdown-context-recovery`.
- Built the Senpi plugin with `bun run build:senpi-plugin`, then ran the real `senpi` binary through `packages/omo-senpi/scripts/qa/shutdown-context-e2e.mjs` with the repository Bun and Git POSIX paths on `PATH`.
- The live scenario seeded an isolated memory repository, enabled shutdown reflection, replaced the bound extension context in print mode, observed the shutdown completion, and started the next isolated session to consume the durable completion. The model exchange used the local mock HTTP provider configured inside the sandbox.
- Ran `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and the focused `packages/omo-senpi/src/components/memory/wiring.test.ts` suite.
- Ran the complete `bun run test:senpi` package gate after the fix.

## What was observed

The live driver result is captured in [`driver-result.json`](driver-result.json). It reports `PASS` with all eight checks true:

- seed and probe exited with status zero;
- the probe observed the exact assistant answer `OK`;
- no stale extension context appeared;
- a shutdown-origin completion was recorded with outcome `no_changes`;
- the next session consumed the durable completion;
- `parseErrors` and driver errors were empty;
- `realSenpiUntouched` was true.

The driver intentionally redacts the throwaway paths in its report: `sandboxAgentDir` is `<sandbox>/agent` and `sandboxCwd` is `<sandbox>/project`. The task-owned sandboxes from this run and its two failed startup attempts were removed after the children exited; a Windows process check found no remaining `bun.exe` process. The captured driver stderr is empty.

The focused wiring suite passed all 21 tests, and the Senpi typecheck passed. The full package gate completed with 2,988 passing, 41 skipped, 9 failing tests, and 1 unhandled timeout error across 3,038 tests. The residual failures were existing Windows/symlink-permission cases, the Windows process-mode RPC product-gap case, the task-status spend case, and the released-child supervisor timeout; the shutdown-context wiring test passed in this run.

## Why it is enough

The live driver exercises the shipped Senpi bundle and the actual Senpi process across the full shutdown path. It proves the repaired session id and current-context wiring while checking durable completion delivery into a later session and isolating both the sandbox agent directory and the real Senpi agent directory.

## What was omitted

Raw child logs, environment dumps, model credentials, and private paths were not copied into evidence. Only the structured final JSON and the empty stderr receipt are retained. The full package-gate residual failures are recorded above rather than represented as a green result.

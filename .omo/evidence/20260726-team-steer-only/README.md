# Team steer-only delivery evidence

## Scope

This change makes every team-message delivery path steer into the recipient's running turn. Generic non-team `task_send` retains its `followUp` default.

## Automated verification

- `bun test packages/senpi-task packages/omo-senpi/src`
  - Result: PASS - 1240 tests, 0 failures, 1 snapshot, 4010 expectations.
  - Log: `bun-test.log`.
  - Covers the RED-first unit regressions for member-extension inbound injection, shutdown messenger delivery, member-scoped and lead `task_send` routing, scoped-schema removal, and the scoped TUI renderer.
- `bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json`
  - Result: PASS (no output). Log: `tsgo-senpi-task.log`.
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
  - Result: PASS (no output). Log: `tsgo-omo-senpi.log`.
- `bun run build:senpi-plugin:stage`
  - Result: PASS. Log: `build-senpi-plugin-stage.log`.
  - Rebuilt the staged Senpi extension bundles, including `omo-member.js`.

## Live QA

- Command: `TEAM_E2E_OUT_DIR=<this directory>/team-e2e-artifacts node packages/omo-senpi/scripts/qa/team-e2e.mjs`
- Result: PASS. The driver reported all 12 checks true, including lead-to-member enqueue, member-envelope injection, member-to-lead injection, no blocking `team_wait`, crash reservation recovery, restart, and liveness injection. It also reported `credentialIsolationClean: true` and `leakedPids: 0`.
- Logs and machine-readable verdict: `team-e2e.log` and `team-e2e-artifacts/verdict.json`.
- The driver's non-gating `wholeDirUnchanged` field was `false`, while the verdict remained PASS. This records a real Senpi-agent-directory digest difference outside credential isolation; a dev baseline was not needed because the live QA did not fail.

## Why this is sufficient

The targeted tests assert the exact steering-engine outcome (`delivered: "steer"`), call `handle.steer`, and assert that `handle.followUp` is never called for member-scoped and explicit lead-team sends. The member extension and shutdown messenger tests cover the remaining concrete inbound delivery producers. The live QA exercises the built plugin in an isolated sandbox with the mock provider.

## Omitted

No dev-baseline QA run was made: the isolated live QA passed. No manual interactive TUI session was run beyond the automated renderer and live-E2E coverage.

- CI synchronize trigger: no functional change.

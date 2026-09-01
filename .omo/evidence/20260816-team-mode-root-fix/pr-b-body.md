## Bottom line

This restores the Senpi Team Mode process boundary and closes the silent process-task failure paths:

- explicit member processes own only the member-scoped `task_send` surface;
- generic descendants cannot inherit member identity or `omo-member.js`;
- create and respawn use one stable member-first extension profile;
- process models are admitted against the exact credential-free child profile before the real RPC child spawns;
- RPC prompt rejection and terminal turn errors become durable typed failures instead of hanging or completing with empty output.

This supersedes the applicable Team Mode portion of #6801. Thank you to @ismetanin for finding the unsafe member surface and descendant identity leak. The reusable boundary increment retains Ivan Smetanin's authorship.

The withdrawn duplicate-tool explanation from #6801 is intentionally not carried forward: pinned Senpi keeps the later extension loaded and only resolves the duplicate tool name first-wins. The historical provider incident was not caused by whole-extension rejection.

## What changed

### Member boundary

- Exit the normal OMO task component immediately in explicit member processes.
- Leave member-scoped `task_send` owned by `omo-member.js`.
- Strip `SENPI_TASK_MEMBER`, `SENPI_TASK_MEMBER_TASK_ID`, `SENPI_TASK_TEAM_CONFIG`, and `omo-member.js` from generic RPC descendants.
- Restore fresh identity/config only for explicit direct-member launches.

### Canonical member launch profile

- Share one stable-deduplicated `[member extension, ...inherited extensions]` rule across create and respawn.
- Preserve inherited extension ordering.
- Remove the adapter's now-redundant duplicate member-extension injection (behaviorally inert once the canonical rule dedupes member-first; kept as cleanup so one rule owns assembly).

### Process model admission

- Run pinned Senpi `--list-models` with the same launcher, cwd, environment, `--no-extensions`, and explicit extension list as the child profile.
- Exact-match `provider/model`.
- Reject with typed `model_unavailable` before real child spawn when the model is absent.
- Keep credentials out of argv, records, and evidence.

### RPC terminal outcomes

- Await Senpi's authoritative prompt-preflight response before accepting a process start.
- Terminate and reject prompt preflight failures as `child-prompt-failed`.
- Classify assistant `stopReason:error|aborted`, no fresh assistant output, and stale prior-turn text as `child-turn-failed`.
- Wait for child stdio close before capturing crash diagnostics so stderr tails are complete.

## Verification

- RED evidence:
  - `.omo/evidence/20260816-team-mode-root-fix/red/member-boundary.log`
  - `.omo/evidence/20260816-team-mode-root-fix/red/extension-assembly.log`
  - `.omo/evidence/20260816-team-mode-root-fix/red/model-admission.log`
  - `.omo/evidence/20260816-team-mode-root-fix/red/rpc-terminal-outcomes.log`
- Focused/scoped GREEN:
  - `bun test packages/senpi-task packages/omo-senpi`: 2958 pass, 0 fail, 8662 expectations across 449 files.
  - `packages/senpi-task` typecheck passed.
  - `packages/omo-senpi` typecheck passed.
  - CI-Bun extension regeneration and currency check passed (`build-extension.mjs --check`: build is current).
- Real Team Mode (isolated E2E, two consecutive PASS runs):
  - `.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-green-final/verdict.json`
  - `.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-repeat/verdict.json`
  - both: `result: "PASS"`, all 22 checks true, `failed: []`, `leakedPids: 0`, `credentialIsolationClean: true`
    (the repeat run additionally reports `wholeDirUnchanged: true`).
  - Cleanup receipt after both runs: 0 orphan `omo-mock` processes, 0 residual `omo-senpi-qa-*` sandbox roots.
- Root gates:
  - `bun run typecheck` (root + script + all packages): passed.
  - `bun run build`: passed end to end.
  - `bun test` (root, 1976 files): 15138 pass / 5 skip / 2 fail. Both failures are pre-existing
    `shouldProposeRefresh` timeouts in `packages/omo-senpi/src/components/init-deep-advisor/drift.test.ts`,
    a module this PR does not touch (`git status` on that directory is empty); they pass 15/15 in isolation
    at ~2.2s against a 5s budget and only exceed it under full-suite parallel load. See
    `.omo/evidence/20260816-team-mode-root-fix/green/root-full-suite.md`.
- Repository gates and review results are recorded under `.omo/evidence/20260816-team-mode-root-fix/`.

## Follow-up boundary

This PR intentionally implements narrow model visibility admission, not a speculative full resource-profile abstraction. A separate issue tracks process-child parity for settings/runtime-installed tools, MCP servers, skills, and dynamic registrations.

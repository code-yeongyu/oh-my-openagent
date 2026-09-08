# What was tested

Scope: PR B, plan todos 8-14, branch `lcx/gate-softening`, based on `7c1c66c61b83a0dce97e2b30f9d8971a1ff7d881`. Todo 14 adds evidence only. The orchestrator owns CI, review, and merge; this task stops at PR creation.

## Existing implementation and regression evidence

| Todo | Surface and intended proof | Evidence |
| --- | --- | --- |
| 8 | Real ulw-loop CLI in scratch projects: template without codeReview, self-review/category authors, bare and wrapped checkpoint input, unknown-author rejection, and optional main-session code review. Remote component tests preserve the senpi contract. | `task-8-gate.log`, `task-8-red-green.log`, `task-8-doneclaim.json` |
| 9 | Missing-manualQa validation explains both input forms; help/status expose currentAttemptDir. Focused baseline RED and overlay GREEN. The round-5 verifier separately exercised the missing-manualQa checkpoint CLI against an active plan. | `task-9-errors.log`, `task-9-green.log`, `task-14-verifier-rounds.json` |
| 10 | Schema-shaped PostToolUse admission failure records a marker silently; subsequent PreToolUse denies before plan lookup; other sessions and successful admissions remain unblocked. Fanout is 24 and gate-reviewer admission needs manual QA, not code-review artifacts. | `task-10-spawn-guard.log`, `task-gate-b-manual-qa.log`, `task-10-bundle.log`, `task-10-bundle-remote.log` |
| 11 | Canonical directive/generated-copy identity, explicit-demand-only Verification gate, and real UserPromptSubmit skill-pointer output for an ulw prompt versus empty output for an ordinary prompt. | `task-11-directive.log`, `task-11-doneclaim.json` |
| 12 | Active-Boulder Stop still blocks with the relaxed continuation directive; SubagentStop is silent and de-wired. Replacement probes exercise the installed component, not only the source tree. | `task-12-continuation.log`, `task-12-green.log`, `task-12-red-correct-path.log`, `task-12-remote-cleanup.log` |
| 13 | Codex-only overlays, optional spawn-field warnings, exact anchor matching, regeneration/idempotence, and independent shared-copy drift detection. Shared skill sources remain unchanged. | `task-13-sync-skills.log`, `task-13-drift.log`, `task-13-doneclaim.json` |

The complete remote gate ran on mengmotaMac at `3451c0a8b4d872a43523a5b9b54073bbd30f850f`: ulw-loop, ultrawork, continuation, plugin Node tests, prompts-core plus installer freshness, and `bun run test:codex`. See `task-gate-b-remote-tests.log` and `task-gate-b5-receipt.json`. This turn inspected those results; it did not rerun Bun tests locally or remotely.

## Todo 14 fresh verification

- `bun run build:codex-install`; assert `git status --porcelain` is empty immediately afterward and PR B has no installer-source delta.
- `bun --cwd packages/omo-codex/plugin run build` exits 0 but Bun 1.4.0 prints usage for this order. Also execute `bun run --cwd packages/omo-codex/plugin build` to perform the actual plugin build. Both builds leave the tracked tree clean. See `task-14-build.log`.
- `tsgo --noEmit -p packages/omo-codex/tsconfig.json`: `task-14-tsgo.log`.
- `scripts/install-verify.sh --self-test`, then a fresh isolated `scripts/install-verify.sh --keep`: `task-14-install-self-test.log`, `task-14-install.log`.
- Capture both installed manifests and inspect hook count, admission-hook presence, and continuation-SubagentStop absence: `task-14-installed-manifest.json` and `task-14-installed-marketplace-manifest.json`.
- `scripts/app-server-drive.sh --self-test`, then `scripts/app-server-drive.sh --plugin --expect sessionStart,userPromptSubmit`, using the real `/opt/homebrew/bin/codex` 0.144.1 and the bundled localhost mock model. Parsed notifications require matching hook/started and successful hook/completed run IDs: `task-14-app-server-self-test.json`, `task-14-app-server.json`.

`task-14-qa.sh` reproduces the isolated probes. It copies the unchanged script entrypoints/client/mock to a disposable directory and adapts only common.sh: the protected real-config digest, explicit sandbox temp placement, and FIFO readiness with a bounded timeout instead of a sleep/poll loop. Canonical macOS paths avoid the client's URL-entrypoint guard mismatch. The adaptation is recorded in `task-14-qa-harness.diff`; repository skill and product sources are untouched.

The requested native installed-cache count of 21 fails on macOS: the actual cache has 19, while the installed marketplace snapshot has 21. `task-14-ship.log` retains `HOOK_COUNT_CONTRACT_EXIT=1` and `QA_EXIT=1`; this is not reported as an all-green task.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`; after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`. HOME, CODEX_HOME, XDG directories, and agent-home overrides were isolated. No real auth files or real `~/.omo` were read or written by these probes.

## What / Why

Soften LazyCodex's final gate without removing verification. This aligns the **lazycodex surface** with senpi-parity gate-review-only behavior while leaving the omo-senpi surface unchanged.

- Make `codeReview` optional. Accept `main-session` for manual QA/code review and `main-session` or the configured category acceptors for gate review. Accept both bare and wrapped quality-gate JSON, with actionable errors and current-attempt artifact guidance.
- Default to self-review plus the main session's real-surface manual QA. Trigger the ULW **Verification gate only on explicit user demand** for strict, rigorous, or high-accuracy review; HEAVY work alone no longer forces reviewer escalation.
- Add a per-session spawn-admission circuit breaker after capacity failures, check it before plan/artifact/quota guards, require only manual-QA artifacts for gate-reviewer admission, and lower default fanout to **24**.
- Relax ulw-execute-continuation's final gate and cap reviewer escalation. De-wire its **SubagentStop** hook so a child no longer inherits the root plan; preserve the main-session Stop continuation and separate executor-evidence verification hook.
- Update Codex-only sync-skills overlays and empty optional spawn-field guidance, preserving shared skill sources and independent drift checks. Keep the component CLI self-contained after its own build.
- The full plugin manifest contains **21 hooks**: the new PostToolUse spawn-admission recorder replaces the removed continuation SubagentStop registration. No installer source or bundle changes belong to PR B.

Addresses #155 #160 #144 #143 #153

## Observed

The complete remote gate ran on **mengmotaMac** at `REMOTE_HEAD=3451c0a8b4d872a43523a5b9b54073bbd30f850f`, with **six TEST_EXIT=0 results**:

| Gate | Result |
| --- | --- |
| ulw-loop | 547 passed across 54 files |
| ultrawork | 24 passed across 5 files |
| ulw-execute-continuation | 43 passed across 3 files |
| Plugin Node aggregate | 327 passed, 0 failed |
| prompts-core + installer freshness | 28 passed, 0 failed |
| test:codex | Component stages: 97 and 547 passed; Bun: 418 passed, 1 existing Windows-only skip, 0 failed; Node: 486 passed, 0 failed |

The remote directory removal receipt is captured. Later commits are evidence-only, so the product tree remains identical to that tested SHA. Six verifier rounds are retained; round 5 confirmed todos 8/9/11/13, and round 6 confirmed the remaining todo-10 breaker baseline proof and todo-12 installed/cleanup receipts.

Fresh local installer and actual plugin builds exited 0 and left `git status --porcelain` empty; local Codex tsgo exited 0. Isolated install self-test and fresh install passed. Real Codex 0.144.1 app-server self-test and plugin turns completed using only the localhost mock model, with matching **hook/started + hook/completed** notifications for the rules SessionStart and ultrawork UserPromptSubmit hooks and no missing/failed hooks.

**Native installed-count discrepancy, not an all-green todo-14 claim:** the installed marketplace snapshot has 21 hooks, but the macOS runtime cache has **19**. The unchanged base installer removes two Windows-only Git Bash hooks (`pre-tool-use-recommending-git-bash-mcp.json` and `post-compact-resetting-git-bash-mcp-reminder.json`). Both installed manifests include the admission recorder and exclude the continuation SubagentStop hook. The requested literal 21-hook runtime-cache assertion remains failed; the evidence runner retains exit 1. No source edit or platform simulation was used to conceal it.

## QA evidence

All paths are under `.omo/evidence/20260908-lcx-gate-softening/`:

- Reviewer narratives: `what-tested.md`, `observed.md`, `why-enough.md`, `omitted.md`.
- Remote full gate: `task-gate-b-remote-tests.log`, `task-gate-b5-receipt.json`.
- Verifier history: `task-14-verifier-rounds.json`.
- Real ulw-loop CLI: `task-8-gate.log`; missing-field/error evidence: `task-9-errors.log`, `task-9-green.log`, and the round-5 verifier report.
- Hook behavior: `task-10-spawn-guard.log`, `task-11-directive.log`, `task-12-continuation.log`; remote cleanup: `task-12-remote-cleanup.log`.
- Overlay/drift evidence: `task-13-sync-skills.log`, `task-13-drift.log`.
- Fresh builds/typecheck: `task-14-build.log`, `task-14-tsgo.log`.
- Fresh isolated install: `task-14-install-self-test.log`, `task-14-install.log`, both `task-14-installed-*-manifest.json` / `task-14-installed-manifest.json` artifacts.
- First-party notifications: `task-14-app-server-self-test.json`, `task-14-app-server.json`; raw output in the corresponding `.log` files.
- Reproduction and isolation: `task-14-qa.sh`, `task-14-qa-harness.diff`, `task-14-ship.log`.

Real `~/.codex/config.toml` SHA-1 before and after is identical: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`. HOME, CODEX_HOME, XDG directories, and agent-home overrides were isolated. No local Bun tests, agentic probes, real auth access, or real ~/.omo writes were used. Script entrypoints/client/mock were copied byte-identically into a temporary QA directory; only temporary common.sh readiness/isolation plumbing was adapted, leaving repository scripts unchanged.

## Residual risk / handoff

- Resolve the plan's native-cache 21-hook requirement against the existing macOS 19-hook installation behavior before treating todo 14 as fully accepted. This PR reports the discrepancy rather than changing installer policy outside scope.
- Mock-only QA proves plugin installation and hook wiring, not autonomous model adherence to the relaxed review prose. Actual capacity exhaustion is simulated through schema-shaped hook payloads, not real agent spawning.
- Earlier failing runs and setup mistakes are retained and distinguished from final evidence. Codex's temporary PATH-alias and untrusted-project warnings are retained alongside the successful isolated plugin notifications.
- CI, review-work/Cubic, and merge remain with the orchestrator. This task creates the PR only; it does not merge or bypass required checks.

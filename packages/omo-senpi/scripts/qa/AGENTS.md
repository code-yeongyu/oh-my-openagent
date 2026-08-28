# scripts/qa

Live Senpi QA harness: E2E drivers, continuation probes, scenario fixtures, and mock providers that drive the REAL `senpi` binary against built plugin artifacts. ~80 files. Unit tests prove wiring; these drivers are the harness proof the root AGENTS.md QA mandate demands. Earned by score: largest and most referenced directory in the package.

## Lanes

| Lane | Drivers |
|------|---------|
| Task | `task-e2e.mjs` (single/batch lifecycles), `task-lane-spill-e2e.mjs`, `task-fallback-notification.mjs`, `task-category-unavailable-e2e.mjs`, `task-id-race-qa.mjs`, `task-parent-restart-e2e.mjs`, `task-summary-e2e.mjs`, `task-load-skills-e2e.mjs`, `task-13.test.ts` (engine wiring) |
| Team | `team-e2e.mjs`, `team-resume-e2e.mjs`, `team-delete-6413-qa.mjs`, `team-e2e-crash.mjs`/`-crash-state.mjs`, support modules `team-e2e-{support,runtime,process,scripts,analysis}.mjs`, `team-e2e-mock-provider.ts` |
| RPC | `task-rpc-e2e.mjs`, `-helpers.mjs`, `-scenarios.mjs` (+`.test.mjs`), `task-rpc-e2e.windows.test.ts` |
| Resume | `task-resume-e2e.mjs`, `task-resume-failure-e2e.mjs`, `task-resume-e2e-scenarios.mjs`, `resume-e2e-runtime.mjs` |
| Memory | `memory-e2e.mjs`, `memory-model-fallback-e2e.mjs`, `memory-skill-startup-e2e.mjs`, `facts-backlog-e2e.mjs`, `memory-write-visual-qa.mjs [--keep-sandbox]` |
| Components | `fallback-architect-e2e.mjs`, `git-master-attribution-e2e.mjs`, `skill-pointers-e2e.mjs`, `mass-ulw-prompts-e2e.mjs`, `ulw-prompts-e2e.mjs`, `ulw-goal-footer-tui.mjs`, `todo-fanout-reminder-e2e.mjs`, `no-todo-continuity-e2e.mjs`, `variant-thinking-e2e.mjs`, `task-tui-{e2e,scenarios}.mjs`, `task-stats-renderer.mjs` |
| Runtimes | `lsp-e2e.mjs` (largest, ~1.4k LOC: staged runtime, extension loading, tool behavior, post-edit flows), `ast-grep-mcp-e2e.mjs`, `curated-agents-e2e.mjs`, `parallelism-eval-e2e.mjs`, `plan-gated-agents-e2e.mjs`, `dag-gate-proof.ts`, `dag-wait-detach-qa.ts`, `probe-continuation.mjs`, `probe-cross-session.mjs` |
| Thread | `thread-tools/` cross-surface suite: `cli-surface.mjs` (CLI session drives create/send/steer on a peer), `desktop-client.mjs` (same ops through the REAL desktop provider client), `terminal-to-ui.mjs` and `desktop-to-cli.mjs` (each surface's sessions addressable from the other), `run-all.mjs`, shared `lib/harness.mjs` |
| Resilience | `task-14/` fault injections against a real socket host: `kill-mid-turn.mjs`, `version-capability.mjs` (incompatible unmanaged host is refused, never adopted or replaced), `queued-resume.mjs`, `uncertain-operation.mjs`, `run-all.mjs`, shared `common.mjs` |
| Infra | `drive.mjs`, `task-e2e-{analysis,process}.mjs`, `mock-completions-server.mjs`, `mock-provider/` |

## Shared hubs

- `drive.mjs`: `createSandbox`/`seedSandbox`/`digestDirectory`/`credentialDigest` (+ `--self-test`). The isolation seam every driver imports.
- `task-e2e-analysis.mjs`: JSONL event parsing, `jsonlSignature`, ordered-subsequence matching, filesystem snapshot diffing, `classifyRealSenpiChanges`.
- `resume-e2e-runtime.mjs`: bounded `pollUntil`, task-record readers, kill-group cleanup.
- `mock-provider/index.ts`: `registerMockProvider`, `selfTest`, `loadMockScript`, `stepToAssistantMessage`, stream/result guards. The `*-mock-provider.ts` files default-export senpi extension registrations and are loaded via `senpi -e`.
- `mock-completions-server.mjs`: local HTTP mock provider. A child in-process MUST ALWAYS exit through a real HTTP client, never an in-process shortcut.
- `thread-tools/lib/harness.mjs`: the ONE harness for the thread lanes - scratch dirs, fake model and child tracking come from the sanctioned `qa-app-server/lib/*` modules, assertions read target state (`get_messages`, `getShellSnapshot()`) rather than logs, and `verifyCleanup` proves no survivor matched this run's own scratch path.
- Cross-checkout roots are env-overridable, never hard-coded: `THREAD_QA_SENPI_ROOT` and `THREAD_QA_DESKTOP_ROOT` (harness), `THREAD_QA_SENPI_ROOT` and `THREAD_QA_EVIDENCE_ROOT` (`task-14/common.mjs`). Specifiers into another checkout MUST be dynamic `import()` of an env-resolved path, or the suite fails module resolution on every other machine.

## CONVENTIONS

- ESM `.mjs` drivers with `import.meta.url` entry guards and `node:*` built-ins; scenario and provider modules duplicate named token markers deliberately, and tests pin marker equality plus structured event/state evidence.
- Sandboxes own HOME/XDG dirs and `SENPI_CODING_AGENT_DIR`; drivers build their own isolated agent dir and IGNORE a caller-provided one; credential digests prove the real agent dir stayed untouched.
- Final output is machine-readable JSON with PASS/FAIL checks; a missing `senpi` binary yields SKIP/FAIL, never a pass.
- Process QA is defensive: owned process registries, process-group/tree termination, bounded polling and deadlines, PID liveness checks, Windows shim/native executable resolution.

## ANTI-PATTERNS

- NEVER run QA against the real `~/.senpi/agent` or `~/.omo`; sandbox isolation and digest proof are mandatory.
- NEVER treat output text or process residency alone as proof of spawn/revival: require structured events, PID plus child-session JSONL, mailbox state, or exact transcript markers.
- NEVER accept in-process fallback as proof of RPC process execution: process mode plus PID/child-session JSONL (or a named spawn-path failure).
- Ultrawork QA: `update_plan`, `multi_agent`, `spawn_agent` are forbidden transcript/tool markers; the directive must be a hidden custom message, never user transcript text. Secrets (`TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY`) are filtered from env snapshots.
- No unbounded waits, no orphaned children, no leaking parent/child selectors, and task/team child providers never consume the parent's scripted sequence.

## COMMANDS

```bash
node scripts/qa/drive.mjs --self-test
node scripts/qa/task-rpc-e2e.mjs --self-test
node scripts/qa/task-load-skills-e2e.mjs --self-test
SENPI_BIN="$(command -v senpi)" node scripts/qa/task-e2e.mjs   # live mode; same for team-e2e.mjs
bun test scripts/qa/task-e2e-analysis.test.mjs scripts/qa/resume-e2e-runtime.test.mjs
bun packages/omo-senpi/scripts/qa/thread-tools/run-all.mjs        # cross-surface thread tools
bun packages/omo-senpi/scripts/qa/task-14/run-all.mjs             # resilience fault injections
bun run test:senpi                                             # gate: build + stage + typecheck + test
```

LSP and ast-grep lanes need staged runtimes first (`bun run build:senpi-plugin`). Evidence goes under `.omo/evidence/omo-senpi-adapter/` via the `senpi-qa` skill's resolver; see the package and root AGENTS.md.

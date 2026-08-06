# pi-goal

Persistent per-thread goal tracking as a Pi extension, vendored from the standalone
`code-yeongyu/pi-goal` repository into this monorepo as `@oh-my-opencode/pi-goal`
(private workspace package, Adapter layer: Pi-harness-coupled).

Registers the Codex-style `create_goal` / `update_goal` / `get_goal` tools plus the
`/goal` command, persists one goal per thread to a JSON file under the active session
directory, renders a Codex-style TUI footer indicator, and re-engages the agent toward
an active goal via hidden continuation prompts (`pi-goal-continuation` custom messages).

## Anatomy

| Path | Purpose |
|------|---------|
| `src/index.ts` | Extension entry: tools + `/goal` command + session/agent lifecycle + usage accounting |
| `src/goal/store.ts` | File persistence: read/write/create/update/clear/accountGoalUsage + status transitions |
| `src/goal/types.ts` | `Goal`, `GoalStatus` (`active\|paused\|blocked\|budgetLimited\|complete`), store/file/tool types |
| `src/goal/prompt.ts` | Continuation + budget-limited hidden prompt builders |
| `src/goal/continuation.ts` | Continuation gating predicates |
| `src/goal/format.ts` | Tool/UI formatting + tool JSON response snapshots |
| `src/goal/ui.ts` | Codex-style TUI footer replacement component |
| `src/goal/command.ts` | `/goal` argument parsing (show/pause/resume/clear/setObjective) |
| `src/goal/validation.ts` | Objective + token budget validation |
| `src/goal/errors.ts` | Typed store errors |
| `test/` | Vendored characterization suite (bun:test; assertions identical to upstream) |
| `scripts/qa/drive.mjs` | Live QA driver: real pi CLI in RPC mode, isolated `PI_CODING_AGENT_DIR`, scripted mock provider, `--self-test` |
| `scripts/qa/mock-provider/` | Self-contained scripted provider extension (no network, no keys) |

## Codex alignment

The goal tool contract is aligned with codex `codex-rs/ext/goal`:

- `update_goal` accepts `complete` and `blocked` (codex `spec.rs` enum); `blocked` is a real,
  model-settable, non-terminal status (resumable via `/goal resume`).
- `create_goal` replaces only a `complete` goal and otherwise fails with the codex
  "unfinished goal" message.
- Tool/parameter descriptions, the `update_goal` error text, and the completion budget report
  match codex verbatim; `budgetLimited` is preserved when `paused` or `blocked` is requested.
- The hidden continuation and budget-limit prompts use the codex `templates/goals/*.md`
  content (`<objective>` tag; the continuation prompt carries the Continuation behavior /
  Work from evidence / Progress visibility / Fidelity / Completion audit / Blocked audit
  sections). The budget-limit prompt is queued at most once per goal id.
- Continuation is not queued after a turn that did not end cleanly (last assistant
  `stopReason` is `error`, or the last tool result was aborted), mirroring codex's
  turn-error loop prevention (codex sets the goal `blocked`; pi's harness has no turn-error
  signal, so it gates the auto-continuation instead).
- Deliberate deviation: pi omits `usage_limited` (codex sets it from a system
  `UsageLimitExceeded` turn error, not the model; the Pi harness exposes no such signal).

## Conventions

- Vendored source: keep diffs against upstream intentional and reviewable. Tests were
  converted vitest -> bun:test with byte-identical assertions; the fake clock is anchored
  at a non-zero epoch because Bun's `setSystemTime(new Date(0))` acts as a reset.
- Peer deps (`@mariozechner/pi-*`, `typebox`) resolve from the host Pi runtime; pinned
  devDependencies exist only for typecheck + tests + live QA.
- This package is not wired into any OpenCode/Codex/omo-senpi component. It ships as a
  standalone Pi package surface (`pi.extensions` manifest field).

## QA

```sh
bun test packages/pi-goal                      # unit/characterization gate
tsgo --noEmit -p packages/pi-goal/tsconfig.json
node packages/pi-goal/scripts/qa/drive.mjs --self-test
node packages/pi-goal/scripts/qa/drive.mjs     # live pi-harness proof (RPC mode, sandboxed)
```

The live driver is the real-harness gate: unit tests alone never prove the extension
works under pi. Evidence goes to `.omo/evidence/<date>-<slug>/`.

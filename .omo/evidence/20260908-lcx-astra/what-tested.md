# What was tested

PR A, plan todos 1-7, branch `lcx/astra-default-models`. This ship-evidence task started at `88089721c34756d1f1062a13525bcfbfb623ee7a`, with a clean worktree and Bun 1.4.0. The branch fork recorded in the task evidence is `7c1c66c61b83a0dce97e2b30f9d8971a1ff7d881`. No product source, test suite, installed skill, or generated product file was edited by this task.

## Existing implementation evidence, reviewed for this handoff

| Todo | Surface and evidence |
| --- | --- |
| 1 | Rules-engine model selection and truncator exemption; canonical rules-component Vitest suite; isolated SessionStart CLI payloads for Astra, Astra-fast, and GPT-5.5. See `task-1-hephaestus-gpt6.log`, `task-1-preset-mapping.md`, and `task-1-doneclaim.json`. The preset reconciliation uses the actual 30-entry senpi preset at `2702cc70a49ecbdd5ece5264451ca8f1cede6ebb`, not the plan's stale 28-entry description. |
| 2 | Three catalog sources, normalized parity, legacy Sol upgrade and custom-model preservation. See `task-2-catalog.log`, `task-2-red.log`, and `task-2-green.log`. The earlier deferred real-install cases are exercised below. |
| 3 | Astra/Astra-fast 600k budgets and unknown-model 200k fallback, plus PostCompact marking followed by SessionStart compact recovery with real project-rule files and a 760k retained transcript. See `task-3-budget.log` and `task-3-red-green.log`. |
| 4 | No cap insertion/raising; removal of managed 1000/16 values; custom-value preservation; GPT-6 V2 fallback; quoted/escaped keys and inline comments; V2 removal of the V1-only agents cap; committed bundle freshness. See `task-4-concurrency.log`, `task-4-red-green.log`, and `task-4-doneclaim.json`. |
| 5 | All 12 agent TOMLs use Astra, managed reasoning upgrades, preservation of customized reasoning. See `task-5-agents.log`, `task-5-red-green.log`, and `task-5-regression.log`. |
| 6 | Five documentation surfaces describe Astra, the Sol legacy profile, no forced caps, and the V2 exception. See `task-6-docs.log`, `task-6-red.log`, and `task-6-doneclaim.json`. |

The reconstruction logs explicitly distinguish later failing-first reconstruction from original implementation-time test order. They are not retroactive claims of original TDD order.

## Remote gates already executed

`task-gate-a-remote-tests.log` captures mengmotaMac gates at `e87691a6a3631a4736141610e025c8d546ab53b8`: scoped Bun installer/rules-engine/bundle tests [a], canonical rules Vitest [b], Node plugin suite [c], full `test:codex` [d], and markdown audit [e]. It also captures the full `test:codex` rerun at `b8485e334ebf4614a9e339d722befd4f6070f60a`, the branch/dev installer comparison, and gorky A/B classification and cleanup receipts. These are reviewed prior results, not new remote executions in todo 7. `git diff --name-only e87691a6a HEAD` showed only that evidence log changed through the starting HEAD.

## Todo 7 commands and real surfaces

- `bun --version`: 1.4.0.
- `bun run build:codex-install`: exit 0, followed by clean `git status --porcelain`.
- `bun --cwd packages/omo-codex/plugin run build`: exit 0 but only printed usage on this Bun version. The actual build was therefore executed as `(cd packages/omo-codex/plugin && bun run build)`, exit 0. Both outputs remain in `task-7-ship.log`.
- `./node_modules/.bin/tsgo --noEmit -p packages/omo-codex/tsconfig.json`: exit 0 (`task-7-typecheck.log`).
- `scripts/install-verify.sh --self-test`, then `--keep` for a separate fresh real install. Inspected parsed installed TOML, 12 role blocks and files, both installed manifest surfaces, and cap absence. See `task-7-install-self-test.log`, `task-7-install-fresh.log`, and `task-7-fresh-assertions.json`.
- Real committed-bundle installs with a legacy Sol/650k/high/plan-xhigh seed and both 1000 caps, a Terra/medium/custom V2 cap 4 seed, and an explorer customized to xhigh. Seeds, resulting configs, installer output, and assertion JSON are the corresponding `task-7-legacy-*`, `task-7-preservation-*`, and `task-7-agent-preservation-*` artifacts.
- Malformed-config negative case: an unterminated model string, real installer, exit code and before/after bytes. See `task-7-malformed-*`. This case failed its expected refusal contract; it is not counted as a pass.
- Real `/opt/homebrew/bin/codex` 0.144.1: `scripts/app-server-drive.sh --self-test`, then `--plugin --expect sessionStart,userPromptSubmit`, with the skill's local `mock-model` provider. Full captured results are `task-7-app-server-*.log`; exact per-component start/completion pairs are in `task-7-hook-pairs.json`. The plugin run proved those hook pairs but did not complete the turn before the driver deadline.
- Reused the identical raw-pipe SessionStart evidence at `task-1-hephaestus-gpt6.log:1380`, `:1382`, and `:1384`. `task-7-session-start-reuse.log` checks the current shipped body against those captured payload results and displays Astra's `based on GPT-6` introduction.

The QA-only `task-7-cqa-env.sh` adapter replaces the original helper's sleep-based mock readiness polling with a FIFO read of the exact `MOCK_LISTENING` event, bounded at 10 seconds. It changes neither the mock server, app-server protocol client, expected hooks, nor product/skill source. Installer invocations were sequential because they rebuild shared worktree outputs.

## Isolation

Every real install and Codex process used fresh CODEX_HOME, HOME, XDG directories, and sandboxed bin paths. No real auth files or real `.omo` state were copied or inspected. Because the inner scripts see a sandbox HOME, their `ABSENT` checksum refers to that sandbox; the outer wrappers separately guard the actual user's config before/after and remove their scratch directories.

Real `~/.codex/config.toml` SHA-1 before: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

Real `~/.codex/config.toml` SHA-1 after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`.

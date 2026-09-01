# F4 FINAL VERIFICATION - Scope Fidelity

Result: **FAIL**

Audit base: `origin/dev..HEAD`
Branch: `feat/memory-v2-active-learning`
Audited worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning`
Date: 2026-08-10

## 1. Nothing beyond the plan shipped - FAIL

Commands run:

```text
git diff origin/dev..HEAD --stat
git log --oneline origin/dev..HEAD
git diff --name-status origin/dev..HEAD
git log --reverse --format='COMMIT %H %s' --name-status origin/dev..HEAD
```

Observed totals at final capture: **300 changed files**, **31,009 insertions**, **459 deletions**, and **41 commits**. (F1/F2 evidence commits landed concurrently during this audit; the final appendices and mapping include them.)

### Commit-to-todo map

Every commit is mapped below. "Exception" means an artifact explicitly allowed by the task/PR disclosure rather than implementation scope.

| Commit | Mapping | Finding |
|---|---|---|
| `424de4954` F2 code-quality evidence | Exception: final review-record document | PASS |
| `a7128e300` F1 plan-compliance evidence | Exception: final review-record document | PASS |
| `6a50215b0` plan + draft creation | Exception: plan/draft documents | PASS |
| `5bca65f69` reminder rewrite | Todo 2 | PASS |
| `3e00693d8` schema/defaults/config wiring | Todo 1 | PASS |
| `8d0a1a5b1` memory-discipline seed | Todo 4 | PASS |
| `872d1ee2a` reflection enabled guard | Todo 23 | PASS |
| `2f9b0d24f` sleeptime display | Todo 5 | PASS |
| `2bba9d7b4` skills-usage ledger | Todo 11 | PASS |
| `30ce8cf20` review ledger update | Exception: review-record document | PASS |
| `224638c56` people format plus persona seed | Todos 16 and 6 | PASS; PR disclosure is truthful: `packages/memory-core/src/seeds/default-memory.ts` contains persona-v2 content in this commit alongside todo-16 files |
| `a4dd860bc` dream persona | Todo 15 | PASS |
| `eb8a46895` Windows/reconciliation contract correction | Plan document correction supporting Todos 13/25 | PASS |
| `3a56dac04` review ledger update | Exception: review-record document | PASS |
| `82c967666` configuration reference | Todo 1 feature documentation (and later Todo 20 audit) | PASS |
| `b9f030925` palace people graph | Todo 19 | PASS |
| `c5cf7ea46` durable facts queue | Todo 8 | PASS |
| `3347fd4cc` frontmatter hook plus supervisor | Required hook fix + Todo 25 | PASS; PR disclosure is truthful: supervisor source/tests/build/install files are present in this commit |
| `374a6bf31` deadline/watermark plan correction | Plan document correction supporting Todos 8/13/25 | PASS |
| `67093ab26` review ledger update | Exception: review-record document | PASS |
| `e742edfee` supervisor subject marker | Todo 25 marker | PASS; commit is genuinely empty (`diff-tree` file count 0), matching disclosure |
| `b83b08e10` nudge | Todo 3 | PASS |
| `2392ea85b` dream selector | Todo 24 | PASS |
| `f10944019` people test type narrowing | Required Todo 16 verification fix | PASS |
| `6cf4e8589` non-destructive recovery correction | Plan document correction supporting Todos 9/13 | PASS |
| `f35dd0966` review ledger update | Exception: review-record document | PASS |
| `ed06375a4` soul v2 + identity in self | Todo 6 | PASS |
| `015e0e877` persona prose ASCII correction | Todo 6 shipped persona content correction | PASS |
| `380cadaf6` bundle budget measurement | Exception: review/measurement record | PASS |
| `b0fb0f0ef` facts extractor | Todo 9 | PASS |
| `f68a5da3d` IC-8 containment/self-deadline | Todo 25 | PASS |
| `aa67348b2` dream reservation and reconciliation | Todo 13 | PASS |
| `730b84aa1` soul notices, MCP receipts, build shebang | Todo 7, with required build fix | PASS |
| `755d55dc1` dream worker dispatch | Todo 22 | PASS |
| `94ca3419f` docs/divergence audit | Todo 20 | PASS |
| `b0563df6a` person routing | Todo 17 | PASS |
| `c029016a0` people command | Todo 18 | PASS |
| `43e47c610` merge dev to pick up senpi pin | **No todo** | **FAIL**: prerequisite merge is not one of the 25 plan todos or a listed PR-body exception; more importantly, the branch is now stale against current `origin/dev` and exposes release regressions listed below |
| `9712e827f` shutdown drain | Todo 10 | PASS |
| `c639c261c` command config population | Required Todo 18 wiring fix | PASS |
| `e9bd18c0b` dream trigger | Todo 12 | PASS |
| `d97ed50c8` dream command/staging | Todo 14 | PASS |

Todo 21 is explicitly optional and belongs to the separate `../senpi` repository; no source change for it appears in this repo diff.

### File-to-todo map

All final changed files are covered by these exhaustive groups:

- `.omo/plans/memory-v2-active-learning.md` and `.omo/drafts/memory-v2-active-learning.md`: documented plan/draft exceptions.
- `.omo/evidence/omo-senpi-adapter/memory-v2/task-N/**`: the matching Todo N's evidence; `bundle-budget/measurement.md` and final-review `F1/**`/`F2/**` are documented review-record exceptions.
- `assets/omo.schema.json`, `packages/omo-config-core/src/schema/memory.ts`, `memory.test.ts`, and `memory-config-wiring.test.ts`: Todo 1.
- `docs/reference/configuration.md`: Todos 1/20. `packages/omo-senpi/src/components/memory/AGENTS.md`: Todo 20.
- `packages/memory-core/src/compile/**`: Todos 2, 3, 6, and 7 according to reminder, bounded cache, self projection, and notice metadata changes.
- `packages/memory-core/src/seeds/memory-discipline.ts`, `seeds/index.ts`, `seeds/seeds.ts`, and `seeds/seeds.test.ts`: Todo 4; `seeds/default-memory.ts`: Todos 6 and 16.
- `packages/memory-core/src/git/repo.ts` and `repo.test.ts`: Todo 3's required `GitMemoryRepo.log` API.
- `packages/memory-core/src/tools/**`: Todos 3 and 7 provenance/commit-result seams.
- `packages/memory-core/src/soul/**`: Todo 7.
- `packages/memory-core/src/facts/queue*`, `facts/schema.ts`, identity runtime-layout changes, and facts queue lock-domain changes: Todo 8.
- `packages/memory-core/src/facts/assets/**`, `facts/extraction*`, initial facts runner/wiring/spawn files: Todo 9; `facts/person-routing.ts` and later extraction changes: Todo 17.
- `packages/memory-core/src/journal/fsync.ts`, journal store changes, `shutdown-drain*`, and shutdown wiring: Todo 10.
- `packages/omo-senpi/src/components/memory/skills-usage*`, related lock-domain/memfs/wiring changes: Todo 11.
- `dream-trigger*`: Todo 12.
- reflection machine/reservation/worktree changes and worker ledger/finalization/liveness/reconciliation/sentinel files: Todo 13.
- `commands/dream*` plus associated command registration/staging/worker adjustments: Todo 14.
- reflection dream-persona source and packaged copy: Todo 15.
- `packages/memory-core/src/people/**`, frontmatter model/tests, human seed: Todo 16.
- `commands/people*` and command registration/types: Todo 18.
- `palace/**` people panel and fixture support: Todo 19.
- dream worker fixture/dispatch and runner/spawn changes: Todo 22.
- reflection trigger and `/reflect` guard changes: Todo 23.
- `dream-selector*`: Todo 24.
- supervisor implementation, fixtures/tests, run-artifact/process-identity support, build/install/native payload lists: Todo 25.
- Shared memory component files (`index*`, `identity-runtime.ts`, `context*`, `prompt*`, `tools*`, `wiring.ts`, worker `runner*`/`spawn.ts`/`completion*`) are touched by the specific todos above; their commit ownership is shown in the commit map and contains no separate feature/refactor.
- `packages/memory-core/src/index.ts`, `facts/index.ts`, `people/index.ts`, `soul/index.ts`, `locks/index.ts`, and worker `index.ts` are export wiring required by their mapped feature modules.

#### Unmapped final files - release/version regression

**FAIL:** current `origin/dev` contains `0bfce05c0 release: v5.0.0-beta.5`, while the branch still resolves these **67 files** to beta.4-era package metadata. They are present in `git diff origin/dev..HEAD`, do not implement any memory-v2 todo, and would regress the base release/package graph:

```text
bun.lock
package.json
packages/oh-my-opencode-darwin-arm64/package.json
packages/oh-my-opencode-darwin-x64-baseline/package.json
packages/oh-my-opencode-darwin-x64/package.json
packages/oh-my-opencode-linux-arm64-musl/package.json
packages/oh-my-opencode-linux-arm64/package.json
packages/oh-my-opencode-linux-x64-baseline/package.json
packages/oh-my-opencode-linux-x64-musl-baseline/package.json
packages/oh-my-opencode-linux-x64-musl/package.json
packages/oh-my-opencode-linux-x64/package.json
packages/oh-my-opencode-windows-arm64/package.json
packages/oh-my-opencode-windows-x64-baseline/package.json
packages/oh-my-opencode-windows-x64/package.json
packages/omo-codex/package.json
packages/omo-codex/plugin/.codex-plugin/plugin.json
packages/omo-codex/plugin/components/bootstrap/hooks/hooks.json
packages/omo-codex/plugin/components/bootstrap/package.json
packages/omo-codex/plugin/components/codegraph/package.json
packages/omo-codex/plugin/components/comment-checker/hooks/hooks.json
packages/omo-codex/plugin/components/comment-checker/package.json
packages/omo-codex/plugin/components/git-bash/hooks/hooks.json
packages/omo-codex/plugin/components/git-bash/package.json
packages/omo-codex/plugin/components/lazycodex-executor-verify/hooks/hooks.json
packages/omo-codex/plugin/components/lazycodex-executor-verify/package.json
packages/omo-codex/plugin/components/lsp/hooks/hooks.json
packages/omo-codex/plugin/components/lsp/package.json
packages/omo-codex/plugin/components/rules/hooks/hooks.json
packages/omo-codex/plugin/components/rules/package.json
packages/omo-codex/plugin/components/start-work-continuation/hooks/hooks.json
packages/omo-codex/plugin/components/start-work-continuation/package.json
packages/omo-codex/plugin/components/teammode/hooks/hooks.json
packages/omo-codex/plugin/components/teammode/package.json
packages/omo-codex/plugin/components/telemetry/hooks/hooks.json
packages/omo-codex/plugin/components/telemetry/package.json
packages/omo-codex/plugin/components/ultrawork/hooks/hooks.json
packages/omo-codex/plugin/components/ultrawork/package.json
packages/omo-codex/plugin/components/ulw-loop/hooks/hooks.json
packages/omo-codex/plugin/components/ulw-loop/package.json
packages/omo-codex/plugin/hooks/post-compact-resetting-git-bash-mcp-reminder.json
packages/omo-codex/plugin/hooks/post-compact-resetting-lsp-diagnostics-cache.json
packages/omo-codex/plugin/hooks/post-compact-resetting-project-rule-cache.json
packages/omo-codex/plugin/hooks/post-tool-use-checking-codegraph-init-guidance.json
packages/omo-codex/plugin/hooks/post-tool-use-checking-comments.json
packages/omo-codex/plugin/hooks/post-tool-use-checking-lsp-diagnostics.json
packages/omo-codex/plugin/hooks/post-tool-use-checking-thread-title-hygiene.json
packages/omo-codex/plugin/hooks/post-tool-use-matching-project-rules.json
packages/omo-codex/plugin/hooks/pre-tool-use-enforcing-unlimited-goal-budget.json
packages/omo-codex/plugin/hooks/pre-tool-use-guarding-ulw-loop-spawns.json
packages/omo-codex/plugin/hooks/pre-tool-use-recommending-git-bash-mcp.json
packages/omo-codex/plugin/hooks/session-start-checking-auto-update.json
packages/omo-codex/plugin/hooks/session-start-checking-bootstrap-provisioning.json
packages/omo-codex/plugin/hooks/session-start-checking-codegraph-bootstrap.json
packages/omo-codex/plugin/hooks/session-start-loading-project-rules.json
packages/omo-codex/plugin/hooks/session-start-recording-session-telemetry.json
packages/omo-codex/plugin/hooks/stop-checking-start-work-continuation.json
packages/omo-codex/plugin/hooks/stop-checking-ulw-loop-resume.json
packages/omo-codex/plugin/hooks/subagent-stop-checking-start-work-continuation.json
packages/omo-codex/plugin/hooks/subagent-stop-verifying-lazycodex-executor-evidence.json
packages/omo-codex/plugin/hooks/user-prompt-submit-checking-ultrawork-trigger.json
packages/omo-codex/plugin/hooks/user-prompt-submit-checking-ulw-loop-steering.json
packages/omo-codex/plugin/hooks/user-prompt-submit-loading-project-rules.json
packages/omo-codex/plugin/package-lock.json
packages/omo-codex/plugin/package.json
packages/omo-native/package.json
packages/omo-senpi/package.json
packages/omo-senpi/plugin/package.json
```

Representative evidence:

```diff
- "version": "5.0.0-beta.5"
+ "version": "5.0.0-beta.4"
```

from `git diff origin/dev..HEAD -- package.json`, with the same beta.5 -> beta.4 regression across the package manifests, hook descriptors, and lockfiles above.

### Required incidental fixes are load-bearing - PASS

- **Pre-commit hook `kind`/`aliases`:** `packages/memory-core/src/memfs/hooks-scripts.ts` allows only `ALL_KNOWN_KEYS`; without adding `kind aliases`, Todo 16's seeded people frontmatter is rejected and fresh repo initialization cannot commit. This is runtime-blocking, not cleanup.
- **People test typing:** `f10944019` narrows optional `observations`; its commit message records 23 TS18048 errors. The package typecheck fails without it. It changes tests only and adds no behavior.
- **Command wiring config population:** `packages/omo-senpi/src/components/memory/wiring.ts:314-317` now returns `{ settings: resolved.memory, config: resolved }`; Todo 18 `/people --ask` needs the full config to resolve a user `categories.quick` pin. Without it, the feature ignores configured model resolution.
- **Build-extension shebang:** `packages/omo-senpi/plugin/scripts/build-extension.mjs:189-195` preserves a shebang at byte 0. The code comment correctly identifies the failure: prepending the build marker makes executable MCP/supervisor bundles unstartable under Node. Required for Todos 7/25.
- **MCP provenance matcher:** `tool-metadata.ts:9-13` uses senpi's real catalog event names (`mcp_omo-memory_memory` and `mcp_omo-memory_memory_apply_patch`); `nudge-wiring.test.ts:247-265` exercises the apply-patch name. Without exact matching, identity/provenance is not injected on the actual MCP surface, breaking Todos 3/7 and IC-17.

## 2. Constants intact - PASS

- **Facts extractor pinned quick/no facts category knob:** `packages/omo-senpi/src/components/memory/facts-runner.ts:39` declares `QUICK_CATEGORY = "quick"`; lines 116-120 resolve exactly that category and warn/skip when unavailable. `packages/omo-config-core/src/schema/memory.ts:44-50` defines facts with only `enabled` and `debounce_settles`; no `category` field exists in either root or layer facts schemas (`:115-118`).
- **Shutdown drain exactly 1500 ms:** `packages/omo-senpi/src/components/memory/shutdown-drain.ts:10-11` declares `SESSION_SHUTDOWN_DRAIN_BUDGET_MS = 1500`; `:54-56` computes the absolute deadline from that constant.
- **`/people` newest 20 per level fixed:** `packages/omo-senpi/src/components/memory/commands/people.ts:40-41` declares `OBSERVATIONS_PER_LEVEL = 20`; `:57-70` sorts each level newest-first and slices to that constant unless `--all` is used.
- **Nudge cache bounded one entry per (template, identity, sessionId):** `packages/memory-core/src/compile/cache.ts:35-43` keys the map by template hash + `agentId` + `conversationId` and replaces the same key whenever HEAD/nudge/soul variant changes. Here `agentId` is identity and `conversationId` is the bound session partition. No append-only generation key is used.

## 3. Defaults byte-for-byte - PASS

No three-way mismatch found among:

- schema resolved defaults: `packages/omo-config-core/src/schema/memory.ts:161-190`;
- adapter fallback: `packages/omo-senpi/src/components/memory/index.ts:24-52`;
- identity-runtime fallback: `packages/omo-senpi/src/components/memory/identity-runtime.ts:27-55`.

All three agree with the requested contract:

```text
tool_exposure=direct
reflection.trigger.step_count=25
nudge.every_user_turns=10
facts.debounce_settles=4
dream.idle_minutes=30
dream.min_hours_between=24
dream.shutdown_launch=true
dream.auto_select_max=5
dream.auto_select_max_chars=150000
people.max_entries=40
people.max_entry_chars=200
soul.edit_notice=true
compile_warn_tokens=30000
```

The schema's field defaults and containing-object defaults also agree (`memory.ts:8,14,40,49,58-62,71-72,80` and `:166-189`).

## 4. Documentation defaults - PASS

`docs/reference/configuration.md:608-706` matches schema defaults exactly:

- root: `tool_exposure "direct"`, `compile_warn_tokens 30000` (`:630-631`);
- reflection: `step_count 25` (`:645`);
- nudge: `every_user_turns 10` (`:659`);
- facts: `debounce_settles 4` (`:668`);
- dream: `idle_minutes 30`, `min_hours_between 24`, `shutdown_launch true`, `auto_select_max 5`, `auto_select_max_chars 150000` (`:678-682`);
- people: `max_entries 40`, `max_entry_chars 200` (`:691-692`);
- soul: `edit_notice true` (`:698`).

## Final verdict

**F4: FAIL**

Failing item: Check 1 scope fidelity. The branch is stale against current `origin/dev` and introduces an unmapped beta.5 -> beta.4 release/package metadata regression across 67 files; merge commit `43e47c610` itself also does not map to a plan todo or listed exception. Checks 2, 3, and 4 pass.

## Appendix A - Full `git diff origin/dev..HEAD --stat` output

```text
 .omo/drafts/memory-v2-active-learning.md           |  211 ++
 .../omo-senpi-adapter/memory-v2/F1/compliance.md   |   56 +
 .../omo-senpi-adapter/memory-v2/F2/quality.md      |  147 ++
 .../memory-v2/bundle-budget/measurement.md         |   42 +
 .../omo-senpi-adapter/memory-v2/task-1/test.txt    |  143 ++
 .../omo-senpi-adapter/memory-v2/task-10/test.txt   |  103 +
 .../omo-senpi-adapter/memory-v2/task-11/GREEN.txt  |   30 +
 .../omo-senpi-adapter/memory-v2/task-11/RED.txt    |   49 +
 .../omo-senpi-adapter/memory-v2/task-12/test.txt   |   74 +
 .../memory-v2/task-13/discrepancies.txt            |    6 +
 .../omo-senpi-adapter/memory-v2/task-13/green.txt  |  129 ++
 .../memory-v2/task-13/package-gate.txt             | 1674 +++++++++++++++
 .../omo-senpi-adapter/memory-v2/task-13/plan.txt   |   11 +
 .../omo-senpi-adapter/memory-v2/task-13/red.txt    |  225 ++
 .../omo-senpi-adapter/memory-v2/task-13/test.txt   |   34 +
 .../memory-v2/task-13/typecheck-memory-core.txt    |    1 +
 .../memory-v2/task-13/typecheck-omo-senpi.txt      |    1 +
 .../omo-senpi-adapter/memory-v2/task-14/test.txt   |  150 ++
 .../omo-senpi-adapter/memory-v2/task-15/notes.md   |   27 +
 .../omo-senpi-adapter/memory-v2/task-15/test.txt   |    7 +
 .../omo-senpi-adapter/memory-v2/task-16/GREEN.txt  |  163 ++
 .../omo-senpi-adapter/memory-v2/task-16/RED.txt    |  252 +++
 .../memory-v2/task-16/qa-by-read.md                |   29 +
 .../omo-senpi-adapter/memory-v2/task-17/test.txt   |  272 +++
 .../omo-senpi-adapter/memory-v2/task-18/test.txt   |   39 +
 .../omo-senpi-adapter/memory-v2/task-19/GREEN.txt  |   46 +
 .../omo-senpi-adapter/memory-v2/task-19/RED.txt    |   65 +
 .../memory-v2/task-19/palace.html                  |  478 +++++
 .../memory-v2/task-19/qa-by-read.md                |   32 +
 .../memory-v2/task-19/typecheck.txt                |    2 +
 .../omo-senpi-adapter/memory-v2/task-2/test.txt    |   73 +
 .../memory-v2/task-20/findings.md                  |   86 +
 .../omo-senpi-adapter/memory-v2/task-22/test.txt   |   50 +
 .../omo-senpi-adapter/memory-v2/task-23/test.txt   |   78 +
 .../omo-senpi-adapter/memory-v2/task-24/green.txt  |   29 +
 .../memory-v2/task-24/memory-suite.txt             |  399 ++++
 .../memory-v2/task-24/package-gate.txt             | 1592 ++++++++++++++
 .../omo-senpi-adapter/memory-v2/task-24/red.txt    |   15 +
 .../omo-senpi-adapter/memory-v2/task-24/test.txt   |   26 +
 .../memory-v2/task-25/ic8-compliance.txt           |   87 +
 .../omo-senpi-adapter/memory-v2/task-25/qa.txt     |    9 +
 .../omo-senpi-adapter/memory-v2/task-25/test.txt   | 2206 ++++++++++++++++++++
 .../memory-v2/task-3/senpi-run.txt                 |   39 +
 .../omo-senpi-adapter/memory-v2/task-3/test.txt    |  359 ++++
 .../omo-senpi-adapter/memory-v2/task-4/test.txt    |   42 +
 .../omo-senpi-adapter/memory-v2/task-5/GREEN.txt   |   37 +
 .../omo-senpi-adapter/memory-v2/task-5/RED.txt     |   41 +
 .../memory-v2/task-6/full-runs.txt                 |   32 +
 .../omo-senpi-adapter/memory-v2/task-6/green.txt   |   62 +
 .../memory-v2/task-6/qa-by-read.md                 |   53 +
 .../omo-senpi-adapter/memory-v2/task-6/red.txt     |  134 ++
 .../omo-senpi-adapter/memory-v2/task-6/test.txt    |   48 +
 .../omo-senpi-adapter/memory-v2/task-7/green.txt   |  136 ++
 .../memory-v2/task-7/red-core.txt                  |  107 +
 .../memory-v2/task-7/red-senpi.txt                 |  237 +++
 .../memory-v2/task-7/senpi-run-driver.mjs          |  152 ++
 .../memory-v2/task-7/senpi-run.txt                 |   26 +
 .../omo-senpi-adapter/memory-v2/task-7/test.txt    |   92 +
 .../memory-v2/task-7/tui-render-driver.mjs         |  239 +++
 .../memory-v2/task-7/tui-render.txt                |   10 +
 .../memory-v2/task-8/green-affected-suites.txt     |   20 +
 .../memory-v2/task-8/green-facts-queue.txt         |   24 +
 .../memory-v2/task-8/green-facts-wiring.txt        |   16 +
 .../memory-v2/task-8/green-memory-core-suite.txt   |    8 +
 .../omo-senpi-adapter/memory-v2/task-8/red.txt     |   33 +
 .../omo-senpi-adapter/memory-v2/task-8/test.txt    |   73 +
 .../memory-v2/task-8/typecheck-and-baseline.txt    |   17 +
 .../memory-v2/task-9/discrepancies.txt             |    5 +
 .../memory-v2/task-9/green-facts-suites.txt        |   50 +
 .../memory-v2/task-9/implementation-plan.md        |   10 +
 .../memory-v2/task-9/package-gate.txt              | 1756 ++++++++++++++++
 .../memory-v2/task-9/red-core.txt                  |   14 +
 .../memory-v2/task-9/red-skip-path.txt             |   14 +
 .../memory-v2/task-9/senpi-run.txt                 |   26 +
 .../omo-senpi-adapter/memory-v2/task-9/test.txt    |  305 +++
 .omo/plans/memory-v2-active-learning.md            |  468 +++++
 assets/omo.schema.json                             | 1238 ++++++++++-
 bun.lock                                           |   30 +-
 docs/reference/configuration.md                    |  110 +
 package.json                                       |   26 +-
 packages/memory-core/src/compile/cache.test.ts     |   47 +-
 packages/memory-core/src/compile/cache.ts          |   17 +-
 packages/memory-core/src/compile/compile.test.ts   |  114 +-
 packages/memory-core/src/compile/compile.ts        |   47 +-
 .../src/compile/fixtures/full.golden.txt           |    2 +-
 .../compile/fixtures/persona-identity.golden.txt   |   26 +
 .../src/compile/fixtures/persona-only.golden.txt   |    2 +-
 packages/memory-core/src/facts/assets/assets.ts    |    9 +
 .../memory-core/src/facts/assets/facts-persona.md  |   18 +
 packages/memory-core/src/facts/extraction.test.ts  |  436 ++++
 packages/memory-core/src/facts/extraction.ts       |  248 +++
 packages/memory-core/src/facts/index.ts            |   45 +
 packages/memory-core/src/facts/person-routing.ts   |  269 +++
 packages/memory-core/src/facts/queue.test.ts       |  369 ++++
 packages/memory-core/src/facts/queue.ts            |  260 +++
 packages/memory-core/src/facts/schema.ts           |  239 +++
 packages/memory-core/src/git/repo.test.ts          |   43 +
 packages/memory-core/src/git/repo.ts               |   64 +
 packages/memory-core/src/identity/layout.test.ts   |    8 +
 packages/memory-core/src/identity/layout.ts        |   12 +
 packages/memory-core/src/index.ts                  |    3 +
 packages/memory-core/src/journal/fsync.ts          |   40 +
 packages/memory-core/src/journal/store.test.ts     |   97 +-
 packages/memory-core/src/journal/store.ts          |   39 +-
 packages/memory-core/src/locks/domains.test.ts     |   24 +-
 packages/memory-core/src/locks/domains.ts          |   15 +
 packages/memory-core/src/locks/index.ts            |    5 +
 .../src/memfs/frontmatter-kind-aliases.test.ts     |  286 +++
 packages/memory-core/src/memfs/frontmatter.ts      |   60 +-
 packages/memory-core/src/memfs/hooks-scripts.ts    |    6 +-
 packages/memory-core/src/people/format.test.ts     |  463 ++++
 packages/memory-core/src/people/format.ts          |  329 +++
 packages/memory-core/src/people/index.ts           |    2 +
 .../src/reflection/assets/assets.test.ts           |   32 +-
 .../memory-core/src/reflection/assets/assets.ts    |    9 +-
 .../src/reflection/assets/dream-persona.md         |  165 ++
 .../memory-core/src/reflection/machine.test.ts     |   72 +-
 packages/memory-core/src/reflection/machine.ts     |   40 +-
 .../memory-core/src/reflection/reservation.test.ts |   46 +-
 packages/memory-core/src/reflection/reservation.ts |   75 +-
 .../memory-core/src/reflection/worktree.test.ts    |   23 +
 packages/memory-core/src/reflection/worktree.ts    |   20 +-
 packages/memory-core/src/seeds/default-memory.ts   |   51 +-
 packages/memory-core/src/seeds/index.ts            |    1 +
 .../memory-core/src/seeds/memory-discipline.ts     |   65 +
 packages/memory-core/src/seeds/seeds.test.ts       |   37 +-
 packages/memory-core/src/seeds/seeds.ts            |   21 +-
 packages/memory-core/src/soul/index.ts             |    3 +
 packages/memory-core/src/soul/paths.ts             |   19 +
 packages/memory-core/src/soul/watermark.test.ts    |  176 ++
 packages/memory-core/src/soul/watermark.ts         |  112 +
 .../src/tools/memory-apply-patch.test.ts           |   19 +
 .../memory-core/src/tools/memory-apply-patch.ts    |   29 +-
 packages/memory-core/src/tools/memory.test.ts      |   26 +
 packages/memory-core/src/tools/memory.ts           |   40 +-
 packages/memory-core/src/tools/soul-edit.test.ts   |  200 ++
 packages/oh-my-opencode-darwin-arm64/package.json  |    2 +-
 .../package.json                                   |    2 +-
 packages/oh-my-opencode-darwin-x64/package.json    |    2 +-
 .../oh-my-opencode-linux-arm64-musl/package.json   |    2 +-
 packages/oh-my-opencode-linux-arm64/package.json   |    2 +-
 .../oh-my-opencode-linux-x64-baseline/package.json |    2 +-
 .../package.json                                   |    2 +-
 .../oh-my-opencode-linux-x64-musl/package.json     |    2 +-
 packages/oh-my-opencode-linux-x64/package.json     |    2 +-
 packages/oh-my-opencode-windows-arm64/package.json |    2 +-
 .../package.json                                   |    2 +-
 packages/oh-my-opencode-windows-x64/package.json   |    2 +-
 packages/omo-codex/package.json                    |    2 +-
 .../omo-codex/plugin/.codex-plugin/plugin.json     |    2 +-
 .../plugin/components/bootstrap/hooks/hooks.json   |    2 +-
 .../plugin/components/bootstrap/package.json       |    2 +-
 .../plugin/components/codegraph/package.json       |    2 +-
 .../components/comment-checker/hooks/hooks.json    |    2 +-
 .../plugin/components/comment-checker/package.json |    2 +-
 .../plugin/components/git-bash/hooks/hooks.json    |    4 +-
 .../plugin/components/git-bash/package.json        |    2 +-
 .../lazycodex-executor-verify/hooks/hooks.json     |    2 +-
 .../lazycodex-executor-verify/package.json         |    2 +-
 .../plugin/components/lsp/hooks/hooks.json         |    4 +-
 .../omo-codex/plugin/components/lsp/package.json   |    2 +-
 .../plugin/components/rules/hooks/hooks.json       |    8 +-
 .../omo-codex/plugin/components/rules/package.json |    2 +-
 .../start-work-continuation/hooks/hooks.json       |    4 +-
 .../start-work-continuation/package.json           |    2 +-
 .../plugin/components/teammode/hooks/hooks.json    |    2 +-
 .../plugin/components/teammode/package.json        |    2 +-
 .../plugin/components/telemetry/hooks/hooks.json   |    2 +-
 .../plugin/components/telemetry/package.json       |    2 +-
 .../plugin/components/ultrawork/hooks/hooks.json   |    2 +-
 .../plugin/components/ultrawork/package.json       |    2 +-
 .../plugin/components/ulw-loop/hooks/hooks.json    |    8 +-
 .../plugin/components/ulw-loop/package.json        |    2 +-
 ...st-compact-resetting-git-bash-mcp-reminder.json |    2 +-
 ...st-compact-resetting-lsp-diagnostics-cache.json |    2 +-
 .../post-compact-resetting-project-rule-cache.json |    2 +-
 ...-tool-use-checking-codegraph-init-guidance.json |    2 +-
 .../hooks/post-tool-use-checking-comments.json     |    2 +-
 .../post-tool-use-checking-lsp-diagnostics.json    |    2 +-
 ...ost-tool-use-checking-thread-title-hygiene.json |    2 +-
 .../post-tool-use-matching-project-rules.json      |    2 +-
 ...e-tool-use-enforcing-unlimited-goal-budget.json |    2 +-
 .../pre-tool-use-guarding-ulw-loop-spawns.json     |    2 +-
 .../pre-tool-use-recommending-git-bash-mcp.json    |    2 +-
 .../hooks/session-start-checking-auto-update.json  |    2 +-
 ...sion-start-checking-bootstrap-provisioning.json |    2 +-
 ...session-start-checking-codegraph-bootstrap.json |    2 +-
 .../hooks/session-start-loading-project-rules.json |    2 +-
 .../session-start-recording-session-telemetry.json |    2 +-
 .../stop-checking-start-work-continuation.json     |    2 +-
 .../hooks/stop-checking-ulw-loop-resume.json       |    2 +-
 ...gent-stop-checking-start-work-continuation.json |    2 +-
 ...stop-verifying-lazycodex-executor-evidence.json |    2 +-
 ...r-prompt-submit-checking-ultrawork-trigger.json |    2 +-
 ...r-prompt-submit-checking-ulw-loop-steering.json |    2 +-
 .../user-prompt-submit-loading-project-rules.json  |    2 +-
 packages/omo-codex/plugin/package-lock.json        |   26 +-
 packages/omo-codex/plugin/package.json             |    2 +-
 .../src/schema/memory-config-wiring.test.ts        |   15 +-
 packages/omo-config-core/src/schema/memory.test.ts |  357 +++-
 packages/omo-config-core/src/schema/memory.ts      |  138 +-
 packages/omo-native/package.json                   |    2 +-
 packages/omo-senpi/package.json                    |    2 +-
 .../omo-senpi/plugin/extensions/dream-persona.md   |  165 ++
 packages/omo-senpi/plugin/package.json             |    2 +-
 .../omo-senpi/plugin/scripts/build-extension.mjs   |   51 +-
 .../plugin/scripts/build-extension.test.mjs        |   53 +-
 packages/omo-senpi/plugin/scripts/install.mjs      |    1 +
 packages/omo-senpi/src/components/memory/AGENTS.md |   34 +-
 .../components/memory/commands/doctor-checks.ts    |   46 +-
 .../src/components/memory/commands/doctor.test.ts  |   60 +
 .../src/components/memory/commands/doctor.ts       |    4 +
 .../components/memory/commands/dream-staging.ts    |  139 ++
 .../src/components/memory/commands/dream.test.ts   |  206 ++
 .../src/components/memory/commands/dream.ts        |  139 ++
 .../src/components/memory/commands/memfs.ts        |   33 +
 .../src/components/memory/commands/people-ask.ts   |  152 ++
 .../src/components/memory/commands/people-query.ts |   61 +
 .../components/memory/commands/people-render.ts    |   95 +
 .../components/memory/commands/people-search.ts    |   50 +
 .../src/components/memory/commands/people.test.ts  |  321 +++
 .../src/components/memory/commands/people.ts       |  187 ++
 .../src/components/memory/commands/reflect.test.ts |   47 +-
 .../src/components/memory/commands/reflect.ts      |    7 +
 .../components/memory/commands/register.test.ts    |    2 +
 .../src/components/memory/commands/register.ts     |   10 +
 .../components/memory/commands/sleeptime.test.ts   |   54 +-
 .../src/components/memory/commands/sleeptime.ts    |   95 +-
 .../src/components/memory/commands/types.ts        |   27 +-
 .../src/components/memory/context.test.ts          |    2 +
 .../omo-senpi/src/components/memory/context.ts     |    4 +
 .../src/components/memory/dream-selector.test.ts   |  198 ++
 .../src/components/memory/dream-selector.ts        |  299 +++
 .../src/components/memory/dream-trigger.test.ts    |  545 +++++
 .../src/components/memory/dream-trigger.ts         |  350 ++++
 .../src/components/memory/facts-people-payload.ts  |   45 +
 .../src/components/memory/facts-runner.test.ts     |  324 +++
 .../src/components/memory/facts-runner.ts          |  432 ++++
 .../src/components/memory/facts-wiring.test.ts     |  204 ++
 .../src/components/memory/facts-wiring.ts          |  135 ++
 .../src/components/memory/identity-runtime.ts      |   48 +-
 .../omo-senpi/src/components/memory/index.test.ts  |   16 +
 packages/omo-senpi/src/components/memory/index.ts  |   40 +-
 .../src/components/memory/memory.test-support.ts   |   15 +-
 .../src/components/memory/nudge-wiring.test.ts     |  268 +++
 .../src/components/memory/nudge-wiring.ts          |  196 ++
 .../src/components/memory/palace/command.ts        |   16 +-
 .../src/components/memory/palace/generator.test.ts |   16 +-
 .../src/components/memory/palace/generator.ts      |   25 +-
 .../src/components/memory/palace/index.ts          |   16 +-
 .../memory/palace/palace.test-support.ts           |   57 +
 .../src/components/memory/palace/people.test.ts    |  152 ++
 .../src/components/memory/palace/people.ts         |  202 ++
 .../src/components/memory/palace/template.ts       |   90 +-
 .../omo-senpi/src/components/memory/prompt.test.ts |   84 +-
 packages/omo-senpi/src/components/memory/prompt.ts |   19 +-
 .../src/components/memory/shutdown-drain.test.ts   |  264 +++
 .../src/components/memory/shutdown-drain.ts        |  145 ++
 .../src/components/memory/skills-usage.test.ts     |  390 ++++
 .../src/components/memory/skills-usage.ts          |  325 +++
 .../src/components/memory/soul-notice.test.ts      |  237 +++
 .../omo-senpi/src/components/memory/soul-notice.ts |  103 +
 .../src/components/memory/tool-metadata.ts         |    7 +
 .../src/components/memory/tool-receipts.ts         |   80 +
 .../omo-senpi/src/components/memory/tools.test.ts  |   77 +
 packages/omo-senpi/src/components/memory/tools.ts  |   42 +-
 .../src/components/memory/trigger-wiring.test.ts   |   90 +-
 .../src/components/memory/trigger-wiring.ts        |   24 +-
 packages/omo-senpi/src/components/memory/wiring.ts |  213 +-
 .../memory/worker/__fixtures__/dream-child.ts      |   69 +
 .../memory/worker/__fixtures__/facts-child.ts      |   35 +
 .../memory/worker/__fixtures__/supervisor-child.ts |   44 +
 .../worker/__fixtures__/supervisor-parent.ts       |   12 +
 .../worker/__fixtures__/supervisor-taskkill.ts     |   33 +
 .../components/memory/worker/completion.test.ts    |    4 +
 .../src/components/memory/worker/completion.ts     |    8 +-
 .../worker/dream-dispatch.integration.test.ts      |  170 ++
 .../src/components/memory/worker/index.ts          |    1 +
 .../worker/memory-run-supervisor.ic8.test.ts       |  180 ++
 .../memory-run-supervisor.integration.test.ts      |  289 +++
 .../memory/worker/memory-run-supervisor.ts         |  200 ++
 .../memory/worker/reservation-run-ledger.ts        |   87 +
 .../src/components/memory/worker/run-artifacts.ts  |   94 +
 .../components/memory/worker/run-finalization.ts   |  134 ++
 .../src/components/memory/worker/run-liveness.ts   |   41 +
 .../memory/worker/run-reconciliation.test.ts       |  236 +++
 .../components/memory/worker/run-reconciliation.ts |  143 ++
 .../src/components/memory/worker/run-sentinel.ts   |   35 +
 .../memory/worker/runner-finalization.test.ts      |   29 +
 .../memory/worker/runner.integration.test.ts       |   18 +
 .../memory/worker/runner.test-support.ts           |    2 +
 .../src/components/memory/worker/runner.ts         |   53 +-
 .../src/components/memory/worker/spawn.ts          |  441 +++-
 .../memory/worker/supervisor-process-identity.ts   |  166 ++
 packages/omo-senpi/src/install/cli-local.test.ts   |    1 +
 .../omo-senpi/src/install/install-senpi.test.ts    |   18 +
 packages/omo-senpi/src/install/install-senpi.ts    |    1 +
 packages/omo-senpi/src/mcp/memory-server.test.ts   |  161 +-
 packages/omo-senpi/src/mcp/memory-server.ts        |   84 +-
 script/build-omo-native.ts                         |    1 +
 300 files changed, 31009 insertions(+), 459 deletions(-)
```

## Appendix B - Full `git log --oneline origin/dev..HEAD` output

```text
424de4954 test(memory): F2 code quality review evidence
a7128e300 test(memory): F1 plan compliance audit evidence
d97ed50c8 feat(omo-senpi): /dream command with letta-parity auto-selector and staging
e9bd18c0b feat(memory): opportunistic dream triggers (idle, shutdown, manual)
c639c261c fix(omo-senpi): populate MemoryCommandSettings.config in loadCommandSettings
9712e827f feat(memory): bounded session_shutdown drain
43e47c610 Merge dev into feat/memory-v2-active-learning: pick up senpi pin
c029016a0 feat(omo-senpi): /people roster, relationship graph, dialectic-lite queries
b0563df6a feat(memory): person-fact routing with alias resolution and reinforcement
94ca3419f docs(memory): memory v2 configuration and divergence updates
755d55dc1 feat(memory): dream-aware worker dispatch (persona, payloads, sandbox)
730b84aa1 feat(memory): soul-edit notices (tool result, visible message, reflection delta)
aa67348b2 feat(memory-core): dream trigger kind in reflection reservation machine
f68a5da3d fix(omo-senpi): enforce IC-8 windows containment and bootstrap deadline self-enforcement
b0fb0f0ef feat(memory): quick-pinned async facts extractor
380cadaf6 docs(memory): record the bundle budget measurement and decision basis
015e0e877 fix(memory-core): drop the em dash from the shipped persona seed
ed06375a4 feat(memory): soul-grade persona seed v2 + identity.md in <self>
f35dd0966 docs(memory): record the unconditional full-scope APPROVED verdict
6cf4e8589 fix(memory): forbid destructive recovery that can discard user memory edits
f10944019 fix(memory-core): narrow optional observations in the people card tests
2392ea85b feat(omo-senpi): dream conversation selector and unreflected-volume gate
b83b08e10 feat(omo-senpi): memory nudge line after N turns without a save
e742edfee feat(omo-senpi): detached run supervisor with launch manifest and sentinel
67093ab26 docs(memory): record round 31 verdict, the empirical IC-6 defect, and round 32 bind
374a6bf31 fix(memory): close the abrupt-supervisor-death deadline hole and pin the facts watermark ordering
3347fd4cc fix(memory-core): allow kind and aliases in the pre-commit frontmatter hook
c5cf7ea46 feat(memory): durable facts queue with crash reconcile
b9f030925 feat(omo-senpi): people relationship graph in memory palace
82c967666 docs(memory-config): document the memory configuration surface
3a56dac04 docs(memory): record round 30 verdicts and round 31 bind
eb8a46895 fix(memory): specify Windows supervisor containment and reconciliation
a4dd860bc feat(memory-core): dream persona (consolidation + skill audit + people phases)
224638c56 feat(memory-core): people card + observation formats and human card seed
30ce8cf20 docs(memory): record full-scope review round 30 and self-audit receipt
2bba9d7b4 feat(memory): skills-usage ledger for dream audit
2f9b0d24f feat(omo-senpi): show nudge/facts/dream/people/soul in /sleeptime
872d1ee2a feat(omo-senpi): honor reflection.enabled in triggers and /reflect
8d0a1a5b1 feat(memory-core): seed memory-discipline skill
3e00693d8 feat(memory-config): default active learning on + nudge/facts/dream/people/soul settings
5bca65f69 feat(memory-core): sharpen always-on memory reminder (attention-first rewrite)
6a50215b0 docs(memory): add memory v2 active-learning work plan
```

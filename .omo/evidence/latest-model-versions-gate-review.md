# Gate review: latest-model-versions upstream merge

- recommendation: **APPROVE**
- scope: Source conflict resolution, preservation of both parents, and available evidence. This is **not** certification that the full gate, merge commit, or push has completed.
- blockers: []
- reviewer: omo-native-gate-reviewer / st_01a0cc43
- date: 2026-09-23
- worktree: `/Users/cminseo/Developer/omo-model-latest`
- first parent observed: `336baeeeec14ccfb31bf947b37668d1d7d1e0458`
- origin/dev and MERGE_HEAD observed: `9d5e485fbc310f10afe1fc56d0f2ce4b6ddb23be`

## originalIntent

Update PR #8699 by normally merging current origin/dev into fix/latest-model-versions, preserving upstream GPT-6 routing and the PR's restricted Opus 5.5 providers, older Opus 5 coverage, GLM 5.3, and exact pinned expectations. Regenerate conflicting tracked extensions with the repository builder, complete the three requested gates, record evidence, and then commit and push normally. No rebase, force push, or upstream PR merge.

## desiredOutcome

Users receive upstream GPT-6 choices without losing the older-provider Opus fallback. Artistry follows Fable -> restricted Opus 5.5 -> broad-provider Opus 5 -> Kimi. Core Opus 5.5 uses anthropic; Senpi retains anthropic-subscription before anthropic. The merge should not introduce unrelated source changes or weaken the routing contracts.

## userOutcomeReview

The inspected source satisfies this outcome. The complete diff against origin/dev changes only the intended source tables, their relevant tests, two generated extensions, and pre-existing PR evidence. Comparing the four production tables against HEAD separately shows the upstream GPT-6 additions/replacements and artistry reorder while preserving the PR's older Opus and GLM changes. No GPT-6 production rung or GPT-6 assertion is removed by the diff against origin/dev. The new Prometheus rung is resolved consistently rather than leaving an automatic-merge provider regression.

The recorded public-API scenarios exercise real resolver implementations with independent availability fixtures, including absent-primary fallback and empty-registry behavior. The fresh Senpi receipt proves plugin startup/hook handling with a local mock provider, not remote model availability or every routing choice. These are complementary evidence, not substitutes for the pending full gate.

## Criteria and findings

Criterion IDs below label the explicit task requirements; they do not add requirements.

| ID | Criterion | Finding |
| --- | --- | --- |
| C1 | Preserve upstream GPT-6 rungs and existing fallback policy | Satisfied in inspected source and diff. Sol 6 precedes Sol 5.6 for deep-low and Hephaestus; Luna Fast 6 is retained for quick/explore/librarian; Astra chains and their provider/variant pins remain intact. |
| C2 | Preserve PR Opus 5.5 narrowing, immediate Opus 5 fallback, GLM 5.3 | Satisfied across core agent/category and Senpi curated agent/category tables. Existing Qwen, DeepSeek, Gemini choices remain unchanged against upstream. |
| C3 | Resolve artistry and Prometheus semantics without losing upstream structure | Satisfied: artistry is Fable/5.5/5/Kimi in both tables; Prometheus is Fable xhigh/5.5 max/5 max/Kimi max. |
| C4 | Preserve exact pinned expectations; do not weaken tests | Satisfied by full literal chain expectations in the category and Senpi transcription tests and explicit Prometheus expectations. The upstream cross-rung equality for 5.5 is replaced by exact anthropic equality; the older Opus assertion is additional coverage. No tests were deleted or skipped by the reviewed delta. |
| C5 | Regenerate conflicting omo.js and omo-task.js with repository builder | Available evidence supports this: merge-build.log contains the full build chain and completed extension outputs; build-extension.mjs owns both files. Final inspected bundles contain narrowed Opus plus retained older rungs and upstream GPT-6 identifiers. Independent rebuilding was prohibited, so byte-for-byte reproducibility is not certified here. |
| C6 | Complete requested gates and record evidence before committing | Package and audit summaries inspected directly; full test:senpi explicitly pending for this review. Parent must require exit 0 before commit. Not a rejection of this expressly limited source-resolution review. |
| C7 | Normal merge and push, no unrelated changes or history rewrite | HEAD and MERGE_HEAD match the supplied parents; index has no unmerged entries. Commit and push are not yet performed and are outside this child's completion scope. |

`git diff --check` and `git diff --cached --check` both completed without output/errors. `git ls-files -u` returned no entries. No source edits, builds, tests, commits, pushes, or worktree creation were performed by this reviewer.

## Direct remove-ai-slops / programming review

Consulted the repository's `packages/shared-skills/skills/remove-ai-slops/SKILL.md`, `packages/shared-skills/skills/programming/SKILL.md`, and `packages/shared-skills/skills/programming/references/typescript/README.md`. Applied them as review criteria only, respecting the read-only merge scope and the explicit exclusion of new formatter gates/refactors.

- **Excessive/useless tests:** The merge primarily updates existing machine-consumed routing pins. The PR's four resolver regressions invoke the actual resolver, not a mocked answer. No new broad test framework or redundant test suite was introduced by conflict resolution.
- **Deletion-only/requested-removal tests:** No new deletion-only test was added in the merge delta against upstream. Existing GPT-5.6 Luna absence checks are upstream tests and are accompanied by positive GPT-6 assertions; preserving them is intentional.
- **Tautology/implementation mirroring:** Literal full-table expectations are explicitly required contracts here, not source-text snapshots. The supplemental `gpt-6-family-routing.test.ts:52-56` derives old-Opus providers from Fable, which alone could miss coordinated drift. Independent literal expectations in `model-requirements-agents.test.ts:161-186`, `model-requirements-categories.test.ts:239-267`, and `category-routing-policy.test.ts:194-216` close that gap. NOTE only; no failed criterion.
- **Prose pins:** No prose/prompt assertion added in the reviewed delta. Model/provider/variant strings are routing data.
- **Unnecessary production extraction/parsing/normalization:** None. Production changes are data-only updates to established tables, with no helper, abstraction, parser, defensive check, dependency, or public API change.
- **Programming/type/error discipline:** No new type escape, suppressed diagnostic, swallowed exception, async behavior, or resource lifecycle change in production. No new timing-dependent test was introduced in the reviewed delta.
- **Maintenance/scope notes:** `latest-model-requirements.test.ts:65` calls unchanged qwen3.7-plus a "successor"; the test still checks a real resolver result, but the name is historical and imprecise. Existing duplicate exact-chain pins are preserved per the request, not expanded into new abstractions. Neither is a merge blocker.
- **Separate code-review coverage:** No separate code-review report was supplied or found for this merge. The executor's report does not explicitly document the same skill/overfit checklist. Thus independent report coverage cannot be confirmed; this artifact records the direct check instead. This is an evidence NOTE, not a failure of the user's stated merge criteria.

## Evidence inspected and limits

Paths below are relative to the worktree unless stated otherwise.

- `.omo/evidence/20260923-latest-model-versions/report.md`: current top section read separately from superseded historical failures/successes.
- `.omo/evidence/20260923-latest-model-versions/plan.md`: current merge plan and historical context.
- `.omo/evidence/20260923-latest-model-versions/execution.md`: historical notepad-like execution record; no current dedicated notepad path was supplied.
- `.omo/evidence/20260923-latest-model-versions/merge-build.log`: complete logged build pipeline; no independent rebuild.
- `.omo/evidence/20260923-latest-model-versions/merge-packages-final.log:3856-3860`: 3008 pass, 1 skip, 0 fail; 3009 tests across 391 files. Relevant GPT-6/Prometheus passes also inspected at lines 525-532 and 588.
- `.omo/evidence/20260923-latest-model-versions/merge-audit.log`: 1 pass, 0 fail.
- `.omo/evidence/20260923-latest-model-versions/merge-prometheus-red.log`: failures specifically show the broad-provider mismatch and missing fourth Prometheus rung before the resolution; subsequent final log includes passing corresponding tests.
- `.omo/evidence/20260923-latest-model-versions/merge-routing-qa.ts` and `merge-routing-qa.log`: all eleven scenario assertions and outputs inspected. Matrix: Sol 6 preference; Sol 5.6 fallback; Astra; Luna Fast; Anthropic 5.5 preference; Copilot Opus 5; Kimi fallback; GLM 5.3; Prometheus 5.5; Prometheus 5; empty registry.
- `.omo/evidence/omo-senpi-adapter/20260923-latest-model-versions-merge/README.md` and `drive.json`: result PASS, ultraworkInjected true. Comment checker is SKIPPED-no-binary. Darwin directory-identity errors leave isolation certification false, while protected snapshots are complete with empty changed-path/error arrays. These limitations are accurately disclosed.
- `packages/model-core/src/agent-model-requirements.ts`
- `packages/model-core/src/category-model-requirements.ts`
- `packages/model-core/src/category-routing-policy.test.ts`
- `packages/model-core/src/gpt-6-family-routing.test.ts`
- `packages/model-core/src/latest-model-requirements.test.ts`
- `packages/model-core/src/model-requirements-agents.test.ts`
- `packages/model-core/src/model-requirements-categories.test.ts`
- `packages/senpi-task/src/agents/builtin/fallback-chains.ts`
- `packages/senpi-task/src/agents/builtin/fallback-chains.test.ts`
- `packages/senpi-task/src/category/fallback-chains.ts`
- `packages/senpi-task/src/category/fallback-chains.test.ts`
- `packages/senpi-task/src/category/resolve-category.test.ts`: changed expectation inspected in diff.
- `packages/omo-senpi/plugin/scripts/build-extension.mjs`: build ownership, minification, and output paths inspected.
- `packages/omo-senpi/plugin/extensions/omo.js` and `omo-task.js`: tracked diff and routing-bearing generated fragments inspected. Broad textual bundle comparison is not a semantic proof; generation evidence and pending full-gate validation remain necessary.

Final bundle snapshots read during review (the parent gate may rebuild them):

- omo.js SHA-256: `a55dbdaeb4fa52d29d301b1abcb61c0da0c095cca67d395e35c12b72f9c4119f`
- omo-task.js SHA-256: `1e1c8c4f29599ba28d4d8df09b436e40b5b132d6a951a757d57f165f473453eb`

### Exact evidence gaps

1. `bun run test:senpi` final exit status is pending in this review. Per instruction, `merge-senpi.log` was not polled or awaited. Parent owns completion and final report update before commit.
2. No tests/builds were rerun by this reviewer. Existing logs support their recorded outcomes but lack a reviewer-reproduced run or immutable source-hash binding. LSP success is executor-reported; no separate diagnostic receipt was supplied or reproduced.
3. No separate code-review report with explicit skill-perspective coverage or current notepad artifact was supplied. Current plan/report plus historical execution.md were inspected instead.
4. No live remote inference or full home-isolation certification is established by the smoke receipt; neither is required for this source merge verdict.
5. Merge commit and normal push remain parent deliverables; this report does not claim PR delivery is finished.

## Artifact placement

The requested SDK status expression was evaluated via Node JavaScript because no dedicated JS-eval tool is exposed. `agentToolkit.status()` returned no `result.currentAttemptDir` (`undefined`). This report therefore uses the specified no-attempt fallback: `.omo/evidence/latest-model-versions-gate-review.md`.

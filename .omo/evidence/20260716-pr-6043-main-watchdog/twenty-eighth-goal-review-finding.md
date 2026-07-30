# PR #6043 Final Goal And Constraint Gate Review

- recommendation: REJECT
- confidence: HIGH (0.98)
- reviewedHead: `74e387bf47dbf2d107e204969daf287983f548ff`
- reviewedBase: `5ef852a32c2c433386eb009bd92ca7c07359d0e6`
- mergeBase: `5ef852a32c2c433386eb009bd92ca7c07359d0e6`
- runtimeRepair: `a5d9298c5581b90cad1822995456edb6f82a9268`
- reviewDate: `2026-07-17`
- ulwStatus: `ULW_LOOP_PLAN_MISSING`; fallback artifact path used

## Original Intent

Fix the main-session runtime-fallback watchdog deadlock so a silent root request
is aborted and continued on the configured fallback. Preserve historical
subagent behavior, cancellation and abort ownership, active-root lifecycle,
fallback progression, and terminal deletion/disposal semantics.

## Desired Outcome

An eligible silent main root recovers exactly once through the owned fallback
path. Generic status aborts remain internal even when their event precedes the
HTTP response. User cancellation remains terminal. Delayed or completed abort
events cannot rewind newer fallback generations. Multiple roots remain active,
deleting the newest restores the previous root, and no async completion can
dispatch or recreate state after disposal.

## User Outcome Review

The runtime behavior is verified. Fresh composed and broad tests reproduce the
main watchdog, generic status event-before-response, post-dispose async
completion, historical subagent behavior, later user cancellation, fallback
progression, and two-root lifecycle. The isolated real OpenCode evidence proves
the production 90-second main-root recovery, two active roots, deletion
restoration, no fallback-owned re-arm, later external cancellation, and an
unchanged real database.

The PR nevertheless fails the full stated constraint set. Two TypeScript test
files in the reviewed `origin/dev...HEAD` diff exceed the explicit 250 pure-LOC
ceiling, and one of them grows by 48 pure lines. In addition, repository AGENTS
requires CI completion before merge, while one required check is still in
progress and GitHub reports `mergeStateStatus=BLOCKED`.

## Requirement Matrix

| Criterion | Result | Evidence |
|---|---|---|
| `C1-exact-head-base` | PASS | Local HEAD, GitHub `headRefOid`, base, and merge-base match requested SHAs. |
| `C2-main-watchdog` | PASS | Fresh runtime suite; `first-prompt-watchdog.test.ts`; `twenty-seventh-exact-live-*`. |
| `C3-subagent-preservation` | PASS | Active and zero-timeout subagent watchdog regressions pass; removed-subagent boundary passes. |
| `C4-status-abort-ordering` | PASS | `hook-abort-lifecycle-races.test.ts` advances fallback one to fallback two when abort event precedes response. |
| `C5-disposal-terminal` | PASS | Composed post-dispose regression plus watchdog lifecycle tests prevent prompt/timer/state recreation. |
| `C6-cancellation-ownership` | PASS | Generation races and live later user abort preserve genuine external cancellation. |
| `C7-root-lifecycle` | PASS | Focused lifecycle suite and live root-state artifacts prove A/B membership and restoration. |
| `C8-fallback-progression` | PASS | Full runtime suite `302/302`; model/lifecycle suite `66/66`; SDK 1.15.13 boundary passes. |
| `C9-isolated-opencode-qa` | PASS | Complete `twenty-seventh-exact-live-*` bundle and harness self-check; real DB unchanged. |
| `C10-pure-loc-ceiling` | FAIL | `event.test.ts=1504`; `event.model-fallback.test.ts=1070`, versus required `<=250`. |
| `C11-merge-workflow` | FAIL | AGENTS requires merge after CI; GitHub has one check in progress and merge state blocked. Merge method itself remains unexecuted. |
| `C12-no-unrelated-changes` | PASS | Non-evidence changes are confined to watchdog/runtime fallback, root state/lifecycle, corresponding docs/tests; evidence is PR-specific. |

## Blockers

1. `violatedCriterion: C10-pure-loc-ceiling`
   `evidencePointer: packages/omo-opencode/src/plugin/event.test.ts; packages/omo-opencode/src/plugin/event.model-fallback.test.ts; command: git diff --name-only origin/dev...HEAD -- '*.ts' | while IFS= read -r f; do code=$(awk '!/^[[:space:]]*$/ && !/^[[:space:]]*\/\//' "$f" | wc -l); [ "$code" -gt 250 ] && printf '%s %s\n' "$code" "$f"; done`
   Observation: the full reviewed diff contains 1504- and 1070-pure-line test modules. `event.model-fallback.test.ts` changes by `+59/-9` and grows from 1022 to 1070 pure lines.

2. `violatedCriterion: C11-merge-workflow`
   `evidencePointer: AGENTS.md PR MERGE POLICY; command: gh pr view 6043 --json mergeStateStatus,statusCheckRollup`
   Observation: `test (windows-latest)` is still `IN_PROGRESS`; GitHub reports `mergeStateStatus=BLOCKED`.

## Direct Slop And Programming Review

`remove-ai-slops`, `programming`, the TypeScript reference, and code-smell
criteria were loaded and applied directly. The final repair tests are
behavioral composed-hook tests: they force real async orderings and assert
fallback model progression or absence of post-disposal prompts. They are not
deletion-only, requested-removal-only, tautological, constant-mirroring, or
production-implementation snapshots. No unnecessary parser/normalizer,
speculative abstraction, dead extraction, or unrelated production change was
found. The blocking slop/programming issue is the explicit oversized changed
test module violation above.

The latest exact-head code review report is pinned to pre-repair head
`abd538a...` and explicitly includes the same skill-perspective coverage. The
`twenty-seventh-review-repair.md` report is post-repair but does not repeat that
skill section. This direct gate pass supplies post-repair coverage; report
coverage is not used as a substitute for source/test inspection.

## Fresh Reproduction

- Focused lifecycle/ordering/generation tests: `24 pass, 0 fail`.
- Full runtime-fallback suite: `302 pass, 0 fail`, 48 files.
- Model fallback, plugin lifecycle, and session state: `66 pass, 0 fail`, 4 files.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- Bundled no-excuse checker over the final 12 repair files: `No violations in 12 file(s).`
- Biome 2.4.16 lint-only over the final 12 repair files: exit 0, two informational literal-key notices.
- OpenCode QA `common.sh --self-check`: pass with isolated HOME/XDG cleanup.
- Pinned SDK 1.15.13 boundary: runtime abort false, ownership false, exact reservation preserved, sibling prompt calls zero.
- `git diff --check origin/dev...HEAD`: pass.
- Worktree and HEAD remained unchanged by review commands before this required report artifact update.

## Checked Artifact Paths

- `AGENTS.md`
- `ROADMAP.md`
- Full `origin/dev...HEAD` diff and commit topology
- `packages/omo-opencode/src/hooks/runtime-fallback/`
- `packages/omo-opencode/src/features/claude-code-session-state/state.ts`
- `packages/omo-opencode/src/plugin/event-session-lifecycle.ts`
- `packages/omo-opencode/src/plugin/event-model-fallback-state.ts`
- `.omo/evidence/20260716-pr-6043-main-watchdog/README.md`
- Every `.omo/evidence/20260716-pr-6043-main-watchdog/twenty-seventh-*` artifact
- `.omo/evidence/pr-6043-exact-head-code-review.md`
- GitHub PR #6043 exact refs and status checks via read-only `gh pr view`

## Exact Evidence Gaps

- No post-`a5d9298...` code-review report repeats the skill-perspective section;
  the direct exact-head gate review supplies it.
- The external installed no-excuse script fails during its own TypeScript import
  initialization; the repository-bundled checker runs successfully and the
  criteria were also applied manually.
- Mandatory CI is not terminal, as listed in blocker 2.

<verdict>FAIL</verdict>

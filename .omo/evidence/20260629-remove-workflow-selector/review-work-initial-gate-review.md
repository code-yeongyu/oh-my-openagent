# Gate Review: Remove Codex Workflow Selector

recommendation: REJECT

## originalIntent

The user asked, in Korean, to revert/remove the opt-in workflow selector safely and surgically: "그거 revert 하셈 opt-in workflow selector. 안전하게 저 기능 없애셈 surgical 하게지워주셈". Prior context identified the feature as PR #5540, the opt-in Codex Light workflow selector.

## desiredOutcome

Remove only the Codex Light opt-in workflow selector runtime surface:

- delete `packages/omo-codex/plugin/components/workflow-selector`
- delete `packages/omo-codex/plugin/hooks/user-prompt-submit-selecting-lazycodex-workflow.json`
- remove plugin manifest/workspace/package-lock wiring
- update tests to assert absence
- preserve ultrawork, ulw-loop, rules loading, CodeGraph, start-work-continuation, and other Codex hooks
- provide evidence-bound Codex QA, PR/CI/review evidence, and no scope drift

## userOutcomeReview

Functional diff review supports the intended runtime outcome. The branch is `code-yeongyu/remove-codex-workflow-selector` at `00eea45130acbdafb967e84c78d1f777389d287d`. The selector component directory and aggregate hook manifest are deleted, the aggregate plugin manifest now has only three `UserPromptSubmit` hooks (`rules`, `ultrawork`, `ulw-loop`), and targeted runtime search found no selector identifiers in runtime/plugin wiring.

The change appears surgically scoped: outside the deleted component and evidence files, the Codex plugin diff is limited to manifest/package wiring and focused test updates. Direct remove-ai-slops/programming pass found no new production abstraction, parsing/normalization, implementation-mirroring production code, or broad scope drift. The test edits are absence and preservation checks aligned with the requested removal, not unrelated test inflation.

However, the gate cannot approve because mandatory review evidence is absent. The supplied evidence folder contains QA logs and summary only; no code-review artifact, no manual QA matrix, and no notepad path/report were supplied. PR reviews/comments are empty. The final-gate instruction requires rejection when the code review report coverage for the skill-perspective and overfit/slop criteria is absent or unsupported.

## blockers

1. Mandatory code review report is absent.
   - `find .omo/evidence/20260629-remove-workflow-selector -maxdepth 1 -type f` lists only QA logs plus `SUMMARY.md`.
   - `rg -n "review|slop|overfit|programming|remove-ai|manual QA|matrix|APPROVE|PASS|FAIL" .omo/evidence/20260629-remove-workflow-selector` finds QA/test lines, but no review artifact documenting remove-ai-slops/programming criteria coverage.
   - `gh pr view 5745 --json reviews,comments,latestReviews,reviewDecision` returns empty arrays and no review decision.

2. Mandatory manual QA matrix and notepad path are missing from the provided artifacts.
   - `.omo/evidence/20260629-remove-workflow-selector/SUMMARY.md` summarizes QA but is not a matrix and does not include a notepad path.
   - No current-task notepad/review/matrix file exists under `.omo/evidence/20260629-remove-workflow-selector/`.

3. Cubic is present only as a neutral check, not as an actionable review artifact.
   - PR check `cubic · AI code reviewer` is `NEUTRAL`.
   - No PR review/comment body is available to inspect for issue coverage or approval.

## checkedArtifactPaths

- `git diff HEAD~1..HEAD`
- `git diff --name-status HEAD~1..HEAD`
- `git diff --check HEAD~1..HEAD`
- `packages/omo-codex/plugin/.codex-plugin/plugin.json`
- `packages/omo-codex/plugin/package.json`
- `packages/omo-codex/plugin/package-lock.json`
- `packages/omo-codex/plugin/test/aggregate-hooks.test.mjs`
- `packages/omo-codex/plugin/test/aggregate-manifest.test.mjs`
- `packages/omo-codex/plugin/test/component-bundled-cli.test.mjs`
- `packages/omo-codex/plugin/test/component-hook-contract-cases.mjs`
- `.omo/evidence/20260629-remove-workflow-selector/SUMMARY.md`
- `.omo/evidence/20260629-remove-workflow-selector/02-aggregate-tests.txt`
- `.omo/evidence/20260629-remove-workflow-selector/03-component-bundled-cli.txt`
- `.omo/evidence/20260629-remove-workflow-selector/04-runtime-absence-check.txt`
- `.omo/evidence/20260629-remove-workflow-selector/05-plugin-npm-test.txt`
- `.omo/evidence/20260629-remove-workflow-selector/06-bun-test-codex.txt`
- `.omo/evidence/20260629-remove-workflow-selector/07-codex-qa-common-self-check.txt`
- `.omo/evidence/20260629-remove-workflow-selector/08-codex-install-verify.txt`
- `.omo/evidence/20260629-remove-workflow-selector/09-codex-app-server-drive-plugin.json`
- PR #5745 body/checks/reviews via `gh pr view`

## directEvidence

- `git rev-parse HEAD` returned `00eea45130acbdafb967e84c78d1f777389d287d`.
- PR #5745 targets `dev`, head `code-yeongyu/remove-codex-workflow-selector`, merge state `CLEAN`.
- CI status checks for build, typecheck matrix, test matrix, codex-compatibility matrix, lazycodex published smoke, CLA, labels, and GitGuardian are successful or intentionally skipped where not applicable.
- `jq '.hooks | map(select(test("user-prompt-submit")))' packages/omo-codex/plugin/.codex-plugin/plugin.json` returns only:
  - `./hooks/user-prompt-submit-loading-project-rules.json`
  - `./hooks/user-prompt-submit-checking-ultrawork-trigger.json`
  - `./hooks/user-prompt-submit-checking-ulw-loop-steering.json`
- Runtime identifier search across plugin manifest/hooks/components/package files, excluding tests and skills, returned no matches for `workflow-selector`, `selecting-lazycodex-workflow`, `OMO_CODEX_AUTO_WORKFLOW`, or `<lazycodex-auto-workflow>`.
- Whole-repo non-doc/test search leaves only expected absence assertions and the test-only legacy transcript fixture:
  - `packages/omo-codex/plugin/test/aggregate-manifest.test.mjs`
  - `packages/omo-codex/plugin/test/aggregate-hooks.test.mjs`
  - `packages/omo-codex/plugin/components/ultrawork/test/codex-hook-trigger-policy.test.ts`

## exactEvidenceGaps

- Missing current-task code review report with explicit remove-ai-slops overfit/slop criterion coverage.
- Missing current-task report showing programming-skill perspective coverage.
- Missing manual QA matrix artifact.
- Missing notepad path/artifact for the executor run.
- Missing PR review/comment evidence; GitHub reports no reviews and no comments.

Final gate result: REJECT.

# CodeGraph Tmpdir Defaults Code Review

## First Review

Reviewer: lazycodex-code-reviewer
Verdict: REJECTED before evidence hygiene fix.

Blockers reported:
- Committed evidence contained trailing whitespace, so `git diff --check origin/dev..HEAD` failed.
- `green-codegraph-hook-serve-tests.txt` was a stale failed Bun invocation and was not documented as superseded.

Resolution:
- Stripped trailing whitespace from committed evidence artifacts.
- Removed stale `green-codegraph-hook-serve-tests.txt` artifact.
- Re-ran `git diff --check origin/dev..HEAD`; current committed HEAD reports exit 0.

## Post-Fix Programming Review

Scope reviewed: `packages/utils/src/codegraph/exclusion.ts`, `packages/utils/src/codegraph-exclusion.test.ts`, `packages/utils/src/codegraph-workspace.test.ts`, `packages/omo-codex/README.md`, and rebuilt CodeGraph component dist bundles.

Programming checks:
- Type surface is explicit: `CodegraphProjectExclusionOptions` gains only `readonly tmpdir?: string`; no `any`, assertions, `@ts-ignore`, or non-null assertions were introduced.
- Behavior remains at the existing exclusion seam; no new config keys, include override, or call-site policy fork was added.
- Comparison still flows through `realpathIfPossible`, `normalizeForComparison`, and `pathIsWithin`; win32 case-insensitivity stays centralized.
- Pure LOC check passed: `exclusion.ts` 75, `codegraph-exclusion.test.ts` 97, `codegraph-workspace.test.ts` 177.
- Docs avoid machine-local absolute paths and describe the existing exclude-only config behavior.

## Remove-AI-Slops / Overfit Review

Applied categories from the remove-ai-slops skill to the branch diff:
- Obvious comments: kept only BDD-style given/when/then markers in tests; no explanatory filler added.
- Over-defensive code: no duplicate guards or broad catches added; `tmpdir` injection is a testability seam matching existing `platform`/`homeDir` options.
- Excessive complexity: default-root logic remains a single branch; no nested conditionals or new abstraction layer.
- Needless abstraction: no helper extracted for one call site; existing helpers are reused.
- Boundary violations: Codex hook/serve call sites continue to depend on the shared utility; no direct policy duplicated in adapter code.
- Dead code: stale failed evidence artifact removed; no source dead code introduced.
- Duplication: default-root test cases are grouped in one focused exclusion test file instead of duplicated across workspace-helper tests.
- Performance equivalence: no algorithmic change beyond adding one default root to the existing small root iteration.
- Missing/tautological tests: tests assert observable decisions (`excluded`, `matchedRoot`, `reason`) for platform/config inputs and a normal included project; they do not assert mock calls or implementation constants.
- Oversized modules: touched source/test files are below the 250 pure LOC ceiling after the test split.

Post-fix local verdict: no unresolved source-level slop, overfit, or programming blocker found. External gate review still required for final approval.

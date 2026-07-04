# PR 5565 CI Repair Code Review

Date: 2026-06-26
Worktree: `/Users/yeongyu/local-workspaces/omo-pr-5565-ci-repair`
Goal: make PR #5565 mergeable by rebasing onto `origin/dev` and narrowly fixing the Windows-only `withLock serializes concurrent work` Bun test failure.

## Verdict

- codeQualityStatus: CLEAR
- recommendation: APPROVE
- blockers: None

## Skill-Perspective Check

- `omo:remove-ai-slops` consulted from `/Users/yeongyu/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/remove-ai-slops/SKILL.md`.
- `omo:programming` consulted from `/Users/yeongyu/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/SKILL.md`.
- TypeScript reference and error-handling guidance consulted from `references/typescript/README.md` and `references/typescript/error-handling.md`.
- Codegraph was attempted for source inspection, but this worktree is not indexed (`no .codegraph/`), so direct diff/file inspection was used.

Skill perspective result:
- remove-ai-slops: no deletion-only tests, tautological removal tests, implementation-constant mirroring, or unnecessary production parsing/extraction found. The new regression test proves the previously failing `EPERM` access-probe path goes red before the fix and green after.
- programming: no `any`, type assertions, non-null assertions, TS suppressions, brittle prompt tests, or needless broad abstraction found. The optional dependency object is a narrow filesystem test seam for an otherwise OS-specific error path.

## Scope Reviewed

Dirty working tree source diff:
- `packages/team-core/src/team-state-store/locks.ts`
- `packages/team-core/src/team-state-store/locks.test.ts`

Ignored evidence inspected:
- `.omo/evidence/20260626-pr-5565-ci-repair/notepad.md`
- `red-eperm-access-probe-after-install.txt`
- `green-eperm-access-probe.txt`
- `green-withlock-focused.txt`
- `team-core-locks-test.txt`
- `team-core-state-store-tests.txt`
- `team-core-typecheck.txt`
- `team-core-test.txt`
- `team-core-locks-rerun-each-20.txt`
- `windows-job-83405801286.log`

Git checks:
- `origin/dev` is an ancestor of `HEAD`.
- `git diff --check -- packages/team-core/src/team-state-store/locks.ts packages/team-core/src/team-state-store/locks.test.ts` passed.
- `git diff --submodule=log` outside the two changed source files was empty for the current repair diff.
- Evidence files are ignored by `.gitignore`.
- `git submodule status --recursive` showed clean submodule pointers, no drift markers.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Review Notes

The production fix in `packages/team-core/src/team-state-store/locks.ts:51` to `packages/team-core/src/team-state-store/locks.ts:75` is narrow and matches the observed Windows failure. `EPERM` from `open(lockPath, "wx")` still only becomes retryable after probing the lock path, and definite absence codes (`ENOENT`, `ENOTDIR`) still reject by rethrowing the original lock-open error.

The new test in `packages/team-core/src/team-state-store/locks.test.ts:113` to `packages/team-core/src/team-state-store/locks.test.ts:132` is relevant: it simulates the Windows-specific access-probe `EPERM`, fails against the old helper, and verifies a single access probe against the intended lock path. Existing missing-path coverage at `packages/team-core/src/team-state-store/locks.test.ts:134` to `packages/team-core/src/team-state-store/locks.test.ts:145` remains intact.

Residual risk is low. The changed behavior treats non-absence access-probe errors during an `EPERM` lock-open as possible contention, so truly unusual access failures may now wait for the bounded lock timeout instead of surfacing immediately. That is an acceptable tradeoff for the Windows contention behavior evidenced in the failed CI log, and the loop remains bounded.

## Verification

Inspected executor evidence:
- Red proof: `red-eperm-access-probe-after-install.txt` shows the new regression failing before the production fix.
- Green proof: `green-eperm-access-probe.txt` and `green-withlock-focused.txt` show the regression and original focused test passing.
- Broader coverage: `team-core-locks-test.txt`, `team-core-state-store-tests.txt`, `team-core-typecheck.txt`, `team-core-test.txt`, and `team-core-locks-rerun-each-20.txt` are green.
- Windows root cause: `windows-job-83405801286.log` shows `EPERM: operation not permitted, open ... locks-serialize-...\\lock` at `packages\\team-core\\src\\team-state-store\\locks.ts:84`, failing `withLock serializes concurrent work`.

Reviewer reruns:
- `bun test packages/team-core/src/team-state-store/locks.test.ts`: 7 pass, 0 fail.
- `bun run --cwd packages/team-core typecheck`: exit 0.
- `bun run --cwd packages/team-core test`: 146 pass, 1 skip, 0 fail.

## Final Recommendation

APPROVE.

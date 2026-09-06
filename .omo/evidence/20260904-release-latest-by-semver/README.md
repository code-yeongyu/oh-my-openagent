# Evidence: the GitHub Latest badge follows the highest published semver (2026-09-04)

Plan: `.omo/plans/20260904-release-latest-by-semver.md` · follow-up to PR #7743.

## What was tested
1. `resolveLatestFlag` unit behaviour (`script/release-latest-flag.test.ts`) with `bun test` (bun 1.4.0) on mengmotaMac over the bunshin mesh, in a hermetic dir holding only the files under test (no bunfig preload), per the no-local-test standing order.
2. Mutation proof for the same suite: the semver comparison inside `resolveLatestFlag` inverted, then restored.
3. Workflow wiring (`script/omo-ai-publish-shape.test.ts`) against BOTH dev's original `publish.yml` and the wired one.
4. Real surface: the CLI run against the LIVE release list of `code-yeongyu/oh-my-openagent` (264 published tags).

## What was observed
- `01-red-resolver-test-mengmotaMac.txt` - RED: 0 pass / 1 fail, `Cannot find module './release-latest-flag'` (the intended reason: no implementation yet).
- `02-green-resolver-test-mengmotaMac.txt` - GREEN: 9 pass / 0 fail.
- `03-mutation-proof-mengmotaMac.txt` - `Bun.semver.order(published, target) > 0` -> `< 0`: 3 pass / 6 fail (`MUTATED_EXIT=1`); restored: 9 pass / 0 fail (`RESTORED_EXIT=0`). The suite genuinely fails for the regression it names.
- `04-red-shape-test-mengmotaMac.txt` - RED against dev's workflow: 8 pass / 1 fail, `Expected to contain: "$LATEST_FLAG"` (dev's line is a bare `--latest`).
- `05-green-shape-test-mengmotaMac.txt` - GREEN against the wired workflow: 9 pass / 0 fail. Both exit codes were re-measured WITHOUT a pipe after an earlier `| tail -18` swallowed a real failure (see `07-*`).
- `06-live-cli-proof.txt` - live release list: `5.0.0-beta.41 -> --latest`, `4.19.5 -> --latest=false`, `5.0.0-beta.40 -> --latest`, `5.0.0 -> --latest`, `4.19.4 -> --latest=false`. Invalid input exits 1, missing argument exits 2 with usage.
- `07-selfcaught-test-defect.md` - a defect in my own first assertion, caught and fixed before commit.

## Why it is enough
- The Latest badge is now decided by one function with a mutation-proven test, and both `gh release create` call sites plus the local `script/publish.ts` path read it, so there is a single source for the rule.
- The shape test fails if `--prerelease` returns, if a bare `--latest` comes back, or if the resolve step is dropped - all machine-consumed CLI flags, not prose.
- The workflow steps are otherwise byte-identical (same idempotent `gh release view || gh release create`), so the rerun / `skip_platform` paths in `docs/reference/release-process.md` are untouched. `bun` is already installed in the `release` job (`oven-sh/setup-bun@v2`, step at publish.yml:1022) and each `run:` starts in `$GITHUB_WORKSPACE`, so `bun script/release-latest-flag.ts` resolves in both steps (the `cd` at :1065 is scoped to a different step).
- Not proven here: an actual publish run. The next `publish.yml` dispatch is the live confirmation; nothing else in the release job changed.

## What was omitted
No tokens, auth headers, or env dumps appear in these files; `gh` output was captured as plain tag names and JSON fields only.

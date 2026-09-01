# Evidence: worktree-sweep path normalization (Windows CI blocker)

Date: 2026-08-23. Branch `fix/worktree-sweep-path-normalize` off `origin/dev` (d5b8f1df7).

## What changed

`packages/omo-opencode/src/cli/worktree-sweep/parse-worktree-list.ts` now runs the
porcelain-emitted worktree path through `path.normalize()` in `finalize()`.

## Why

`git worktree list --porcelain` emits forward separators even on Windows (`C:/Users/...`),
while every Node-side consumer (tests via `path.join`, `isExcludedPath` prefix matching
against `os.homedir()`, removal bookkeeping) works in platform-native separators
(`C:\Users\...`). The sweep feature (f447933bc) compared these raw, so on Windows:

- `decisionFor` in the test suite never found a classification (7 deterministic failures,
  both original run and rerun on the release-state PR #7154 — not a flake);
- in production, `isExcludedPath(record.path, prefixes, home)` compared a forward-slash
  record path against a backslash home/prefix, silently breaking the protected-prefix
  exclusion on Windows.

Normalizing at the parse boundary is the parse-don't-validate fix: one canonical form
for every downstream comparison, POSIX behavior unchanged (git already emits `/`).

## Gates

| Gate | Command | Result |
|---|---|---|
| Failing-first unit contract | `parseWorktreeList("worktree /tmp/sweep/./wt-x …")` must equal `path.normalize("/tmp/sweep/wt-x")` | red before fix (`/tmp/sweep/./wt-x` returned raw), green after |
| Module suite | `bun test ./packages/omo-opencode/src/cli/worktree-sweep/` | 20 pass / 0 fail |
| Typecheck | `bun x tsgo --noEmit -p packages/omo-opencode` | exit 0 |
| Real-surface drive | `cli-drive.json`: temp repo, worktree added at `<base>/dot/../wt-linked`, `worktreeSweep({json:true, repos:[repo]})` | exit 0, `apply:false` (dry-run), classification path has the dot segment collapsed to `…/wt-linked` |
| Windows CI | PR check `test (windows-latest, 1/2)` | the decisive gate — this fix exists because that job fails deterministically on dev HEAD |

## Blast radius

Parse layer only; POSIX paths normalize to themselves. The macOS evidence run and the
20/20 module suite cover non-Windows regression; Windows CI on the PR is the platform
proof.

## Residual risk

Symlinked tmpdirs (macOS `/var` vs `/private/var`) remain distinct strings — pre-existing,
unchanged by this fix, and not a separator problem.


## Follow-up (same branch lineage, PR 7155's successor)

Windows CI after the parse-boundary fix exposed two sibling separator gaps, both in the same feature:

- `sweepRepo` reported `resolveRepoRoot()`'s git output verbatim — git emits forward separators on Windows, so `REPO <root>` never matched native-path expectations. Fixed: `normalize()` at the use site (`repo-root-drive.json`: reported root is in native normalized form).
- Test assertions compared raw porcelain strings (always forward-slashed) with `path.join` paths, and parse fixtures asserted POSIX literals verbatim. Fixed with a `toPosix` helper for porcelain comparisons and `path.normalize`-wrapped fixture expectations.

Module suite 20/20 and `tsgo --noEmit` exit 0 after the follow-up. The platform gate remains this PR's `test (windows-latest, 1/2)`.

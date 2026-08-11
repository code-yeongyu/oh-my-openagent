# PR #6533 beta.6 Rebase Evidence (2026-08-11)

## What was tested

Rebuild of PR #6533 (`fix(senpi): harden Windows wrapper and tool-result admission`) on top of
`origin/dev` at 55326d2a8 (v5.0.0-beta.6 + Windows memory-lock fix), worktree
`OpenCode_Worktrees/omo-pr6533-beta6`.

| Command | Result |
|---|---|
| `tsgo --noEmit -p packages/{senpi-task,omo-senpi,omo-codex}/tsconfig.json` | OK |
| `bun test packages/senpi-task/src/store` (record-lock/record-store) | pass |
| `bun test packages/omo-senpi/src/components/{result-size-cap,self-kill-guard}` + extension | pass |
| `bun test packages/omo-codex/src/install/codex-cache-bins.test.ts` | 15 pass / 2 skip (posix-only) |
| `bun test packages/omo-codex/src` (340 tests) | 338 pass, 2 fail (pre-existing env, see below) |
| `node --test packages/omo-codex/scripts/install-generated-bundle.test.mjs` | fail 0 |
| `bun run build:senpi-plugin` + `build-extension.mjs --check` | "extension build is current" |

## What was observed

- Record-store fix (`closeAppendFd` before `unlinkIfExists`) re-applied cleanly onto the beta.6
  tombstone-based store; `record-lock.ts` was untouched upstream and applied verbatim.
- Senpi extension bundles (`omo.js`, `omo-member.js`, `omo-init-deep-advisor.js`) regenerated from
  dev sources + this PR's components; freshness check passes.
- NEW on this rebuild: dev's Windows runtime wrapper (`codex-cache-runtime-wrapper.ts`) regressed
  the ulw-loop dispatch (`shift /1` + reinsert) — `%*` always expands to the original argv, so the
  child received `ulw-loop` twice, and bare `.cmd`-to-`.cmd` invocation dropped the child's exit
  status. Fixed with `call ... %*` + `exit /b !ERRORLEVEL!` in single-level blocks only (a nested
  block with trailing lines mis-expands `!ERRORLEVEL!` to 0 — verified empirically with minimal
  cmd fixtures, exits 39/38/40/37 now propagate).
- `codex-cache-bins.test.ts` run-2 additionally pins `USERPROFILE` to an isolated dir because
  Bun.spawn on Windows merges the parent environment and this machine's real `~/.bun/bin/bun.exe`
  otherwise masks the no-bun node-fallback branch.
- `packages/omo-codex/scripts/install-dist/install-local.mjs` regenerated (`shift /1` gone,
  3x `exit /b !ERRORLEVEL!`); generated-bundle marker test passes.

## Pre-existing failures (NOT caused by this change)

- `ulw-loop` runtime/registration: 2 failures reproduced on pristine `origin/dev` under Git Bash.
- `codex-project-local-cleanup` + `install-codex` cleanup: 2 failures caused by the test walking
  the parent chain into the REAL `C:\Users\USER\.codex\config.toml` on this machine; files
  unmodified by this PR.

## Why it is enough

Every file this PR touches is covered by a green targeted suite above; the two remaining failure
clusters were reproduced without this PR's edits (pristine dev / unmodified files) and are Windows
local-environment issues, not regressions.

## What was omitted

Live harness QA (`senpi-compatibility`-style end-to-end) is delegated to PR CI; local run limited
to unit/integration suites + bundle regeneration due to host session safety (no self-update while
the host agent runs).

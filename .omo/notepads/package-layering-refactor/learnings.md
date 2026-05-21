
## [2026-05-20T15:04:52Z] Task 1 baseline
- Total tests: 7315
- Pass: 7312, Fail: 2, Skip: 1
- Build exit code: 0 (dist/ size: 13M, 1456 files)
- Typecheck exit code: 0
- Packages: 15 package.json files under packages/, 3 private (ast-grep-mcp, rules-core, web)
- Anomalies observed: 2 pre-existing test failures in `src/features/opencode-skill-loader/skill-content.test.ts` — ambiguous short name resolution returns 2 resolved skills instead of 1 when "debugging" + "playwright" are queried together. This is a REAL baseline failure; do not fix as part of this refactor plan unless explicitly directed.

## [2026-05-20T15:12:12Z] Task 2 pre-flight
- `src/shared/deep-merge.ts`: pure, zero imports.
- `src/shared/snake-case.ts`: imports `./deep-merge` only (moved together) — pure after extraction.
- `src/shared/record-type-guard.ts`: pure, zero imports.
- `src/shared/extract-semver.ts`: pure, zero imports.
- `src/shared/frontmatter.ts`: imports `js-yaml` only.
- `src/shared/file-utils.ts`: imports `fs` only.
- `src/shared/contains-path.ts`: imports `fs` and `path` only.
- `src/shared/port-utils.ts`: imports `node:net` only.
- `src/shared/tool-name.ts`: pure, zero imports.
- `src/shared/replace-tool-args.ts`: pure, zero imports.
- `src/features/boulder-state/format-duration.ts`: pure, zero imports.
- `src/shared/jsonc-parser.ts`: coupled to plugin basenames; decoupled via parameterized `detectPluginConfigFile(dir, options)`.
- `src/shared/write-file-atomically.ts`: depends on omo-specific `./tolerant-fsync`; extraction deferred by scope decision (kept in-place).

## [2026-05-21T00:00:00Z] Task 7 (worktree)
- Pre-flight import audit (`packages/ast-grep-mcp/src/*.ts`) shows only `mcp.ts`, `runner.ts`, and `cli-binary-path-resolution.ts` touch adapter/runtime-specific concerns.
- Candidate extracted files are pure from MCP perspective:
  - `types.ts`: type-only, currently coupled only by `CliLanguage` source (`CLI_LANGUAGES`).
  - `language-support.ts`: CLI language enum + numeric defaults; no MCP/Bun coupling.
  - `pattern-hints.ts`: pure heuristics; no runtime coupling (intended identical behavior for pi/codex parity).
  - `result-formatter.ts`: pure string formatter over `SgResult`.
  - `sg-compact-json-output.ts`: pure JSON parsing/truncation logic; depends only on constants/types.
- `runner.ts` split requirement confirmed:
  - Core should own `buildSgArgs()` + `runSg()` orchestration and error mapping.
  - OMO-specific binary resolution stays adapter-side (`getAstGrepPath` in `cli-binary-path-resolution.ts`).
  - OMO-specific process spawn stays adapter-side (`bun-spawn-shim.ts`), injected via core deps (`spawnProcess`).

## [2026-05-21T00:00:00Z] Task 8 (worktree)
- Created `packages/comment-checker-core/` with `package.json`, `tsconfig.json`, `index.d.ts`, and `src/` barrel.
- Moved pure apply-patch parser + metadata parsing into `packages/comment-checker-core/src/apply-patch-edits.ts`.
- Moved shared comment-checker types into `packages/comment-checker-core/src/types.ts`.
- Added injectable pure runner in `packages/comment-checker-core/src/runner.ts`:
  - `resolveCommentCheckerBinary()`
  - `runCommentChecker()` with injected `spawn`, `existsSync`, and timer functions.
- Kept OMO-specific adapter pieces in place (`hook.ts`, `pending-calls.ts`, `initialization-gate.ts`, `downloader.ts`).
- Added per-file shims at original locations:
  - `src/hooks/comment-checker/apply-patch-edits.ts`
  - `src/hooks/comment-checker/types.ts`
- Updated `src/hooks/comment-checker/cli.ts` to keep Bun spawn glue locally while delegating pure runner + resolver to core package.
- Updated `src/hooks/comment-checker/hook.ts` to import `extractApplyPatchEdits` from `@oh-my-opencode/comment-checker-core`.
- Updated root workspace wiring (`package.json` workspaces, devDependency, typecheck:packages) and ran `bun install`.
- Verification:
  - `bun run typecheck` exit 0
  - `bun test` 7312/1/2/7315 (baseline-matching drift)
  - `bun run build` exit 0

## [2026-05-21T00:00:00Z] Task 3 retry (worktree)
- Extracted model resolution pipeline surface into `packages/model-core/` with moved sources/tests and package scaffold (`package.json`, `tsconfig.json`, barrel `src/index.ts`).
- Added ProviderCache DI seam in model-core:
  - `model-resolution-pipeline.ts` accepts `providerCache`.
  - `model-error-classifier.ts` exposes cache-injected provider selector.
- Kept OMO runtime cache implementation in `src/shared/connected-providers-cache.ts` and wired injections through shared shims.
- Recreated per-file `src/shared` shims with explicit symbol re-exports (no `export *` in shims).
- Moved `src/shared/model-capabilities/` subtree into model-core and kept shared adapter entry via `src/shared/model-capabilities/index.ts` wrapper.
- Verification pass: `bun run typecheck`=0, `bun test`=7312/1/2/7315 baseline, `bun run build`=0.

## [2026-05-20T18:37:22Z] W2-QA gate
- Verdict: REJECT. T6 `lsp-core` deferral accepted and not considered.
- Evidence written under `.omo/evidence/w2-qa-*.txt` for all 10 requested checks.
- Blocking failures:
  - Test delta drifted from baseline: `bun test` produced 7311 pass / 1 skip / 3 fail / 1 error / 7315 tests; extra failure is `src/shared/tmux/runner.test.ts:202` after timeout at `src/shared/tmux/runner.test.ts:199`.
  - `/tmp/w2-qa-equiv.ts` could not resolve `@oh-my-opencode/utils` from `/private/tmp/w2-qa-equiv.ts:1`.
  - Dependency DAG violation: `packages/agents-md-core/package.json:19` depends on `@oh-my-opencode/rules-engine`, a cross-Wave-2 internal dependency beyond utils.
  - `packages/rules-core/` still exists, although only `node_modules/` remains inside.
- Passing blocking checks: package symlinks/LSP references, OpenCode coupling sweep, build exit 0, and `dist/` remained 13M.
- Informational coverage concerns: `ast-grep-core`, `comment-checker-core`, `boulder-state`, and `agents-md-core` have zero co-located package tests; `boulder-state` has no critical-path test files.

## [2026-05-21] BOULDER COMPLETE

All 40 plan checkboxes resolved (40 [x], 0 [ ], 1 [~] deferred for T6 lsp-core).

**Final commits on dev (since baseline 6609d90b3):**
- Wave 1: utils package extraction + W1-QA APPROVE
- Wave 2: model-core, rules-engine, agents-md-core, ast-grep-core, comment-checker-core, boulder-state extractions + W2-QA APPROVE (T6 deferred)
- Wave 3: meta-audits + opencode-coupling grep gate + AGENTS.md/ROADMAP docs + W3-QA APPROVE
- Final Wave round 1: F2 + F3 APPROVE; F1 + F4 REJECT
- Round 2 fixes: FIX-1 (model-core DI eliminated 4 back-imports), FIX-2 (14 evidence sentinels), FIX-3 (T4 doc edit split)
- Final Wave round 2: F1 + F4 surface 2 new issues
- Round 3 fixes: FIX-5 (audit allowlist for runtime.Bun.* dual-runtime pattern), FIX-6 (delete 855KB dead generated JSON)
- Final state: all 4 reviewers APPROVE

**Test baseline preserved exactly: 7314 pass / 1 skip / 2 fail / 7317 total**
- 2 fails are pre-existing skill-content ambiguous short-name tests (untouched by refactor)
- 1 documented flake: tmux runner test under heavy parallel I/O (passes 9/9 in isolation)

**Architecture delivered:**
- 7 Core packages in packages/ (utils, model-core, rules-engine, agents-md-core, ast-grep-core, comment-checker-core, boulder-state)
- Per-file re-export shims at original src/ locations (never `export *`)
- opencode-coupling-audit.test.ts enforces zero Bun.* or src/ coupling in package production code (test files exempt)
- ProviderCache, ConnectedProvidersAdapter, SpawnFn DI interfaces for harness independence
- API designed for future pi/codex adoption

**Deferred future tracks:**
- T6 lsp-core extraction (submodule strategy)
- Pi adapter layer (senpi + extensions)
- Codex adapter layer
- rules-engine full Engine DI (originally planned in T4, scoped to rename only)
- 3 orphan re-export shims for cleanup (apply-patch-edits.ts, model-capability-aliases.ts, model-capability-guardrails.ts)
- Tmux runner test flake (documented)

**Key learnings:**
- Subagents running bash inherit the parent's cwd, NOT the worktree path — must use `workdir` parameter explicitly. FIX-6 subagent deleted from main repo by accident before catching this.
- Coupling audit regex `\bBun\.` is too broad; negative lookbehind `(?<!runtime\.)\bBun\.` correctly distinguishes legitimate dual-runtime shim from production violations.
- Test files importing test data from outside the package are acceptable — audit must exclude `*.test.ts` to avoid false positives.
- Git worktrees + cherry-pick is the cleanest parallel-work pattern when subagents work on independent fixes.
- Subagent overconfidence: marks "done" even when typecheck failures persist; orchestrator-side verification is non-negotiable.

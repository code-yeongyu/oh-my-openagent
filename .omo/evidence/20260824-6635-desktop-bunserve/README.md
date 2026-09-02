# 20260824-6635-desktop-bunserve - evidence

Issue: code-yeongyu/oh-my-openagent#6635 (v4.x plugin silently fails to load on OpenCode Desktop's Node sidecar)
Branch: issue/6635-desktop-bun-serve-regression (base dev @8833800ae)

## ROOT CAUSE

The original `bun.serve` claim in the issue was rebutted in-thread (the serve call is guarded behind a local `runtimeEnv.Bun` check with a node:http fallback, covered by existing tests). The real defect is in the same failure class the reporter converged on: module-evaluation-time work that breaks Node ESM import of `dist/index.js`.

Six builtin-skill modules called `loadSharedSkillTemplate(...)` in a module-scope object literal:

- packages/skills-loader-core/src/features/builtin-skills/skills/debugging.ts
- packages/skills-loader-core/src/features/builtin-skills/skills/frontend.ts
- packages/skills-loader-core/src/features/builtin-skills/skills/init-deep.ts
- packages/skills-loader-core/src/features/builtin-skills/skills/remove-ai-slops.ts
- packages/skills-loader-core/src/features/builtin-skills/skills/review-work.ts
- packages/skills-loader-core/src/features/builtin-skills/skills/visual-qa.ts

`loadSharedSkillTemplate` -> `createSharedSkillTemplateLoader()` does `readFileSync(join(sharedSkillsRootPath(), <name>, "SKILL.md"))` and is deliberately fail-fast on ENOENT (pinned by skill-file-loader.test.ts). `sharedSkillsRootPath()` (packages/shared-skills/index.mjs) probes ./skills/, ../skills/, ../../skills/ relative to the bundle and falls back to the sibling path even when none exist. Whenever the skills tree is absent or unresolvable next to the bundle (Desktop sidecar/asarLayouts, partial installs, dev checkouts whose full build stopped at the submodule materialize step), importing dist/index.js under Node throws ENOENT during module evaluation, the host's dynamic import() rejects, and the plugin is dropped before any plugin code runs: no log entries, no error surfaced. That is exactly the reported symptom.

## WHAT WAS TESTED

1. RED (before fix), commands:
   - `bun test packages/omo-opencode/src/shared/dist-bundle-bun-globals.test.ts`
   - `bun test packages/skills-loader-core/src/features/builtin-skills/skill-template-lazy-evaluation.test.ts` (new regression pin, written first)
   Observed output captured verbatim in node-smoke-red-before-fix.log (recorded from the session transcript; the red state is reproducible by reverting the six skill modules).
2. GREEN (after fix), commands:
   - `bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod && bun run build:node-require-shim`
   - `bun test packages/omo-opencode/src/shared/dist-bundle-bun-globals.test.ts` -> node-smoke-green-after-fix.log
   - `bun test packages/skills-loader-core` -> skills-loader-core-suite-green.log
   - `bun test packages/omo-opencode/src/features/builtin-skills/` -> 37 pass
   - `bun run typecheck` -> exit 0

## WHAT WAS OBSERVED

RED (before fix):
- Both Node ESM smoke tests failed: "#given dist bundle #when imported under node --input-type=module #then it loads without error" and "... #then stderr has no Bun reference errors" (3 pass / 2 fail).
- Node subprocess error: `Error: ENOENT ... open '/home/viprix/projects/oom-wt-6635/dist/skills/frontend/SKILL.md'` at `readFileSync` <- `loadSharedSkillTemplate` (dist/index.js) during module evaluation.
- New source-audit pin listed exactly the six eager modules above.

GREEN (after fix: lazy `get template()` accessors in the six modules; loader fail-fast contract unchanged):
- dist-bundle audit suite: 5 pass / 0 fail, including both Node smokes, WITH dist/skills still absent from the tree (stronger than CI, where build:shared-skills-assets populates it).
- skills-loader-core package suite: 232 pass / 0 fail.
- omo-opencode builtin-skills scoped suite: 37 pass / 0 fail.
- typecheck (tsgo root + script + all packages): exit 0.
- lsp_diagnostics on changed/new files: clean.

## WHY IT IS ENOUGH

- The failing surface is driven for real: a plain Node ESM `import('./dist/index.js')` subprocess, which is the same mechanism OpenCode Desktop's plugin host uses (`@npmcli/arborist` + `import("file://...")`, per the issue thread). Before the fix it crashed at evaluation time; after the fix it loads with zero stderr even when the data directory the old code depended on is missing entirely.
- The regression pin (skill-template-lazy-evaluation.test.ts) blocks reintroduction of module-scope template reads, mirroring the sanctioned source-audit pattern used by ultrawork-db-model-override.bun-sqlite-unavailable.test.ts.
- Consumer behavior is preserved: `.template` values are identical (existing skill-file-loader tests still pass), reads remain cached by the module-singleton loader, and ENOENT still fails fast at first actual use instead of killing the whole bundle import.

## WHAT WAS OMITTED

- No live OpenCode Desktop (Electron/Windows) run: not available in this environment. The Node-sidecar load path is exercised via the repo's own audit subprocess instead; residual risk is limited to Desktop-specific path resolution inside app.asar, which the fix makes non-fatal for module load regardless.
- Environment quirk documented: `bun install` prepare -> `bun run build` fails at build:materialize because git cannot resolve the pinned revision of the packages/shared-skills/upstreams/open-design submodule in this sandbox (pre-existing, unrelated). Only the index bundle + node-require-shim were built directly using the exact commands from script/build.ts's build graph. dist/skills was intentionally left absent to prove the fix removes the evaluation-time filesystem dependency.
- No secrets, tokens, or env dumps are included; logs contain only test-runner output and file paths inside this worktree.

## RE-VERIFICATION (crash recovery, 2026-08-24)

The implementing session crashed after committing the fix (c108d8c) but before push. A recovery pass independently re-ran every gate on the committed tree before pushing:

- `bun test packages/skills-loader-core` -> 232 pass / 0 fail / 548 expect() calls
- `bun test packages/omo-opencode/src/features/builtin-skills/` -> 37 pass / 0 fail
- `bun test packages/omo-opencode/src/shared/dist-bundle-bun-globals.test.ts` -> 5 pass / 0 fail (Node ESM import of dist/index.js with dist/skills absent)
- `bun run typecheck` (tsgo root + script + all packages) -> exit 0
- Source audit: `grep -rn "template:\s*loadSharedSkillTemplate(" packages/ --include="*.ts"` outside test files -> zero matches
- `git merge-base HEAD origin/dev` -> 8833800ae (branch is exactly one commit ahead of the stated base)

Evidence directory renamed from `20260824-6635-bun-serve-regression` to `20260824-6635-desktop-bunserve` to match the task spec slug; content unchanged apart from this title and section.

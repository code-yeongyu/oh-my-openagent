recommendation: APPROVE

blockers:
- None.

originalIntent:
CodeGraph should exclude OS temp roots by default on every supported platform, allow tmpdir injection for deterministic tests, preserve the existing exclude-only configuration shape without adding an include override, update docs and bundled dist artifacts, and provide complete QA/review evidence.

desiredOutcome:
Users running LazyCodex/OMO from temp or OMO state locations should not get CodeGraph bootstrap workers or a live CodeGraph MCP for those roots. Normal project roots should still bootstrap. Documentation should explain defaults, `codegraph.excluded_roots`, managed CodeGraph environment flags, and dead-store pruning. Evidence should prove the behavior through unit, component, live hook, Codex QA, typecheck, and hygiene gates.

userOutcomeReview:
The shipped diff satisfies the requested outcome. `packages/utils/src/codegraph/exclusion.ts` adds a typed `tmpdir` injection option and includes `os.tmpdir()` in the default excluded roots, while preserving POSIX `/tmp` and `/private/tmp`, `.omo` state exclusion, custom `excludedRoots`, and normal-project inclusion. The hook and serve call sites continue to use the shared exclusion seam and add no config/include override. `packages/omo-codex/README.md` documents the default exclusions, exclude-only custom roots, no include override, managed CodeGraph env flags, and dead-store GC. The generated `dist/cli.js` and `dist/serve.js` contain the same exclusion logic and keep their original file modes.

checked artifact paths:
- packages/utils/src/codegraph/exclusion.ts
- packages/utils/src/codegraph/workspace.ts
- packages/utils/src/codegraph-exclusion.test.ts
- packages/utils/src/codegraph-workspace.test.ts
- packages/omo-codex/plugin/components/codegraph/src/hook.ts
- packages/omo-codex/plugin/components/codegraph/src/serve.ts
- packages/omo-codex/plugin/components/codegraph/dist/cli.js
- packages/omo-codex/plugin/components/codegraph/dist/serve.js
- packages/omo-codex/README.md
- .omo/evidence/20260706-cg-tmpdir/README.md
- .omo/evidence/20260706-cg-tmpdir/green-codegraph-exclusion-test.txt
- .omo/evidence/20260706-cg-tmpdir/green-codegraph-component-tests.txt
- .omo/evidence/20260706-cg-tmpdir/live-sessionstart-proof.json
- .omo/evidence/20260706-cg-tmpdir/live-sessionstart-isolation.txt
- .omo/evidence/20260706-cg-tmpdir/codex-qa-common-self-check.txt
- .omo/evidence/20260706-cg-tmpdir/codex-qa-app-server-drive-plugin.txt
- .omo/evidence/20260706-cg-tmpdir/codex-qa-install-verify-self-test-rerun.txt
- .omo/evidence/20260706-cg-tmpdir/gate-test-codex.txt
- .omo/evidence/20260706-cg-tmpdir/gate-typecheck.txt
- .omo/evidence/20260706-cg-tmpdir/gate-bun-test-utils-omo-codex-rerun.txt
- .omo/evidence/20260706-cg-tmpdir/git-diff-check.txt
- .omo/evidence/codegraph-tmpdir-defaults-code-review.md
- .omo/evidence/codegraph-tmpdir-defaults-gate-review-rejected.md

verification performed:
- Loaded and applied the `remove-ai-slops` and `programming` criteria, including the TypeScript reference and code-smell rules.
- Ran `git diff --check origin/dev..HEAD`: exit 0.
- Inspected `git diff origin/dev..HEAD`, `git diff --name-status`, `git diff --stat`, `git diff --summary`, source/docs/dist diffs, committed evidence, and review artifacts.
- Re-ran `/Users/yeongyu/.bun/bin/bun test packages/utils/src/codegraph-exclusion.test.ts`: 3 pass, 0 fail.
- Re-ran `bun test test` in `packages/omo-codex/plugin/components/codegraph`: 53 pass, 0 fail.
- Re-ran `PATH="/Users/yeongyu/.bun/bin:$PATH" /Users/yeongyu/.bun/bin/bun run typecheck`: exit 0.
- Measured pure LOC: `exclusion.ts` 75, `codegraph-exclusion.test.ts` 97, `codegraph-workspace.test.ts` 177.
- Confirmed the previous blockers are resolved: current diff-check is clean, the stale failed `green-codegraph-hook-serve-tests.txt` artifact is absent, failed diagnostic artifacts are explicitly documented as superseded by clean reruns, and `.omo/evidence/codegraph-tmpdir-defaults-code-review.md` now records post-fix programming plus remove-ai-slops/overfit coverage.

remove-ai-slops and programming review:
No unresolved slop or programming blocker found. The production change is at the existing shared exclusion seam, adds no speculative abstraction, no broad catch, no new config parser/normalizer, no include override, no `any`, no assertions, no non-null assertion, and no oversized touched source/test file. The tests are not deletion-only, tautological, or implementation-mirroring: they assert observable exclusion decisions for Linux/POSIX defaults, Darwin injected temp root, Windows injected temp root, custom excluded roots, `.omo` state paths, sibling non-exclusion, and normal project inclusion. The test split removes unrelated workspace-helper coupling while preserving and extending behavior coverage.

exact evidence gaps:
- None.

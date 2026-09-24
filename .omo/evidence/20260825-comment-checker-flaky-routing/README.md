# Evidence — issue #6142: de-flake comment-checker mutation routing + fixEmptyMessagesWithSDK

## WHAT WAS TESTED

1. Mechanism probe (`mechanism-dual-instance-probe.ts` / `.log`): importing the same module via a plain specifier vs a query-suffixed specifier under bun's one-process loader.
2. Failing-first regression tests (written BEFORE the fix): `test-isolation.regression.test.ts` in both `comment-checker/` and `anthropic-context-window-limit-recovery/`, run against pre-fix code.
3. Post-fix scoped suites: both hook directories, on system bun 1.3.14 and on CI's exact toolchain bun 1.4.0 (5 loops each).
4. Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
5. Broader sweep: full `packages/omo-opencode/src/hooks/` tree with and without the change.

## WHAT WAS OBSERVED

- Probe: `sameInstance: false` - query-suffixed specifiers fork module identity. `hook.before-after.test.ts` relied on exactly this (`import("./hook?before-after")`), so its internal `./pending-calls` binding could disagree with the plainly imported reset handle depending on loader state; sibling files (`hook.apply-patch.test.ts`, `hook.lazy-init.test.ts`) additionally registered global `mock.module("./cli-runner")` / `mock.module("./pending-calls")` that leak across files in bun's single-process suite. `message-builder.test.ts` module-mocked `./storage/empty-text`(+`.ts`) and `./storage/text-part-injector`(+`.ts`) - the exact dependency specifiers of `empty-content-recovery-sdk.ts`.
- RED first (`v1-red-regression-prefix.log`): 0 pass / 3 fail against pre-fix code, offenders named precisely (apply-patch + lazy-init mock.module registrations, before-after `./hook?before-after` specifier, message-builder victim-specifier mocks).
- GREEN after fix: 85 pass / 0 fail on bun 1.3.14 (`v2-green-bun1314-scoped.log`) and 5x 85 pass / 0 fail on bun 1.4.0 (`v2-green-bun140-loops.log`).
- Typecheck: exit 0 (`v3-typecheck-tsgo-omo-opencode.log`).
- Broader sweep: 44 failures in the full hooks tree exist identically on base commit c7094b8ac (verified via `git stash`: 253 pass / 43 fail in runtime-fallback + directory-readme-injector subset on base). None are in the two touched directories; all are pre-existing and out of scope for #6142.

## WHY IT IS ENOUGH

The fix removes the two hazards the issue identifies rather than masking them: no file in comment-checker registers module mocks or imports through query-suffixed specifiers any more (enforced by the new regression tests, which failed pre-fix), and message-builder no longer mocks the SDK victim's dependency graph (deps injected instead, following the repo precedent a43be2d2d "inject the seam instead of module mocks"). Assertions were not weakened anywhere; test counts went up (82 -> 85 in the scoped run). The regression tests pin the invariant structurally, so the ordering coupling cannot silently return. Local reproduction of the exact ubuntu CI timing was not achievable (victims pass locally even on package-level runs per the issue; hostile-ordering pairs also passed locally on 1.3.14 and 1.4.0), which is why the red-first proof is structural (scanner pins the precise pre-fix offenders) plus the mechanism probe demonstrating instance forking. Full root suite exceeds 15 minutes locally and could not be looped; CI will exercise it.

## WHAT WAS OMITTED

No secrets, tokens, or env dumps appear in this evidence. CI log fetches for the original failed runs (29431928173 attempt 1, 29462380520) returned purged/rerun artifacts, so no upstream log excerpts are included; failure shape is taken from the issue body. Submodule dirt in packages/shared-skills/upstreams/* created by bun install/test-setup is unrelated and intentionally left unstaged.

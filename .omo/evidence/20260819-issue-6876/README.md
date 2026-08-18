# Issue #6876 QA evidence

## Behavioral RED

`red-focused-test.txt` records the regression-test-only run against `e199029e1`: 5 passed, 1 failed. Both `ulw-plan` and `ulw-research` reached the real keyword hook and produced an unexpected ultrawork toast, while the `ulw-loop` positive control passed.

## GREEN gates

- `npx --yes bun test packages/omo-opencode/src/hooks/keyword-detector/ultrawork-edge-trigger.test.ts`
  - 6 passed, 0 failed, 25 assertions.
- `npx --yes bun test packages/omo-opencode/src/hooks/keyword-detector`
  - 92 passed, 0 failed, 245 assertions.
- `npx --yes bun x tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
  - Exit code 0.
- `npx --yes bun .omo/evidence/20260819-issue-6876/probe.ts`
  - Eight boundary cases matched expectations: standalone `ulw`, `ultrawork`, and `ulw-loop` activate; `ulw-plan` and `ulw-research` variants do not.
- `npx --yes bun build packages/omo-opencode/src/hooks/keyword-detector/constants.ts --target=bun --outfile=.omo/evidence/20260819-issue-6876/constants.bundle.js`
  - Bundled 311 modules successfully; the temporary bundle was removed after verification.

The repository prepare build reached the known Windows-only `lsp-tools-mcp` POSIX `rm` portability failure. Focused tests, the complete keyword-detector suite, package typechecking, and the isolated boundary probe are independent of that unrelated build limitation.

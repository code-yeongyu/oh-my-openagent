# Issue #6866 QA evidence

## Scenario

Resolve the idle TUI roster from an isolated project configuration that disables the legacy `Sisyphus` agent name. Verify that the normalized `sisyphus` row is absent while another enabled agent and the `deep` category remain visible.

## Commands and results

- RED: `npx --yes bun test packages/omo-opencode/src/features/tui-sidebar/roster-resolver.test.ts`
  - 3 passed, 1 failed.
  - The new assertion expected `sisyphus` to be absent but received `true`.
- GREEN: `npx --yes bun test packages/omo-opencode/src/features/tui-sidebar/roster-resolver.test.ts`
  - 4 passed, 0 failed, 12 assertions.
- Typecheck: `npx --yes bun x tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
  - Exit code 0.
- Targeted bundle: `npx --yes bun build packages/omo-opencode/src/features/tui-sidebar/roster-resolver.ts --target=bun --outfile=.omo/evidence/20260819-issue-6866/roster-resolver.bundle.js`
  - Bundled 553 modules successfully; the temporary bundle was removed after verification.
- Isolated probe: `npx --yes bun .omo/evidence/20260819-issue-6866/probe.ts`
  - Observed `disabledAgentPresent=false`, `enabledAgentPresent=true`, and `categoryPresent=true`; exit code 0.

The initial dependency bootstrap attempted the repository-wide postinstall build and was stopped when it remained blocked cloning the unrelated `nexu-io/open-design` shared-skill upstream. The focused package gates above do not depend on that external clone.

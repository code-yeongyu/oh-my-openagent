# Ghostty inline image layout QA

## What was tested

- The exact pinned `@code-yeongyu/senpi@2026.9.16-3` postinstall transform.
- Ghostty capability detection and the resulting Kitty image render contract.
- The existing compile-safe and RPC postinstall transforms beside the new transform.
- `packages/omo-native` TypeScript checking.
- The repository Senpi QA driver in self-test mode and against the exact pinned real Senpi CLI.

## What was observed

- `before-fix-red.txt`: the regression fails because Ghostty lacks `kittyUnicodePlaceholders` before the fix.
- `postinstall-regressions.txt`: 25 tests pass. Ghostty now selects Kitty Unicode placeholders; image output uses `U=1`, omits fixed-cursor `C=1`, and emits one placeholder line per reserved image row.
- `typecheck.txt`: `tsgo --noEmit -p packages/omo-native/tsconfig.json` passes with no diagnostics.
- `drive-self-test.txt`: the isolation driver self-test passes.
- `drive-live-with-pinned-senpi.txt`: the real pinned Senpi CLI completes the driver with `result: PASS` and `ultraworkInjected: true`.

## Why this is enough

The regression exercises the published patch entry point against the exact pinned dependency, then imports the transformed terminal image implementation and checks the behavior that controls layout. The adjacent postinstall tests and scoped typecheck cover integration with existing package preparation. The live driver confirms that the exact pinned Senpi CLI still starts and completes through the repository harness.

# Issue 8692 release metadata evidence

## What was tested

- Focused release metadata and workflow shape tests under Bun 1.4.2, in a hermetic directory without the repository-wide test preload.
- The script TypeScript project with `tsgo --noEmit -p script/tsconfig.json`.

## What was observed

- `focused-tests-hermetic-bun-1.4.2.txt`: 19 tests passed, 0 failed. The cases cover beta/rc/alpha prerelease flags, stable Latest ordering, both workflow release commands, and the local publish path.
- `typecheck-script.txt`: completed successfully with no diagnostics.

## Why this is enough

The change is limited to release flag calculation and the three call sites. The focused tests execute the resolver and parse the real workflow source, while the script typecheck verifies the TypeScript call site. No OpenCode, Codex, or Senpi runtime component changed, so their live harnesses do not apply.

## Environment

- Required runtime used for the passing checks: Bun 1.4.2.
- No credentials or host configuration were captured.

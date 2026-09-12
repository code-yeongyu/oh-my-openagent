# PR 7492 configuration discovery follow-up

## Scope

- Add failing tests for the valid profile target, `OPENCODE_CONFIG`, ancestor
  project configs, Windows `%APPDATA%/opencode`, and multiple simultaneous
  misplaced-category sources.
- Extend discovery with exact OpenCode sources while keeping paths
  deduplicated and ordered.
- Return all discovered category diagnostics and point profile users at a
  machine-consumed valid unified-config key.
- Normalize committed evidence fixtures and observed paths, correct the
  recorded test count, and add exact sandbox HOME/XDG/database provenance.
- Run focused tests failing first and green, adapter typecheck, full build,
  and real isolated OpenCode config-startup QA with the host database
  unchanged and the sandbox database path proven inside the sandbox.
- Merge current `dev`, repeat verification, and push only the existing PR
  branch.

## Files

- `packages/omo-opencode/src/shared/opencode-config-dir.ts`
- `packages/omo-opencode/src/shared/opencode-config-dir.test.ts`
- `packages/omo-opencode/src/testing/create-plugin-module.ts`
- `packages/omo-opencode/src/testing/create-plugin-module.test.ts`
- Relevant `.omo/evidence/` records on the PR branch

## Stop condition

Every actual OpenCode config source is diagnosed, hints name valid OMO keys,
all evidence is portable and isolation-bound, all verification is green, and
the existing PR head is updated.

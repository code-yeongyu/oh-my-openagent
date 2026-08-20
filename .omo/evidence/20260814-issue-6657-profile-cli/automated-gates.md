# Automated gates

All commands ran from the repository root on the final implementation tree. Bun is unavailable on `PATH`, so every Bun invocation used `npx --yes bun`.

## Focused tests

1. `npx --yes bun test packages/omo-config-core/src/loader/active-profile.test.ts packages/omo-config-core/src/schema/config-schema.test.ts`
   - Exit: 0
   - Result: 14 pass, 0 fail, 41 assertions across 2 files.
   - Covers activation precedence, missing/project selectors, profile-state discovery, non-empty and non-whitespace selector/name schema rules.

2. `npx --yes bun test packages/omo-opencode/src/cli/profile/profile.test.ts packages/omo-opencode/src/cli/cli-program.test.ts`
   - Exit: 0
   - Result: 21 pass, 0 fail, 79 assertions across 2 files.
   - Covers command registration, list/use/current/clear, comments, overrides, unknown/empty/project-only profiles, malformed config, missing selections, and idempotent clear.

3. `npx --yes bun test packages/omo-opencode/src/config/validate.test.ts`
   - Exit: 0
   - Result: 11 pass, 0 fail, 34 assertions.
   - Covers the OpenCode config-chain integration and control-key stripping.

Focused aggregate: 46 pass, 0 fail, 154 assertions.

## Typechecks

4. `npx --yes bun run --cwd packages/omo-config-core typecheck`
   - Exit: 0.

5. `npx --yes bun run --cwd packages/omo-opencode typecheck`
   - Exit: 0.

## Generated schema and CLI bundle

6. `npx --yes bun run build:omo-schema`
   - Exit: 0.
   - `assets/omo.schema.json` SHA-256 before and after: `d4011b9c80b8d3084f2c500105aae7e75cc0b0d8eec943b9d74d5abeb2164b19`.
   - Reproducible: yes.

7. `npx --yes bun build packages/omo-opencode/src/cli/index.ts --outdir dist/cli --target bun --format esm`
   - Exit: 0.
   - Bundled 934 modules; output `dist/cli/index.js`.
   - Bundle SHA-256: `55ece27fd523a401ff43549ce4ac144e1e907588fc53a0f4397d6bcb4296bd92`.
   - Bundle contains the project-only persistence guard and whitespace schema guard.

8. `git diff --check`
   - Exit: 0.

9. `npx --yes bun run build:senpi-plugin:stage`
   - Exit: 0 after rebasing onto `038ed0cbbefe2b40677b63867aeea0d16bc303e0`.
   - The conflicted historical generated-bundle commit was dropped and regenerated from the rebased source with the repository's official generator.
   - The final branch diff changes only `omo-init-deep-advisor.js` and `omo.js`; `omo-task.js` was restored byte-for-byte to the current-base output after its workspace junction was relinked locally. No conflict markers remain.

## Known broader Windows-only limitations

These were captured on the same Windows machine before the final focused rerun and were not rerun after the final review approval because they do not exercise the changed profile behavior:

- A broader `omo-config-core` batch produced 19 pass and 3 fixture-setup failures. Each failure was `EPERM` from `symlinkSync` because the Windows account could not create test symlinks; no profile assertion failed.
- `npx --yes bun run build` reached and successfully built the materialized frontend, TUI, Git Bash MCP, AST-grep MCP, CLI, Codex installer, both schemas, CLI-node, index, node require shim, declarations, and LSP daemon. It then exited 1 only at `packages/lsp-tools-mcp`, whose npm build script invokes POSIX `rm -rf dist`; Windows reported `'rm' is not recognized as an internal or external command`. Repository scripts were not modified.

Docker was unavailable by policy, so the mandated `opencode-qa` Windows/local Case A fallback was used.

# Doctor Config Summary QA

## What Was Tested

- `bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-fallback-models.test.ts packages/omo-opencode/src/config-migration/reasoning-unification.test.ts packages/omo-opencode/src/cli/doctor/formatter.test.ts packages/omo-opencode/src/cli/doctor/format-default.test.ts packages/omo-opencode/src/cli/doctor/runner.test.ts`
- `bun run typecheck`
- `bun run build`
- Isolated `node dist/cli-node/index.js doctor --verbose` with temp `HOME` and `XDG_*` directories.
- Isolated `node dist/cli-node/index.js config migrate --json`, followed by `doctor --json` against the migrated config.

## What Was Observed

- Focused tests: 31 pass, 0 fail, 90 assertions.
- Final focused regression rerun: 24 pass, 0 fail, 69 assertions across the changed doctor and migration test files.
- Final combined doctor and config-migration rerun: 194 pass, 0 fail, 524 assertions.
- Typecheck: passed.
- Build: passed.
- LSP diagnostics were attempted after the TypeScript edits, but the shared LSP daemon socket did not become reachable; `bun run typecheck` is the type-system verification for this run.
- `doctor-verbose.txt` shows `[opencode].agents.oracle.fallback_models` is not reported as a deprecated config key, while `categories.deep.fallback_models` is still reported with migration guidance for converting it into a full `models` chain.
- `doctor-verbose.txt` summary separates check counts from issue counts: `2 checks passed, 1 failed, 3 with warnings, 2 skipped` and `4 issues found (3 warnings, 1 error)`.
- `config-migrate.json` shows current `dev` migration emits `[opencode].agents.sisyphus.models`.
- `post-migrate-doctor.json` shows the migrated config passes the Configuration check and the deprecated-key check reports `No deprecated config keys found`.

## Why It Is Enough

The unit tests pin the two doctor regressions and the migration validation round-trip. The CLI artifacts prove the built CLI output has the new summary wording and that current migrated OpenCode agent model chains validate without unknown-key errors.

## What Was Omitted

Full `doctor` exits with code 1 in the isolated sandbox because the plugin is not registered there, the model cache is absent, and `gh` is not authenticated inside the sandbox. Those are unrelated to the config-key and summary rendering changes.

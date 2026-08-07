# src/config-migration/ - Legacy Config Discovery + Transforms

## OVERVIEW

Discovers legacy config files (oh-my-opencode/oh-my-openagent JSON[C], `~/.omo/config.jsonc`) and builds migration plans that transform them into the unified `omo.json[c]` chain. The migration *engine* (lock, journal, no-clobber merge, atomic commit) lives in `packages/omo-config-core/src/migration/`; this directory owns the OpenCode-side discovery and content transforms. Consumed at plugin startup (opencode + senpi config-startup) and codex startup.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Which files count as legacy | `discovery.ts` + `discovery-roots.ts` + `discovery-paths.ts` (ids `OPENCODE_CONFIG_MIGRATION_ID`, `CONFIG_JSONC_MIGRATION_ID`) |
| Plan building | `migration-plans.ts` (`createLegacyConfigMigrationPlans`) |
| Plan execution | `migration-executor.ts` (`executeLegacyConfigMigrationPlan`) |
| Content transforms | `transform-opencode.ts` / `transform-config-jsonc.ts` |
| Reasoning-key unification | `reasoning-unification.ts` (`REASONING_UNIFICATION_MIGRATION_ID`, fixtures under `2026-08-reasoning-unification/`) |
| Historical migration ids | `legacy-history.ts` |

## CONVENTIONS

- Transforms are pure: they take loaded sources and return `ConfigMigrationTransformResult`; all filesystem side effects go through the omo-config-core engine.
- Every migration is identified by a stable id recorded in `_migrations`; never reuse or rename shipped ids (append to `legacy-history.ts` instead).
- `deep-diff.ts` backs no-clobber semantics: existing target values always win over migrated values.

## ANTI-PATTERNS

- Never write config files directly from here; hand plans to the engine (`runMigration`).
- Never delete legacy sources; migration copies forward and leaves timestamped backups.

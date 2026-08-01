# omo-config-core - Harness-Neutral omo.json Config Core

**Generated:** 2026-07-07

## OVERVIEW

Harness-neutral primitives for the `omo.json` config surface: a Zod v4 schema tree, a walked multi-layer loader with VSCode-style view resolution (shared base -> `[harness]` block -> `profiles.<P>` -> `profiles.<P>.[harness]`), a shared model catalog resolver, a comment-preserving atomic writer, and a lock+journal legacy-config migration engine. Pure logic with all IO injected through filesystem ports. No OpenCode, Codex, Senpi, Pi, or adapter imports (guarded by `script/shared-core-extraction-guard.test.ts`). Package: `@oh-my-opencode/omo-config-core` (private, `sideEffects: false`). This is THE config surface for every omo harness: `packages/omo-opencode` resolves its plugin config through it, `packages/omo-senpi` loads task/codegraph/config-watch settings plus startup migration through it, and `packages/omo-codex`'s codegraph loader reads through it.

## ANATOMY

| Path | Purpose |
|------|---------|
| `src/index.ts` | Barrel re-exporting `./schema`, `./loader`, `./models`, `./writer`, `./migration`. |
| `src/schema/config.ts` | Root `OmoConfigSchema` + `OmoConfigLayerSchema` (`.strict()`; `$schema`, `categories`, `agents`, `codegraph`, `task`, `teams`, `models`, `[opencode]`/`[senpi]`/`[codex]` blocks, `profiles`, `_migrations`, `legacy_migrations`). `OmoConfig` type. |
| `src/schema/harness.ts` | `HARNESS_IDS` (`codex`/`opencode`/`omo`), `OMO_CONFIG_HARNESS_IDS` (`opencode`/`senpi`/`codex`), `OmoHarnessIdSchema`, and `SETTING_HARNESS_SUPPORT` (per-key codegraph harness applicability). |
| `src/schema/model-catalog.ts` | `OmoModelCatalogSchema` / `*Layer` variants: record of short name to `{ model, variant?, reasoningEffort? }`. |
| `src/schema/category.ts` | `OmoCategoryConfigSchema` / `OmoCategoriesConfigSchema`. Keeps the OpenCode camelCase keys (`maxTokens`, `reasoningEffort`, `textVerbosity`) verbatim for parity. |
| `src/schema/codegraph.ts` | `OmoCodegraphSettingsSchema` (`daemon`, default `true`) for CodeGraph MCP daemon selection. |
| `src/schema/agent.ts` | `OmoAgentDefSchema` / `OmoAgentsConfigSchema` (`execution_mode`, `max_depth`, `allowed_subagents`, ...). |
| `src/schema/task.ts` | `OmoTaskSettingsSchema` + nested `OmoTaskNotificationSchema`, `OmoTaskWaitSchema`, `OmoTaskTeamSettingsSchema`, all with defaults. |
| `src/schema/team.ts` | `OmoTeamSpecSchema` (discriminated `category` / `subagent_type` members) + `OmoTeamsConfigSchema`; `*Layer` partial variants for per-file overrides. |
| `src/schema/fallback-models.ts` | `OmoFallbackModelsSchema` union (string, string[], object[], mixed[]) + `OmoThinkingConfigSchema`. |
| `src/loader/loader.ts` | `loadOmoConfig(options)` - reads each layer, JSONC-parses, validates the layer, merges, resolves the harness/profile view, then validates the merged config with defaults applied once at the end. |
| `src/loader/paths.ts` | `resolveOmoConfigPaths` (user layer + walked project layers), plus `resolveUserOmoConfigPath` / `resolveHomeDir`. |
| `src/loader/resolution.ts` | `resolveOmoConfigView` (base -> `[harness]` -> `profiles.<P>` -> `profiles.<P>.[harness]` fold, control keys stripped) + `resolveOmoProfileName` (`OMO_PROFILE` > `OCX_PROFILE` > `OPENCODE_CONFIG_DIR` tail `profiles/<name>` > none). |
| `src/loader/merge.ts` | `mergeOmoConfigRecords` - recursive deep merge with prototype-pollution key sanitization. |
| `src/loader/types.ts` | `LoadOmoConfigOptions/Result`, `OmoConfigDiagnostic`, `OmoConfigSource`, the injectable `OmoConfigReadFileSystem` port, and `DEFAULT_READ_FILE_SYSTEM`. |
| `src/models/model-reference-resolution.ts` | `resolveModelReferences` - expands `models` catalog keys referenced by agent/category `model` strings, fills unset tuning (site tuning wins), and reports `model_catalog_cycle` diagnostics. |
| `src/migration/` | Lock+journal transaction engine (`batch.ts`, `engine.ts`): owner-aware lease lock (`lock.ts`), journal recovery before predicates (`recovery.ts`, `predicate.ts`), per-(target, migration-id) `_migrations` markers, no-clobber merge with `skipped:` diagnostics (`merge.ts`), comment-preserving atomic target writes (`commit.ts`), and journaled resumable backups. |
| `src/writer/writer.ts` | `updateOmoConfig(options)` - jsonc-parser `modify`/`applyEdits`, timestamped backup, atomic temp-then-rename write. |
| `src/writer/types.ts` | `OmoConfigEdit`, `UpdateOmoConfigOptions/Result`, the injectable `OmoConfigWriteFileSystem` port, and the typed `OmoConfigWriteError`. |

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `schema/` | `OmoConfigSchema`, `OmoConfigLayerSchema`, `OmoCategoryConfigSchema`, `OmoCodegraphSettingsSchema`, `OmoAgentDefSchema`, `OmoTaskSettingsSchema`, `OmoTeamSpecSchema`, `OmoFallbackModelsSchema`, `OmoModelCatalogSchema`, `OmoHarnessIdSchema`, `HARNESS_IDS`, `OMO_CONFIG_HARNESS_IDS`, `SETTING_HARNESS_SUPPORT`; types `OmoConfig`, `OmoCategoryConfig`, `OmoCodegraphSettings`, `OmoAgentDef`, `OmoTaskSettings`, `OmoTeamSpec`, ... |
| `loader/` | `loadOmoConfig`, `resolveOmoConfigPaths`, `resolveOmoConfigView`, `resolveOmoProfileName`, `resolveUserOmoConfigPath`, `resolveHomeDir`; types `LoadOmoConfigResult`, `OmoConfigDiagnostic`, `OmoConfigSource`, `OmoConfigReadFileSystem` |
| `models/` | `resolveModelReferences`; types `OmoModelReferenceDiagnostic`, `ResolveModelReferencesResult` |
| `writer/` | `updateOmoConfig`, `OmoConfigWriteError`, `DEFAULT_WRITE_FILE_SYSTEM`; types `OmoConfigEdit`, `UpdateOmoConfigOptions`, `UpdateOmoConfigResult` |
| `migration/` | `runMigration`, `runMigrations`, journal/lock/predicate/recovery primitives; types `MigrationRunResult`, `RunMigrationOptions`, `MigrationFileSystem`, `MigrationBoundary` |

### Layer precedence (`resolveOmoConfigPaths` + `loadOmoConfig`)

`resolveOmoConfigPaths` returns the user layer first, then project layers farthest-first (`paths.ts:98`). `loadOmoConfig` folds each layer onto the accumulator in order, so the last-merged layer wins: **nearest project `.omo/omo.jsonc` beats a farther ancestor, and any loaded project layer beats the user layer**. Missing or unparseable layers become `diagnostics` and are skipped; the accumulator starts from `DEFAULT_RAW_CONFIG` (task defaults parsed from the schema). The merged document then resolves through `resolveOmoConfigView` (shared base -> `[harness]` -> `profiles.<P>` -> `profiles.<P>.[harness]`, control keys stripped) before the final `OmoConfigSchema` parse applies defaults once. If the merged result fails final validation the loader returns the all-default config plus a `validation` diagnostic rather than throwing.

### Filename resolution (`paths.ts`)

- User dir: `~/.omo` on every platform; prefers `omo.jsonc`, falls back to `omo.json` (`paths.ts:29`). There is no `$XDG_CONFIG_HOME` / `%APPDATA%` / `~/.config/omo` branch, and `legacy-user-config-purge.test.ts` fails the suite if one returns.
- Project layers: `<dir>/.omo/omo.jsonc` (then `omo.json`) walked from `cwd` up to `$HOME`, skipping `$HOME` itself so the `~/.omo` user layer is not also counted as a project layer (`paths.ts:76`).
- Symlinked project `.omo` dirs and symlinked project config files are refused as a load source (`paths.ts:57`).

### Merge safety (`merge.ts`)

Recursively deep-merges plain objects; scalars and arrays replace. `__proto__`, `prototype`, and `constructor` keys are dropped via `isUnsafeObjectKey` on both the merge key and every nested value (`merge.ts:9`, `merge.ts:22`).

### Writer guarantees (`writer.ts`)

`updateOmoConfig` refuses symlinked target paths and symlinked project `.omo` dirs (`writer.ts:83`, `writer.ts:94`), rejects a target whose existing content is not valid JSONC (`writer.ts:109`), writes a `.bak.<timestamp>` backup of any existing file with exclusive-create collision retries (`writer.ts:36`), applies each `OmoConfigEdit` through jsonc-parser so comments and trailing commas survive, then writes atomically via a unique temp file plus `rename` (`writer.ts:66`). Every failure surfaces as a typed `OmoConfigWriteError` carrying `operation` (`"backup" | "parse" | "read" | "write"`) and the underlying cause (`types.ts:67`).

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`parseJsoncSafe`, `isPlainObject`, `isUnsafeObjectKey`), `jsonc-parser`, `zod`.
- **Consumed by:** `packages/senpi-task` (schema types re-used by the task/team config surface), `packages/omo-senpi` (`components/config-resolution` wraps `loadOmoConfig` + `resolveModelReferences`; `components/config-startup` runs the migration engine at startup; `components/task` and `components/codegraph` consume the resolved config), `packages/omo-opencode` (`plugin-config/omo-config-chain.ts` builds the per-layer OpenCode views and the user-only protected view; `startup-migration.ts` drives the engine; `config-migration/` supplies OpenCode-side discovery + transform), and `packages/omo-codex` (`plugin/shared/src/config-loader.ts` + `config-migration.ts` for the `config.jsonc` group).

## QA

```sh
tsgo --noEmit -p packages/omo-config-core/tsconfig.json
bun test packages/omo-config-core
```

Co-located `*.test.ts` cover the schema (`src/schema/config-schema.test.ts`), the loader precedence and diagnostics (`src/loader/loader.test.ts`), the deep-merge and pollution guard (`src/loader/merge.test.ts`), and the writer plus its symlink/atomicity security path (`src/writer/writer.test.ts`, `src/writer/writer-security.test.ts`). Parent: [`packages/AGENTS.md`](../AGENTS.md).

## GENERATED SCHEMA

The checked-in generated JSON artifact at `assets/omo.schema.json` is produced by `bun run build:omo-schema` via [`script/build-omo-schema.ts`](../../script/build-omo-schema.ts). Its `$id` and editor URL are `https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json`. This package owns the schema source; the generated JSON artifact remains an ownership-boundary surface outside this package.

## FOLLOW-UPS

- The category schema must stay in field parity with `packages/omo-opencode/src/config/schema/categories.ts`; a drift guard test is still pending.

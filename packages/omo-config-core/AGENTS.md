# omo-config-core - Harness-Neutral omo.json Config Core

**Generated:** 2026-07-07

## OVERVIEW

Harness-neutral primitives for the `omo.json` config surface: a Zod v4 schema tree, a walked multi-layer loader, and a comment-preserving atomic writer. Pure logic with all IO injected through a filesystem port. No OpenCode, Codex, Senpi, Pi, or adapter imports (guarded by `script/shared-core-extraction-guard.test.ts`). Package: `@oh-my-opencode/omo-config-core` (private, `sideEffects: false`). Consumed first by the Senpi adapter (`packages/omo-senpi`); the OpenCode migration onto this core is a later phase (see [`ROADMAP.md`](../../ROADMAP.md)).

## ANATOMY

| Path | Purpose |
|------|---------|
| `src/index.ts` | Barrel re-exporting `./schema`, `./loader`, `./writer`. |
| `src/schema/config.ts` | Root `OmoConfigSchema` + `OmoConfigLayerSchema` (`.strict()`; `$schema`, `categories`, `agents`, `task`, `teams`). `OmoConfig` type. |
| `src/schema/category.ts` | `OmoCategoryConfigSchema` / `OmoCategoriesConfigSchema`. Keeps the OpenCode camelCase keys (`maxTokens`, `reasoningEffort`, `textVerbosity`) verbatim for parity. |
| `src/schema/agent.ts` | `OmoAgentDefSchema` / `OmoAgentsConfigSchema` (`execution_mode`, `max_depth`, `allowed_subagents`, ...). |
| `src/schema/task.ts` | `OmoTaskSettingsSchema` + nested `OmoTaskNotificationSchema`, `OmoTaskWaitSchema`, `OmoTaskTeamSettingsSchema`, all with defaults. |
| `src/schema/team.ts` | `OmoTeamSpecSchema` (discriminated `category` / `subagent_type` members) + `OmoTeamsConfigSchema`; `*Layer` partial variants for per-file overrides. |
| `src/schema/fallback-models.ts` | `OmoFallbackModelsSchema` union (string, string[], object[], mixed[]) + `OmoThinkingConfigSchema`. |
| `src/loader/loader.ts` | `loadOmoConfig(options)` - reads each layer, JSONC-parses, validates the layer, merges, then validates the merged config. |
| `src/loader/paths.ts` | `resolveOmoConfigPaths` (user layer + walked project layers), plus `resolveUserOmoConfigPath` / `resolveHomeDir`. |
| `src/loader/merge.ts` | `mergeOmoConfigRecords` - recursive deep merge with prototype-pollution key sanitization. |
| `src/loader/types.ts` | `LoadOmoConfigOptions/Result`, `OmoConfigDiagnostic`, `OmoConfigSource`, the injectable `OmoConfigReadFileSystem` port, and `DEFAULT_READ_FILE_SYSTEM`. |
| `src/writer/writer.ts` | `updateOmoConfig(options)` - jsonc-parser `modify`/`applyEdits`, timestamped backup, atomic temp-then-rename write. |
| `src/writer/types.ts` | `OmoConfigEdit`, `UpdateOmoConfigOptions/Result`, the injectable `OmoConfigWriteFileSystem` port, and the typed `OmoConfigWriteError`. |

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `schema/` | `OmoConfigSchema`, `OmoConfigLayerSchema`, `OmoCategoryConfigSchema`, `OmoAgentDefSchema`, `OmoTaskSettingsSchema`, `OmoTeamSpecSchema`, `OmoFallbackModelsSchema`; types `OmoConfig`, `OmoCategoryConfig`, `OmoAgentDef`, `OmoTaskSettings`, `OmoTeamSpec`, ... |
| `loader/` | `loadOmoConfig`, `resolveOmoConfigPaths`, `resolveUserOmoConfigPath`, `resolveHomeDir`; types `LoadOmoConfigResult`, `OmoConfigDiagnostic`, `OmoConfigSource`, `OmoConfigReadFileSystem` |
| `writer/` | `updateOmoConfig`, `OmoConfigWriteError`, `DEFAULT_WRITE_FILE_SYSTEM`; types `OmoConfigEdit`, `UpdateOmoConfigOptions`, `UpdateOmoConfigResult` |

### Layer precedence (`resolveOmoConfigPaths` + `loadOmoConfig`)

`resolveOmoConfigPaths` returns the user layer first, then project layers farthest-first (`paths.ts:108`). `loadOmoConfig` folds each layer onto the accumulator in order (`loader.ts:104`), so the last-merged layer wins: **nearest project `.omo/omo.jsonc` beats a farther ancestor, and any loaded project layer beats the user layer**. Missing or unparseable layers become `diagnostics` and are skipped; the accumulator starts from `DEFAULT_RAW_CONFIG` (task defaults parsed from the schema). If the merged result fails final validation the loader returns the all-default config plus a `validation` diagnostic (`loader.ts:116`) rather than throwing.

### Filename + platform resolution (`paths.ts`)

- User dir: `%APPDATA%\omo` on win32, else `$XDG_CONFIG_HOME/omo`, else `~/.config/omo`; prefers `omo.jsonc`, falls back to `omo.json` (`paths.ts:45`).
- Project layers: `<dir>/.omo/omo.jsonc` (then `omo.json`) walked from `cwd` up to `$HOME` (`paths.ts:80`).
- Symlinked project `.omo` dirs and symlinked project config files are refused as a load source (`paths.ts:57`).

### Merge safety (`merge.ts`)

Recursively deep-merges plain objects; scalars and arrays replace. `__proto__`, `prototype`, and `constructor` keys are dropped via `isUnsafeObjectKey` on both the merge key and every nested value (`merge.ts:9`, `merge.ts:22`).

### Writer guarantees (`writer.ts`)

`updateOmoConfig` refuses symlinked target paths and symlinked project `.omo` dirs (`writer.ts:83`, `writer.ts:94`), rejects a target whose existing content is not valid JSONC (`writer.ts:109`), writes a `.bak.<timestamp>` backup of any existing file with exclusive-create collision retries (`writer.ts:36`), applies each `OmoConfigEdit` through jsonc-parser so comments and trailing commas survive, then writes atomically via a unique temp file plus `rename` (`writer.ts:66`). Every failure surfaces as a typed `OmoConfigWriteError` carrying `operation` (`"backup" | "parse" | "read" | "write"`) and the underlying cause (`types.ts:67`).

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`parseJsoncSafe`, `isPlainObject`, `isUnsafeObjectKey`), `jsonc-parser`, `zod`.
- **Consumed by:** `packages/senpi-task` (schema types re-used by the task/team config surface) and `packages/omo-senpi/src/components/task` (`loadOmoConfig` at component register, `coexistence.ts` reads `OmoConfigSource`).

## QA

```sh
tsgo --noEmit -p packages/omo-config-core/tsconfig.json
bun test packages/omo-config-core
```

Co-located `*.test.ts` cover the schema (`src/schema/config-schema.test.ts`), the loader precedence and diagnostics (`src/loader/loader.test.ts`), the deep-merge and pollution guard (`src/loader/merge.test.ts`), and the writer plus its symlink/atomicity security path (`src/writer/writer.test.ts`, `src/writer/writer-security.test.ts`). Parent: [`packages/AGENTS.md`](../AGENTS.md).

## GENERATED SCHEMA

The checked-in generated JSON artifact at `assets/omo.schema.json` is produced by `bun run build:omo-schema` via [`script/build-omo-schema.ts`](../../script/build-omo-schema.ts). Its `$id` and editor URL are `https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json`. This package owns the schema source; the generated JSON artifact remains an ownership-boundary surface outside this package.

## FOLLOW-UPS

- The category schema must stay in field parity with `packages/omo-opencode/src/config/schema/categories.ts`; a drift guard belongs with the OpenCode-migration phase, not here.

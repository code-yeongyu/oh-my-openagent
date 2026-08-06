# src/shared/ — Shared Adapter Utilities

**Generated:** 2026-05-20

## OVERVIEW

Cross-cutting adapter utilities used throughout the plugin. Barrel-exported from `index.ts`. Logger writes `oh-my-opencode.log` to the OS temp dir (Node's `os.tmpdir()` — `/tmp` on Linux, `%TEMP%` on Windows, etc.); rotated at 50 MB; up to 2 backups at `.1` / `.2`. Includes runtime shims for `Bun.file`, `Bun.write`, `Bun.hash`, `Bun.which`, `Bun.spawn` to support non-Bun runtimes (Electron-hosted OpenCode). Many former utility implementations are now extracted to Core packages such as `utils`, `model-core`, `tmux-core`, `telemetry-core`, and `skills-loader-core`; keep local files as stable OpenCode import shims when existing wiring depends on their paths.

## CATEGORY MAP

| Category | Files | Key Exports |
|----------|-------|-------------|
| **Model Resolution** | ~22 | `resolveModel()`, `checkModelAvailability()`, `AGENT_MODEL_REQUIREMENTS` |
| **Tmux Integration** | 11 | `createTmuxSession()`, `spawnPane()`, `closePane()`, server health |
| **Configuration & Paths** | 10 | `resolveOpenCodeConfigDir()`, `getDataPath()`, `parseJSONC()` |
| **Session Management** | 8 | `SessionCursor`, `trackInjectedPath()`, `SessionToolsStore` |
| **Git Worktree** | 7 | `parseGitStatusPorcelain()`, `collectGitDiffStats()`, `formatFileChanges()` |
| **Command Execution** | 7 | `executeCommand()`, `executeHookCommand()`, embedded command registry |
| **Migration** | 6 | `migrateConfigFile()`, AGENT_NAME_MAP, HOOK_NAME_MAP, MODEL_VERSION_MAP |
| **String & Tool Utils** | 6 | `toSnakeCase()`, `normalizeToolName()`, `parseFrontmatter()` |
| **Agent Configuration** | 5 | `getAgentVariant()`, `AGENT_DISPLAY_NAMES`, `AGENT_TOOL_RESTRICTIONS` |
| **OpenCode Integration** | 5 | `injectServerAuth()`, `detectExternalPlugins()`, client accessors |
| **Type Helpers** | 4 | `deepMerge()`, `DynamicTruncator`, `matchPattern()`, `isRecord()` |
| **Misc** | 8 | `log()`, `readFile()`, `extractZip()`, `downloadBinary()`, `findAvailablePort()` |

## MODEL RESOLUTION PIPELINE

```
resolveModel(input)
  1. Override: UI-selected model (primary agents only)
  2. Category default: From category config
  3. Provider fallback: AGENT_MODEL_REQUIREMENTS chains
  4. System default: Ultimate fallback
```

Key files: `model-resolver.ts` (entry), `model-resolution-pipeline.ts` (orchestration), `model-requirements.ts` (fallback chains), `model-availability.ts` (fuzzy matching).

## MIGRATION SYSTEM

Automatically transforms legacy config on load:
- `agent-names.ts`: Old agent names → new (e.g., `junior` → `sisyphus-junior`)
- `hook-names.ts`: Old hook names → new
- `model-versions.ts`: Old model IDs → current
- `agent-category.ts`: Legacy agent configs → category system

## MOST IMPORTED

| Utility | Import Count | Purpose |
|---------|-------------|---------|
| `logger.ts` | 62 | `oh-my-opencode.log` in `os.tmpdir()` (50 MB cap, rotates to `.1`/`.2`) |
| `data-path.ts` | 11 | XDG storage resolution |
| `model-requirements.ts` | 11 | Agent fallback chains |
| `system-directive.ts` | 11 | System message filtering |
| `frontmatter.ts` | 10 | YAML metadata extraction |

# src/shared/ — 101 Utility Files in 13 Categories

**Generated:** 2026-02-17

## OVERVIEW

Cross-cutting utilities used throughout the plugin. Barrel-exported from `index.ts`. Logger writes to `/tmp/oh-my-opencode.log`.

## CATEGORY MAP

| Category | Files | Key Exports |
|----------|-------|-------------|
| **Model Resolution** | 17 | `resolveModel()`, `checkModelAvailability()`, `AGENT_MODEL_REQUIREMENTS` |
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

Key files: `model-resolver.ts` (entry), `model-resolution-pipeline.ts` (orchestration), `model-requirements.ts` (fallback chains), `model-name-matcher.ts` (fuzzy matching).

## MIGRATION SYSTEM

Automatically transforms legacy config on load:
- `agent-names.ts`: Old agent names → new (e.g., `junior` → `sisyphus-junior`)
- `hook-names.ts`: Old hook names → new
- `model-versions.ts`: Old model IDs → current
- `agent-category.ts`: Legacy agent configs → category system

## MOST IMPORTED

| Utility | Import Count | Purpose |
|---------|-------------|---------|
| `logger.ts` | 62 | `/tmp/oh-my-opencode.log` |
| `data-path.ts` | 11 | XDG storage resolution |
| `model-requirements.ts` | 11 | Agent fallback chains |
| `system-directive.ts` | 11 | System message filtering |
| `frontmatter.ts` | 10 | YAML metadata extraction |

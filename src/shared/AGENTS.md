# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

Cross-cutting utility functions used across agents, hooks, tools, and features. Path resolution, config management, text processing, and Claude Code compatibility helpers.

## STRUCTURE

```
shared/
├── index.ts              # Barrel export (import { x } from "../shared")
├── claude-config-dir.ts  # Resolve ~/.claude directory
├── command-executor.ts   # Shell command execution with variable expansion
├── config-errors.ts      # Global config error tracking
├── config-path.ts        # User/project config path resolution
├── data-path.ts          # XDG data directory resolution
├── deep-merge.ts         # Type-safe recursive object merging
├── dynamic-truncator.ts  # Token-aware output truncation
├── file-reference-resolver.ts  # @filename syntax resolution
├── file-utils.ts         # Symlink resolution, markdown detection
├── frontmatter.ts        # YAML frontmatter parsing
├── hook-disabled.ts      # Check if hook is disabled in config
├── jsonc-parser.ts       # JSON with Comments parsing
├── logger.ts             # File-based logging to OS temp
├── migration.ts          # Legacy name compatibility (omo -> Sisyphus)
├── model-sanitizer.ts    # Normalize model names
├── pattern-matcher.ts    # Tool name matching with wildcards
├── snake-case.ts         # Case conversion for objects
└── tool-name.ts          # Normalize tool names to PascalCase
```

## UTILITY CATEGORIES

| Category | Utilities | Used By |
|----------|-----------|---------|
| Path Resolution | `getClaudeConfigDir`, `getUserConfigPath`, `getProjectConfigPath`, `getDataDir` | Features, Hooks |
| Config Management | `deepMerge`, `parseJsonc`, `isHookDisabled`, `configErrors` | index.ts, CLI |
| Text Processing | `resolveCommandsInText`, `resolveFileReferencesInText`, `parseFrontmatter` | Commands, Rules |
| Output Control | `dynamicTruncate` | Tools (Grep, LSP) |
| Normalization | `transformToolName`, `objectToSnakeCase`, `sanitizeModelName` | Hooks, Agents |
| Compatibility | `migration.ts` | Config loading |

## WHEN TO USE WHAT

| Task | Utility | Notes |
|------|---------|-------|
| Find Claude Code configs | `getClaudeConfigDir()` | Never hardcode `~/.claude` |
| Merge settings (default → user → project) | `deepMerge(base, override)` | Arrays replaced, objects merged |
| Parse user config files | `parseJsonc()` | Supports comments and trailing commas |
| Check if hook should run | `isHookDisabled(name, disabledHooks)` | Respects `disabled_hooks` config |
| Truncate large tool output | `dynamicTruncate(text, budget, reserved)` | Token-aware, prevents overflow |
| Resolve `@file` references | `resolveFileReferencesInText()` | maxDepth=3 prevents infinite loops |
| Execute shell commands | `resolveCommandsInText()` | Supports `!`\`command\`\` syntax |
| Handle legacy agent names | `migrateLegacyAgentNames()` | `omo` → `Sisyphus` |

## CRITICAL PATTERNS

### Dynamic Truncation
```typescript
import { dynamicTruncate } from "../shared"
// Keep 50% headroom, max 50k tokens
const output = dynamicTruncate(result, remainingTokens, 0.5)
```

### Deep Merge Priority
```typescript
const final = deepMerge(defaults, userConfig)
final = deepMerge(final, projectConfig) // Project wins
```

### Safe JSONC Parsing
```typescript
const { config, error } = parseJsoncSafe(content)
if (error) return fallback
```

## ANTI-PATTERNS (SHARED)

- **Hardcoding paths**: Use `getClaudeConfigDir()`, `getUserConfigPath()`
- **Manual JSON.parse**: Use `parseJsonc()` for user files (comments allowed)
- **Ignoring truncation**: Large outputs MUST use `dynamicTruncate`
- **Direct string concat for configs**: Use `deepMerge` for proper priority

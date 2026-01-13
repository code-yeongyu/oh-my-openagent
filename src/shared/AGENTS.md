# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW
Cross-cutting utilities for path resolution, config management, text processing, and Claude Code compatibility.

## STRUCTURE
```
shared/
├── index.ts              # Barrel export
├── claude-config-dir.ts  # ~/.claude resolution
├── command-executor.ts   # Shell exec with variable expansion
├── config-errors.ts      # Global error tracking
├── config-path.ts        # User/project config paths
├── data-path.ts          # XDG data directory
├── deep-merge.ts         # Type-safe recursive merge
├── dynamic-truncator.ts  # Token-aware truncation
├── file-reference-resolver.ts  # @filename syntax
├── file-utils.ts         # Symlink, markdown detection
├── frontmatter.ts        # YAML frontmatter parsing
├── hook-disabled.ts      # Check if hook disabled
├── jsonc-parser.ts       # JSON with Comments
├── logger.ts             # File-based logging
├── migration.ts          # Legacy name compat (omo → Sisyphus)
├── model-sanitizer.ts    # Normalize model names
├── pattern-matcher.ts    # Tool name matching
├── snake-case.ts         # Case conversion
└── tool-name.ts          # PascalCase normalization
```

## WHEN TO USE
| Task | Utility |
|------|---------|
| Find ~/.claude | `getClaudeConfigDir()` |
| Merge configs | `deepMerge(base, override)` |
| Parse user files | `parseJsonc()` |
| Check hook enabled | `isHookDisabled(name, list)` |
| Truncate output | `dynamicTruncate(text, budget)` |
| Resolve @file | `resolveFileReferencesInText()` |
| Execute shell | `resolveCommandsInText()` |
| Legacy names | `migrateLegacyAgentNames()` |

## CRITICAL PATTERNS
```typescript
// Dynamic truncation with context budget
const output = dynamicTruncate(result, remainingTokens, 0.5)

// Config resolution priority
const final = deepMerge(deepMerge(defaults, userConfig), projectConfig)

// Safe JSONC parsing for user-edited files
const { config, error } = parseJsoncSafe(content)
```

## ANTI-PATTERNS
- Hardcoding paths (use `getClaudeConfigDir`, `getUserConfigPath`)
- Using `JSON.parse` for user configs (always use `parseJsonc`)
- Ignoring output size (large tool outputs MUST use `dynamicTruncate`)
- Manual case conversion (use `toSnakeCase`, `normalizeToolName`)

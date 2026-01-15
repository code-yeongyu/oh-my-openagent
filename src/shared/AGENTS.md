# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW
Cross-cutting utilities for path resolution, config management, text processing, and Claude Code compatibility.

## STRUCTURE
```
shared/
├── index.ts              # Barrel export
├── agent-variant.ts      # Agent model/prompt variation logic
├── claude-config-dir.ts  # ~/.claude resolution
├── command-executor.ts   # Shell exec with variable expansion
├── config-errors.ts      # Global error tracking
├── config-path.ts        # User/project config paths
├── data-path.ts          # XDG data directory
├── deep-merge.ts         # Type-safe recursive merge
├── dynamic-truncator.ts  # Token-aware truncation
├── external-plugin-detector.ts # Detect marketplace plugins
├── file-reference-resolver.ts  # @filename syntax
├── file-utils.ts         # Symlink, markdown detection
├── first-message-variant.ts    # Initial prompt variations
├── frontmatter.ts        # YAML frontmatter parsing
├── hook-disabled.ts      # Check if hook disabled
├── jsonc-parser.ts       # JSON with Comments
├── logger.ts             # File-based logging
├── migration.ts          # Legacy name compat (omo → Sisyphus)
├── model-sanitizer.ts    # Normalize model names
├── opencode-config-dir.ts # ~/.config/opencode resolution
├── opencode-version.ts   # Version comparison logic
├── pattern-matcher.ts    # Tool name matching
├── permission-compat.ts  # Legacy permission mapping
├── session-cursor.ts     # Track message history pointer
├── snake-case.ts         # Case conversion
├── tool-name.ts          # PascalCase normalization
└── zip-extractor.ts      # Plugin installation utility
```

## WHEN TO USE
| Task | Utility |
|------|---------|
| Find ~/.claude | `getClaudeConfigDir()` |
| Find ~/.config/opencode | `getOpenCodeConfigDir()` |
| Merge configs | `deepMerge(base, override)` |
| Parse user files | `parseJsonc()` |
| Check hook enabled | `isHookDisabled(name, list)` |
| Truncate output | `dynamicTruncate(text, budget)` |
| Resolve @file | `resolveFileReferencesInText()` |
| Execute shell | `resolveCommandsInText()` |
| Legacy names | `migrateLegacyAgentNames()` |
| Version check | `isOpenCodeVersionAtLeast(version)` |
| Map permissions | `normalizePermission()` |
| Track session | `SessionCursor` |

## CRITICAL PATTERNS
```typescript
// Dynamic truncation with context budget
const output = dynamicTruncate(result, remainingTokens, 0.5)

// Config resolution priority
const final = deepMerge(deepMerge(defaults, userConfig), projectConfig)

// Safe JSONC parsing for user-edited files
const { config, error } = parseJsoncSafe(content)

// Version-gated features
if (isOpenCodeVersionAtLeast('1.0.150')) { /* ... */ }
```

## ANTI-PATTERNS
- Hardcoding paths (use `getClaudeConfigDir`, `getOpenCodeConfigDir`)
- Using `JSON.parse` for user configs (always use `parseJsonc`)
- Ignoring output size (large tool outputs MUST use `dynamicTruncate`)
- Manual version parsing (use `opencode-version.ts` utilities)
- Raw permission checks (use `permission-compat.ts`)

# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW
Core cross-cutting utilities for path resolution, token-safe text processing, and Claude Code compatibility.

## STRUCTURE
```
shared/
├── logger.ts              # Persistent file-based logging (tmpdir/oh-my-opencode.log)
├── permission-compat.ts   # Agent tool restrictions (ask/allow/deny)
├── dynamic-truncator.ts   # Token-aware truncation with context headroom
├── frontmatter.ts         # YAML frontmatter parsing with JSON_SCHEMA safety
├── jsonc-parser.ts        # JSON with Comments support for config files
├── data-path.ts           # XDG-compliant storage paths (~/.local/share)
├── opencode-config-dir.ts # Resolve ~/.config/opencode for CLI/Desktop
├── claude-config-dir.ts   # Resolve ~/.claude for compatibility
├── migration.ts           # Legacy name mapping (omo -> Sisyphus)
└── opencode-version.ts    # Version comparison logic (e.g., >= 1.0.150)
```

## WHEN TO USE
| Task | Utility |
|------|---------|
| Debugging/Auditing | `log(message, data)` in `logger.ts` |
| Limit agent context | `dynamicTruncate(ctx, sessionId, output)` |
| Parse rule meta | `parseFrontmatter(content)` |
| Load user configs | `parseJsonc(text)` or `readJsoncFile(path)` |
| Restrict tools | `createAgentToolAllowlist(tools)` |
| Resolve app paths | `getOpenCodeConfigDir()` or `getClaudeConfigDir()` |
| Update legacy config | `migrateConfigFile(path, rawConfig)` |

## CRITICAL PATTERNS
```typescript
// Truncate large output based on 50% remaining context window
const { result } = await dynamicTruncate(ctx, sessionID, largeBuffer);

// Safe config loading with comment/trailing comma support
const settings = readJsoncFile<Settings>(configPath);

// Version-gated logic for OpenCode 1.1.0+
if (isOpenCodeVersionAtLeast("1.1.0")) { /* ... */ }

// Permission normalization for agent tools
const permissions = migrateToolsToPermission(legacyTools);
```

## ANTI-PATTERNS
- Raw `JSON.parse` for configs (use `jsonc-parser.ts`)
- Hardcoded `~/.claude` (use `claude-config-dir.ts`)
- `console.log` for background agents (use `logger.ts`)
- Unbounded tool output (always use `dynamic-truncator.ts`)
- Manual version parsing (use `opencode-version.ts`)

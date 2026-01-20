# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

43 cross-cutting utilities: path resolution, token truncation, config parsing, Claude Code compatibility.

## STRUCTURE

```
shared/
├── logger.ts              # File-based logging (tmpdir/oh-my-opencode.log)
├── permission-compat.ts   # Agent tool restrictions (ask/allow/deny)
├── dynamic-truncator.ts   # Token-aware truncation (50% headroom)
├── frontmatter.ts         # YAML frontmatter parsing
├── jsonc-parser.ts        # JSON with Comments support
├── data-path.ts           # XDG-compliant storage (~/.local/share)
├── opencode-config-dir.ts # ~/.config/opencode resolution
├── claude-config-dir.ts   # ~/.claude resolution
├── migration.ts           # Legacy config migration (omo → Sisyphus)
├── opencode-version.ts    # Version comparison (>= 1.0.150)
├── external-plugin-detector.ts # OAuth spoofing detection
├── env-expander.ts        # ${VAR} expansion in configs
├── system-directive.ts    # System directive types
├── hook-utils.ts          # Hook helper functions
└── *.test.ts              # Test files (colocated)
```

## WHEN TO USE

| Task | Utility |
|------|---------|
| Debug logging | `log(message, data)` in `logger.ts` |
| Limit context | `dynamicTruncate(ctx, sessionId, output)` |
| Parse frontmatter | `parseFrontmatter(content)` |
| Load JSONC config | `parseJsonc(text)` or `readJsoncFile(path)` |
| Restrict agent tools | `createAgentToolAllowlist(tools)` |
| Resolve paths | `getOpenCodeConfigDir()`, `getClaudeConfigDir()` |
| Migrate config | `migrateConfigFile(path, rawConfig)` |
| Compare versions | `isOpenCodeVersionAtLeast("1.1.0")` |

## KEY PATTERNS

```typescript
// Token-aware truncation
const { result } = await dynamicTruncate(ctx, sessionID, largeBuffer)

// JSONC config loading
const settings = readJsoncFile<Settings>(configPath)

// Version-gated features
if (isOpenCodeVersionAtLeast("1.1.0")) { /* new feature */ }

// Tool permission normalization
const permissions = migrateToolsToPermission(legacyTools)
```

## ANTI-PATTERNS

- **Raw JSON.parse**: Use `jsonc-parser.ts` for config files
- **Hardcoded paths**: Use `*-config-dir.ts` utilities
- **console.log**: Use `logger.ts` for background agents
- **Unbounded output**: Always use `dynamic-truncator.ts`
- **Manual version parse**: Use `opencode-version.ts`

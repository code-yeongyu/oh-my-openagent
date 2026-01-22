# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

50 cross-cutting utilities: path resolution, token truncation, config parsing, model resolution, Claude Code compatibility.

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
├── model-requirements.ts  # Agent/Category model requirements (providers + model)
├── model-availability.ts  # Available models fetch + fuzzy matching
├── model-resolver.ts      # 3-step model resolution (override → provider fallback → default)
├── shell-env.ts           # Cross-platform shell environment
├── prompt-parts-helper.ts # Prompt parts manipulation
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
| Get agent model requirements | `AGENT_MODEL_REQUIREMENTS` in `model-requirements.ts` |
| Get category model requirements | `CATEGORY_MODEL_REQUIREMENTS` in `model-requirements.ts` |
| Resolve model with fallback | `resolveModelWithFallback()` in `model-resolver.ts` |
| Fuzzy match model names | `fuzzyMatchModel()` in `model-availability.ts` |
| Fetch available models | `fetchAvailableModels(client)` in `model-availability.ts` |

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

// Model resolution with fallback chain
const model = await resolveModelWithFallback(client, requirements, override)
```

## ANTI-PATTERNS

- **Raw JSON.parse**: Use `jsonc-parser.ts` for config files
- **Hardcoded paths**: Use `*-config-dir.ts` utilities
- **console.log**: Use `logger.ts` for background agents
- **Unbounded output**: Always use `dynamic-truncator.ts`
- **Manual version parse**: Use `opencode-version.ts`

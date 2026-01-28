# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW
55 cross-cutting utilities: path resolution, token truncation, config parsing, model resolution.

## STRUCTURE
```
shared/
├── tmux/                  # Tmux TUI integration (types, utils, constants)
├── logger.ts              # File-based logging (/tmp/oh-my-opencode.log)
├── dynamic-truncator.ts   # Token-aware context window management (194 lines)
├── model-resolver.ts      # 3-step resolution (Override → Fallback → Default)
├── model-requirements.ts  # Agent/category model fallback chains (132 lines)
├── model-availability.ts  # Provider model fetching & fuzzy matching (154 lines)
├── jsonc-parser.ts        # JSONC parsing with comment support
├── frontmatter.ts         # YAML frontmatter extraction (JSON_SCHEMA only)
├── data-path.ts           # XDG-compliant storage resolution
├── opencode-config-dir.ts # ~/.config/opencode resolution (143 lines)
├── claude-config-dir.ts   # ~/.claude resolution
├── migration.ts           # Legacy config migration logic (231 lines)
├── opencode-version.ts    # Semantic version comparison
├── permission-compat.ts   # Agent tool restriction enforcement
├── system-directive.ts    # Unified system message prefix & types
├── session-utils.ts       # Session cursor, orchestrator detection
├── shell-env.ts           # Cross-platform shell environment
├── agent-variant.ts       # Agent variant from config
├── zip-extractor.ts       # Binary/Resource ZIP extraction
├── deep-merge.ts          # Recursive object merging (proto-pollution safe, MAX_DEPTH=50)
├── case-insensitive.ts    # Case-insensitive object lookups
├── session-cursor.ts      # Session message cursor tracking
├── command-executor.ts    # Shell command execution (225 lines)
└── index.ts               # Barrel export for all utilities
```

## MOST IMPORTED
| Utility | Users | Purpose |
|---------|-------|---------|
| logger.ts | 16+ | Background task visibility |
| system-directive.ts | 8+ | Message filtering |
| opencode-config-dir.ts | 8+ | Path resolution |
| permission-compat.ts | 6+ | Tool restrictions |

## WHEN TO USE
| Task | Utility |
|------|---------|
| Path Resolution | `getOpenCodeConfigDir()`, `getDataPath()` |
| Token Truncation | `dynamicTruncate(ctx, sessionId, output)` |
| Config Parsing | `readJsoncFile<T>(path)`, `parseJsonc(text)` |
| Model Resolution | `resolveModelWithFallback(client, reqs, override)` |
| Version Gating | `isOpenCodeVersionAtLeast(version)` |
| YAML Metadata | `parseFrontmatter(content)` |
| Tool Security | `createAgentToolAllowlist(tools)` |
| System Messages | `createSystemDirective(type)`, `isSystemDirective(msg)` |
| Deep Merge | `deepMerge(target, source)` |

## KEY PATTERNS

**3-Step Resolution** (Override → Fallback → Default):
```typescript
const model = resolveModelWithFallback({
  userModel: config.agents.sisyphus.model,
  fallbackChain: AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain,
  availableModels: fetchedModels,
})
```

**System Directive Filtering**:
```typescript
if (isSystemDirective(message)) return  // Skip system-generated
const directive = createSystemDirective("TODO CONTINUATION")
```

## ANTI-PATTERNS
- **Raw JSON.parse**: Use `jsonc-parser.ts` for comment support
- **Hardcoded Paths**: Use `*-config-dir.ts` or `data-path.ts`
- **console.log**: Use `logger.ts` for background task visibility
- **Unbounded Output**: Use `dynamic-truncator.ts` to prevent overflow
- **Manual Version Check**: Use `opencode-version.ts` for semver safety

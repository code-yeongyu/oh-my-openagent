# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

66 cross-cutting utilities. Import via barrel pattern: `import { log, deepMerge } from "../../shared"`

**Categories**: Path resolution, Token truncation, Config parsing, Model resolution, System directives, Tool restrictions

## STRUCTURE
```
shared/
├── tmux/                  # Tmux TUI integration (types, utils, constants)
├── terminal-multiplexer/  # Terminal multiplexer abstraction (tmux/zellij)
├── logger.ts              # File-based logging (/tmp/oh-my-opencode.log) - 53 imports
├── dynamic-truncator.ts   # Token-aware context window management (194 lines)
├── model-resolver.ts      # 3-step resolution (Override → Fallback → Default)
├── model-requirements.ts  # Agent/category model fallback chains (162 lines)
├── model-availability.ts  # Provider model fetching & fuzzy matching (154 lines)
├── jsonc-parser.ts        # JSONC parsing with comment support
├── frontmatter.ts         # YAML frontmatter extraction (JSON_SCHEMA only) - 9 imports
├── data-path.ts           # XDG-compliant storage resolution
├── opencode-config-dir.ts # ~/.config/opencode resolution (143 lines) - 9 imports
├── claude-config-dir.ts   # ~/.claude resolution - 9 imports
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
| Utility | Imports | Purpose |
|---------|---------|---------|
| logger.ts | 53 | Background task visibility |
| opencode-config-dir.ts | 9 | Path resolution |
| claude-config-dir.ts | 9 | Path resolution |
| frontmatter.ts | 9 | YAML parsing |
| system-directive.ts | 8 | Message filtering |
| permission-compat.ts | 6 | Tool restrictions |

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

## TERMINAL MULTIPLEXER

**Purpose**: Unified abstraction for tmux and zellij terminal multiplexers.

### Architecture

```typescript
interface Multiplexer {
  type: "tmux" | "zellij"
  capabilities: {
    manualLayout: boolean      // Requires explicit grid algorithm
    persistentLabels: boolean  // Labels survive session restart
  }
  spawnPane(options: SpawnOptions): Promise<PaneHandle>
  closePane(handle: PaneHandle): Promise<void>
  getPanes(): Promise<PaneHandle[]>
  ensureSession(name: string): Promise<void>
  killSession(name: string): Promise<void>
}
```

### Implementations

| Adapter | Capabilities | Notes |
|---------|--------------|-------|
| **TmuxAdapter** | `{ manualLayout: true, persistentLabels: false }` | Wraps existing tmux-utils, requires decision engine for layout |
| **ZellijAdapter** | `{ manualLayout: false, persistentLabels: true }` | Auto-layout, labels set via `-n` flag on spawn |

### Detection & Configuration

**Auto-detection** (priority order):
1. `$TMUX` env var → "tmux"
2. `$ZELLIJ` or `$ZELLIJ_SESSION_NAME` → "zellij"
3. Binary detection (`which tmux` / `which zellij`)
4. Returns `null` if none found

**Configuration**:
```json
{
  "terminal": {
    "provider": "auto" | "tmux" | "zellij",
    "tmux": { "enabled": true, "session_prefix": "omo-" },
    "zellij": { "enabled": true, "session_prefix": "omo-" }
  }
}
```

**Backward compatibility**: Old `tmux` config key still works.

### Usage Pattern

```typescript
import { detectMultiplexer, createMultiplexer } from "./shared/terminal-multiplexer"

// Auto-detect
const type = await detectMultiplexer()  // "tmux" | "zellij" | null

// Create adapter
const adapter = createMultiplexer(type, config)

// Capability-based branching
if (adapter.capabilities.manualLayout) {
  // Use decision engine for tmux
} else {
  // Simple spawn for zellij
}

// Spawn pane
const handle = await adapter.spawnPane({
  label: "my-pane",
  command: "npm run dev",
  direction: "horizontal"
})

// Close pane
await adapter.closePane(handle)
```

### Key Design Principles

- **Label as primary key**: `PaneHandle.label` is user-facing identifier
- **Capability-based behavior**: Check `capabilities` before using features
- **NOT a tmux emulator**: Different multiplexers have different strengths
- **Graceful degradation**: Plugin works without multiplexer

## ANTI-PATTERNS
- **Raw JSON.parse**: Use `jsonc-parser.ts` for comment support
- **Hardcoded Paths**: Use `*-config-dir.ts` or `data-path.ts`
- **console.log**: Use `logger.ts` for background task visibility
- **Unbounded Output**: Use `dynamic-truncator.ts` to prevent overflow
- **Manual Version Check**: Use `opencode-version.ts` for semver safety
- **Direct tmux commands**: Use `terminal-multiplexer` abstraction

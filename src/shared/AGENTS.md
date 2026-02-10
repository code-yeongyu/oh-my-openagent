# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

84 cross-cutting utilities across 6 subdirectories. Import via barrel: `import { log, deepMerge } from "../../shared"`

## STRUCTURE
```
shared/
├── logger.ts                  # File logging (/tmp/oh-my-opencode.log) — 62 imports
├── dynamic-truncator.ts       # Token-aware context window management (201 lines)
├── model-resolver.ts          # 3-step resolution (Override → Fallback → Default)
├── model-availability.ts      # Provider model fetching & fuzzy matching (358 lines)
├── model-requirements.ts      # Agent/category fallback chains (160 lines)
├── model-resolution-pipeline.ts # Pipeline orchestration (175 lines)
├── model-resolution-types.ts  # Resolution request/provenance types
├── model-sanitizer.ts         # Model name sanitization
├── model-name-matcher.ts      # Model name matching (91 lines)
├── model-suggestion-retry.ts  # Suggest models on failure (129 lines)
├── model-cache-availability.ts # Cache availability checking
├── fallback-model-availability.ts # Fallback model logic (67 lines)
├── available-models-fetcher.ts # Fetch models from providers (114 lines)
├── models-json-cache-reader.ts # Read models.json cache
├── provider-models-cache-model-reader.ts # Provider cache reader
├── connected-providers-cache.ts # Provider caching (196 lines)
├── system-directive.ts        # Unified message prefix & types (61 lines) — 11 imports
├── session-utils.ts           # Session cursor, orchestrator detection
├── session-cursor.ts          # Message cursor tracking (85 lines)
├── session-injected-paths.ts  # Injected file path tracking
├── permission-compat.ts       # Tool restriction enforcement (86 lines)
├── agent-tool-restrictions.ts # Tool restriction definitions
├── agent-variant.ts           # Agent variant from config (91 lines)
├── agent-display-names.ts     # Agent display name mapping
├── first-message-variant.ts   # First message variant types
├── opencode-config-dir.ts     # ~/.config/opencode resolution (138 lines)
├── claude-config-dir.ts       # ~/.claude resolution
├── data-path.ts               # XDG-compliant storage (47 lines)
├── jsonc-parser.ts            # JSONC with comment support (66 lines)
├── frontmatter.ts             # YAML frontmatter extraction (31 lines) — 10 imports
├── deep-merge.ts              # Recursive merge (proto-pollution safe, MAX_DEPTH=50)
├── shell-env.ts               # Cross-platform shell environment (111 lines)
├── opencode-version.ts        # Semantic version comparison (74 lines)
├── external-plugin-detector.ts # Plugin conflict detection (137 lines)
├── opencode-server-auth.ts    # Authentication utilities (69 lines)
├── safe-create-hook.ts        # Hook error wrapper (24 lines)
├── pattern-matcher.ts         # Pattern matching (40 lines)
├── file-utils.ts              # File operations (40 lines) — 9 imports
├── file-reference-resolver.ts # File reference resolution (85 lines)
├── snake-case.ts              # Case conversion (44 lines)
├── tool-name.ts               # Tool naming conventions
├── truncate-description.ts    # Description truncation
├── port-utils.ts              # Port management (48 lines)
├── zip-extractor.ts           # ZIP extraction (83 lines)
├── binary-downloader.ts       # Binary download (60 lines)
├── skill-path-resolver.ts     # Skill path resolution
├── hook-disabled.ts           # Hook disable checking
├── config-errors.ts           # Config error types
├── disabled-tools.ts          # Disabled tools tracking
├── record-type-guard.ts       # Record type guard
├── open-code-client-accessors.ts # Client accessor utilities
├── open-code-client-shapes.ts # Client shape types
├── command-executor/          # Shell execution (6 files, 213 lines)
├── git-worktree/              # Git status/diff parsing (8 files, 311 lines)
├── migration/                 # Legacy config migration (5 files, 341 lines)
│   ├── config-migration.ts    # Migration orchestration (126 lines)
│   ├── agent-names.ts         # Agent name mapping (70 lines)
│   ├── hook-names.ts          # Hook name mapping (36 lines)
│   └── model-versions.ts      # Model version migration (49 lines)
└── tmux/                      # Tmux TUI integration (12 files, 427 lines)
    └── tmux-utils/            # Pane spawn, close, replace, layout, health
```

## MOST IMPORTED

| Utility | Imports | Purpose |
|---------|---------|---------|
| logger.ts | 62 | Background task visibility |
| data-path.ts | 11 | XDG storage resolution |
| model-requirements.ts | 11 | Agent fallback chains |
| system-directive.ts | 11 | System message filtering |
| frontmatter.ts | 10 | YAML metadata extraction |
| permission-compat.ts | 9 | Tool restrictions |
| file-utils.ts | 9 | File operations |
| dynamic-truncator.ts | 7 | Token-aware truncation |

## KEY PATTERNS

**3-Step Model Resolution** (Override → Fallback → Default):
```typescript
resolveModelWithFallback({ userModel, fallbackChain, availableModels })
```

**System Directive Filtering**:
```typescript
if (isSystemDirective(message)) return  // Skip system-generated
const directive = createSystemDirective("TODO CONTINUATION")
```

## ANTI-PATTERNS

- **Raw JSON.parse**: Use `jsonc-parser.ts` for comment support
- **Hardcoded paths**: Use `opencode-config-dir.ts` or `data-path.ts`
- **console.log**: Use `logger.ts` for background task visibility
- **Unbounded output**: Use `dynamic-truncator.ts` to prevent overflow
- **Manual version check**: Use `opencode-version.ts` for semver safety

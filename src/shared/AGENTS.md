# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

34 cross-cutting utilities: path resolution, token truncation, config parsing, model resolution, agent display names.

## STRUCTURE

```
shared/
├── logger.ts              # File-based logging
├── permission-compat.ts   # Agent tool restrictions
├── dynamic-truncator.ts   # Token-aware truncation
├── frontmatter.ts         # YAML frontmatter
├── jsonc-parser.ts        # JSON with Comments
├── data-path.ts           # XDG-compliant storage
├── opencode-config-dir.ts # ~/.config/opencode
├── claude-config-dir.ts   # ~/.claude
├── migration.ts           # Legacy config migration
├── opencode-version.ts    # Version comparison
├── external-plugin-detector.ts # OAuth spoofing detection
├── model-requirements.ts  # Agent/Category requirements
├── model-availability.ts  # Models fetch + fuzzy match
├── model-resolver.ts      # 3-step resolution
├── model-sanitizer.ts     # Model ID normalization
├── shell-env.ts           # Cross-platform shell
├── agent-display-names.ts # Agent display name mapping
├── agent-tool-restrictions.ts # Tool restriction helpers
├── agent-variant.ts       # Agent variant detection
├── command-executor.ts    # Subprocess execution
├── config-errors.ts       # Config error types
├── deep-merge.ts          # Deep object merge
├── file-reference-resolver.ts # File path resolution
├── file-utils.ts          # File utilities
├── hook-disabled.ts       # Hook enable/disable check
├── pattern-matcher.ts     # Glob pattern matching
├── session-cursor.ts      # Session cursor tracking
├── snake-case.ts          # String case conversion
├── system-directive.ts    # System prompt helpers
├── tool-name.ts           # Tool name constants
├── zip-extractor.ts       # ZIP file extraction
├── index.ts               # Barrel export
└── *.test.ts              # Colocated tests
```

## WHEN TO USE

| Task | Utility |
|------|---------|
| Debug logging | `log(message, data)` |
| Limit context | `dynamicTruncate(ctx, sessionId, output)` |
| Parse frontmatter | `parseFrontmatter(content)` |
| Load JSONC | `parseJsonc(text)` or `readJsoncFile(path)` |
| Restrict tools | `createAgentToolAllowlist(tools)` |
| Resolve paths | `getOpenCodeConfigDir()` |
| Compare versions | `isOpenCodeVersionAtLeast("1.1.0")` |
| Resolve model | `resolveModelWithFallback()` |
| Agent display name | `getAgentDisplayName(agentName)` |

## PATTERNS

```typescript
// Token-aware truncation
const { result } = await dynamicTruncate(ctx, sessionID, buffer)

// JSONC config
const settings = readJsoncFile<Settings>(configPath)

// Version-gated
if (isOpenCodeVersionAtLeast("1.1.0")) { /* ... */ }

// Model resolution
const model = await resolveModelWithFallback(client, requirements, override)
```

## ANTI-PATTERNS

- **Raw JSON.parse**: Use `jsonc-parser.ts`
- **Hardcoded paths**: Use `*-config-dir.ts`
- **console.log**: Use `logger.ts` for background
- **Unbounded output**: Use `dynamic-truncator.ts`

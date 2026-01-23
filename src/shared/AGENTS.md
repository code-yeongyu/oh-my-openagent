# SHARED UTILITIES KNOWLEDGE BASE

## OVERVIEW

50 cross-cutting utilities: path resolution, token truncation, config parsing, model resolution.

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
├── env-expander.ts        # ${VAR} expansion
├── model-requirements.ts  # Agent/Category requirements
├── model-availability.ts  # Models fetch + fuzzy match
├── model-resolver.ts      # 3-step resolution
├── shell-env.ts           # Cross-platform shell
├── prompt-parts-helper.ts # Prompt manipulation
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

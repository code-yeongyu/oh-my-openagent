# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. 5 commands with Commander.js + @clack/prompts TUI.

**Commands**: install (interactive setup), doctor (14 health checks), run (session launcher), get-local-version, mcp-oauth

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry (5 commands)
├── install.ts            # Interactive TUI (542 lines)
├── config-manager.ts     # JSONC parsing (667 lines)
├── model-fallback.ts     # Model fallback configuration
├── types.ts              # InstallArgs, InstallConfig
├── doctor/
│   ├── index.ts          # Doctor entry
│   ├── runner.ts         # Check orchestration
│   ├── formatter.ts      # Colored output
│   ├── constants.ts      # Check IDs, symbols
│   ├── types.ts          # CheckResult, CheckDefinition
│   └── checks/           # 14 checks, 23 files
│       ├── version.ts    # OpenCode + plugin version
│       ├── config.ts     # JSONC validity, Zod
│       ├── auth.ts       # Anthropic, OpenAI, Google
│       ├── dependencies.ts # AST-Grep, Comment Checker
│       ├── lsp.ts        # LSP connectivity
│       ├── mcp.ts        # MCP validation
│       ├── model-resolution.ts # Model resolution check (323 lines)
│       └── gh.ts         # GitHub CLI
├── run/
│   ├── index.ts          # Session launcher
│   └── events.ts         # CLI run events (325 lines)
├── mcp-oauth/
│   └── index.ts          # MCP OAuth flow
└── get-local-version/
    └── index.ts          # Version detection
```

## COMMANDS

| Command | Purpose |
|---------|---------|
| `install` | Interactive setup with provider selection |
| `doctor` | 14 health checks for diagnostics |
| `run` | Launch session with todo enforcement |
| `get-local-version` | Version detection and update check |
| `mcp-oauth` | MCP OAuth authentication flow |

## DOCTOR CATEGORIES (14 Checks)

| Category | Checks |
|----------|--------|
| installation | opencode, plugin |
| configuration | config validity, Zod, model-resolution |
| authentication | anthropic, openai, google |
| dependencies | ast-grep, comment-checker, gh-cli |
| tools | LSP, MCP |
| updates | version comparison |

## HOW TO ADD CHECK

1. Create `src/cli/doctor/checks/my-check.ts`
2. Export `getXXXCheckDefinition()` factory returning `CheckDefinition`
3. Add to `getAllCheckDefinitions()` in `checks/index.ts`

## TUI FRAMEWORK

- **@clack/prompts**: `select()`, `spinner()`, `intro()`, `outro()`
- **picocolors**: Terminal colors for status and headers
- **Symbols**: ✓ (pass), ✗ (fail), ⚠ (warn), ℹ (info)

## ANTI-PATTERNS

- **Blocking in non-TTY**: Always check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()` from shared utils
- **Silent failures**: Return `warn` or `fail` in doctor instead of throwing
- **Hardcoded paths**: Use `getOpenCodeConfigPaths()` from `config-manager.ts`

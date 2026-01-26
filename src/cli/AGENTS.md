# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. Interactive installer, doctor diagnostics. Commander.js + @clack/prompts.

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry (4 commands)
├── install.ts            # Interactive TUI (520 lines)
├── config-manager.ts     # JSONC parsing (664 lines)
├── types.ts              # InstallArgs, InstallConfig
├── model-fallback.ts     # Model fallback configuration
├── doctor/
│   ├── index.ts          # Doctor entry
│   ├── runner.ts         # Check orchestration
│   ├── formatter.ts      # Colored output
│   ├── constants.ts      # Check IDs, symbols
│   ├── types.ts          # CheckResult, CheckDefinition (114 lines)
│   └── checks/           # 14 checks, 21 files
│       ├── version.ts    # OpenCode + plugin version
│       ├── config.ts     # JSONC validity, Zod
│       ├── auth.ts       # Anthropic, OpenAI, Google
│       ├── dependencies.ts # AST-Grep, Comment Checker
│       ├── lsp.ts        # LSP connectivity
│       ├── mcp.ts        # MCP validation
│       ├── model-resolution.ts # Model resolution check
│       └── gh.ts         # GitHub CLI
├── run/
│   └── index.ts          # Session launcher
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

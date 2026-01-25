# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. Interactive installer, doctor diagnostics. Commander.js + @clack/prompts.

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry
├── install.ts            # Interactive TUI (520 lines)
├── config-manager.ts     # JSONC parsing (664 lines)
├── types.ts              # InstallArgs, InstallConfig
├── model-fallback.ts     # Model fallback configuration
├── doctor/
│   ├── index.ts          # Doctor entry
│   ├── runner.ts         # Check orchestration
│   ├── formatter.ts      # Colored output
│   ├── constants.ts      # Check IDs, symbols
│   ├── types.ts          # CheckResult, CheckDefinition
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
| `install` | Interactive setup |
| `doctor` | 14 health checks |
| `run` | Launch session |
| `get-local-version` | Version check |

## DOCTOR CATEGORIES

| Category | Checks |
|----------|--------|
| installation | opencode, plugin |
| configuration | config validity, Zod |
| authentication | anthropic, openai, google |
| dependencies | ast-grep, comment-checker |
| tools | LSP, MCP |
| updates | version comparison |

## HOW TO ADD CHECK

1. Create `src/cli/doctor/checks/my-check.ts`
2. Export from `checks/index.ts`
3. Add to `getAllCheckDefinitions()`

## TUI FRAMEWORK

- **@clack/prompts**: `select()`, `spinner()`, `intro()`
- **picocolors**: Terminal colors
- **Symbols**: ✓ (pass), ✗ (fail), ⚠ (warn)

## ANTI-PATTERNS

- **Blocking in non-TTY**: Check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()`
- **Silent failures**: Return warn/fail in doctor

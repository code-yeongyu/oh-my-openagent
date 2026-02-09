# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. 107 CLI utilities with Commander.js + @clack/prompts TUI.

**Commands**: install (interactive setup), doctor (14 health checks), run (session launcher), get-local-version, mcp-oauth

## STRUCTURE

```
cli/
├── index.ts                 # Commander.js entry (5 commands)
├── install.ts               # TTY routing to TUI or CLI installer
├── cli-installer.ts         # Non-interactive installer (164 lines)
├── tui-installer.ts         # Interactive TUI with @clack/prompts (140 lines)
├── config-manager/          # Config management utilities (17 files)
├── model-fallback.ts        # Model fallback configuration
├── model-fallback.test.ts   # Fallback tests (523 lines)
├── doctor/
│   ├── runner.ts            # Check orchestration
│   ├── formatter.ts         # Colored output
│   └── checks/              # 29 files with individual checks
├── run/                     # Session launcher (24 files)
│   ├── events.ts            # CLI run events
│   └── runner.ts            # Run orchestration
├── mcp-oauth/               # OAuth flow
└── get-local-version/       # Version detection
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
- **Symbols**: check (pass), cross (fail), warning (warn), info (info)

## ANTI-PATTERNS

- **Blocking in non-TTY**: Always check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()` from shared utils
- **Silent failures**: Return `warn` or `fail` in doctor instead of throwing
- **Hardcoded paths**: Use `getOpenCodeConfigPaths()` from `config-manager`

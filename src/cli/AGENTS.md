# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. 107+ files with Commander.js + @clack/prompts TUI.

**Commands**: install, run, doctor, get-local-version, mcp-oauth

## STRUCTURE
```
cli/
├── index.ts                 # Entry point (5 lines)
├── cli-program.ts           # Commander.js program (150+ lines, 5 commands)
├── install.ts               # TTY routing (TUI or CLI installer)
├── cli-installer.ts         # Non-interactive installer (164 lines)
├── tui-installer.ts         # Interactive TUI with @clack/prompts (140 lines)
├── config-manager/          # 17 config utilities
│   ├── add-plugin-to-opencode-config.ts  # Plugin registration
│   ├── add-provider-config.ts            # Provider setup
│   ├── detect-current-config.ts          # Project vs user config
│   ├── write-omo-config.ts               # JSONC writing
│   └── ...
├── doctor/                  # 14 health checks
│   ├── runner.ts            # Check orchestration
│   ├── formatter.ts         # Colored output
│   └── checks/              # 29 files: auth, config, dependencies, gh, lsp, mcp, opencode, plugin, version, model-resolution (6 sub-checks)
├── run/                     # Session launcher (24 files)
│   ├── runner.ts            # Run orchestration (126 lines)
│   ├── agent-resolver.ts    # Agent selection: flag → env → config → fallback
│   ├── session-resolver.ts  # Session creation or resume
│   ├── event-handlers.ts    # Event processing (125 lines)
│   ├── completion.ts        # Completion detection
│   └── poll-for-completion.ts # Polling with timeout
├── mcp-oauth/               # OAuth token management (login, logout, status)
├── get-local-version/       # Version detection + update check
├── model-fallback.ts        # Model fallback configuration
└── provider-availability.ts # Provider availability checks
```

## COMMANDS

| Command | Purpose | Key Logic |
|---------|---------|-----------|
| `install` | Interactive setup | Provider selection → config generation → plugin registration |
| `run` | Session launcher | Agent: flag → env → config → Sisyphus. Enforces todo completion. |
| `doctor` | 14 health checks | installation, config, auth, deps, tools, updates |
| `get-local-version` | Version check | Detects installed, compares with npm latest |
| `mcp-oauth` | OAuth tokens | login (PKCE flow), logout, status |

## DOCTOR CHECK CATEGORIES

| Category | Checks |
|----------|--------|
| installation | opencode, plugin |
| configuration | config validity, Zod, model-resolution (6 sub-checks) |
| authentication | anthropic, openai, google |
| dependencies | ast-grep, comment-checker, gh-cli |
| tools | LSP, MCP, MCP-OAuth |
| updates | version comparison |

## HOW TO ADD CHECK

1. Create `src/cli/doctor/checks/my-check.ts`
2. Export `getXXXCheckDefinition()` returning `CheckDefinition`
3. Add to `getAllCheckDefinitions()` in `checks/index.ts`

## ANTI-PATTERNS

- **Blocking in non-TTY**: Check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()` from shared
- **Silent failures**: Return `warn` or `fail` in doctor, don't throw
- **Hardcoded paths**: Use `getOpenCodeConfigPaths()` from config-manager

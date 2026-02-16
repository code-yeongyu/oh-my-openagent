# CLI KNOWLEDGE BASE

## OVERVIEW

CLI entry: `bunx oh-my-opencode`. 107+ files with Commander.js + @clack/prompts TUI. 5 commands: install, run, doctor, get-local-version, mcp-oauth.

## STRUCTURE
```
cli/
├── index.ts                 # Entry point (5 lines)
├── cli-program.ts           # Commander.js program (150+ lines, 5 commands)
├── install.ts               # TTY routing (TUI or CLI installer)
├── cli-installer.ts         # Non-interactive installer (164 lines)
├── tui-installer.ts         # Interactive TUI with @clack/prompts (140 lines)
├── config-manager/          # 20 config utilities
│   ├── add-plugin-to-opencode-config.ts  # Plugin registration
│   ├── add-provider-config.ts            # Provider setup (Google/Antigravity)
│   ├── detect-current-config.ts          # Installed providers detection
│   ├── write-omo-config.ts               # JSONC writing
│   ├── generate-omo-config.ts            # Config generation
│   ├── jsonc-provider-editor.ts          # JSONC editing
│   └── ...                               # 14 more utilities
├── doctor/                  # 4 check categories, 21 check files
│   ├── runner.ts            # Parallel check execution + result aggregation
│   ├── formatter.ts         # Colored output (default/status/verbose/JSON)
│   └── checks/              # system (4), config (1), tools (4), models (6 sub-checks)
├── run/                     # Session launcher (24 files)
│   ├── runner.ts            # Run orchestration (126 lines)
│   ├── agent-resolver.ts    # Agent: flag → env → config → Sisyphus
│   ├── session-resolver.ts  # Session create or resume with retries
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
| `doctor` | 4-category health checks | system, config, tools, models (6 sub-checks) |
| `get-local-version` | Version check | Detects installed, compares with npm latest |
| `mcp-oauth` | OAuth tokens | login (PKCE flow), logout, status |

## RUN SESSION LIFECYCLE

1. Load config, resolve agent (CLI > env > config > Sisyphus)
2. Create server connection (port/attach), setup cleanup/signal handlers
3. Resolve session (create new or resume with retries)
4. Send prompt, start event processing, poll for completion
5. Execute on-complete hook, output JSON if requested, cleanup

## HOW TO ADD CHECK

1. Create `src/cli/doctor/checks/my-check.ts`
2. Export `getXXXCheckDefinition()` returning `CheckDefinition`
3. Add to `getAllCheckDefinitions()` in `checks/index.ts`

## ANTI-PATTERNS

- **Blocking in non-TTY**: Check `process.stdout.isTTY`
- **Direct JSON.parse**: Use `parseJsonc()` from shared
- **Silent failures**: Return `warn` or `fail` in doctor, don't throw
- **Hardcoded paths**: Use `getOpenCodeConfigPaths()` from config-manager

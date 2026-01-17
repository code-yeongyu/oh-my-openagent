# CLI KNOWLEDGE BASE

## OVERVIEW
CLI for oh-my-opencode: interactive installer, health diagnostics (doctor), runtime launcher. Entry: `bunx oh-my-opencode`.

## STRUCTURE
```
cli/
├── index.ts              # Commander.js entry, subcommand routing
├── install.ts            # Interactive TUI installer (462 lines)
├── config-manager.ts     # JSONC parsing, env detection (730 lines)
├── types.ts              # CLI-specific types
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   ├── runner.ts         # Health check orchestration
│   ├── constants.ts      # Check categories
│   ├── types.ts          # Check result interfaces
│   └── checks/           # 10 check modules (14 individual checks)
├── get-local-version/    # Version detection
└── run/                  # OpenCode session launcher
    ├── completion.ts     # Completion logic
    └── events.ts         # Event handling
```

## CLI COMMANDS
| Command | Purpose |
|---------|---------|
| `install` | Interactive setup wizard with subscription detection |
| `doctor` | Environment health checks (LSP, Auth, Config, Deps) |
| `run` | Launch OpenCode session with todo/background completion enforcement |
| `get-local-version` | Detect and return local plugin version & update status |

## DOCTOR CHECKS
14 checks in `doctor/checks/`:
- `version.ts`: OpenCode >= 1.0.150 & plugin update status
- `config.ts`: Plugin registration & JSONC validity
- `dependencies.ts`: AST-Grep (CLI/NAPI), Comment Checker
- `auth.ts`: Anthropic, OpenAI, Google (Antigravity)
- `lsp.ts`, `mcp.ts`: Tool connectivity checks
- `gh.ts`: GitHub CLI availability

## CONFIG-MANAGER
- **JSONC**: Supports comments and trailing commas via `parseJsonc`
- **Multi-source**: Merges User (`~/.config/opencode/`) + Project (`.opencode/`)
- **Validation**: Strict Zod schema with error aggregation for `doctor`
- **Env**: Detects `OPENCODE_CONFIG_DIR` for profile isolation

## HOW TO ADD CHECK
1. Create `src/cli/doctor/checks/my-check.ts` returning `DoctorCheck`
2. Export from `checks/index.ts` and add to `getAllCheckDefinitions()`
3. Use `CheckContext` for shared utilities (LSP, Auth)

## ANTI-PATTERNS
- Blocking prompts in non-TTY (check `process.stdout.isTTY`)
- Direct `JSON.parse` (breaks JSONC compatibility)
- Silent failures (always return `warn` or `fail` in `doctor`)
- Environment-specific hardcoding (use `ConfigManager`)

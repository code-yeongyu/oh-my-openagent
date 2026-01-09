# CLI KNOWLEDGE BASE

## OVERVIEW

CLI for oh-my-opencode: interactive installer, health diagnostics (doctor), runtime launcher. Entry: `bunx oh-my-opencode`.

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry, subcommand routing
├── install.ts            # Interactive TUI installer (436 lines)
├── config-manager.ts     # JSONC parsing, env detection (725 lines)
├── types.ts              # CLI-specific types
├── commands/             # CLI subcommands
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   ├── runner.ts         # Health check orchestration
│   ├── constants.ts      # Check categories
│   ├── types.ts          # Check result interfaces
│   └── checks/           # 17+ individual checks (auth, config, dependencies, gh, lsp, mcp, opencode, plugin, version)
├── get-local-version/    # Version detection
└── run/                  # OpenCode session launcher
    ├── completion.ts     # Completion logic
    └── events.ts         # Event handling
```

## CLI COMMANDS

| Command | Purpose |
|---------|---------|
| `install` | Interactive setup wizard |
| `doctor` | Environment health checks |
| `run` | Launch OpenCode session |

## DOCTOR CHECKS

17+ checks in `doctor/checks/`:
- version.ts (OpenCode >= 1.0.150)
- config.ts (plugin registered)
- bun.ts, node.ts, git.ts
- anthropic-auth.ts, openai-auth.ts, google-auth.ts
- lsp-*.ts, mcp-*.ts

## CONFIG-MANAGER (669 lines)

- JSONC support (comments, trailing commas)
- Multi-source: User (~/.config/opencode/) + Project (.opencode/)
- Zod validation
- Legacy format migration
- Error aggregation for doctor

## HOW TO ADD CHECK

1. Create `src/cli/doctor/checks/my-check.ts`:
   ```typescript
   export const myCheck: DoctorCheck = {
     name: "my-check",
     category: "environment",
     check: async () => {
       return { status: "pass" | "warn" | "fail", message: "..." }
     }
   }
   ```
2. Add to `src/cli/doctor/checks/index.ts`

## ANTI-PATTERNS

- Blocking prompts in non-TTY (check `process.stdout.isTTY`)
- Hardcoded paths (use shared utilities)
- JSON.parse for user files (use parseJsonc)
- Silent failures in doctor checks

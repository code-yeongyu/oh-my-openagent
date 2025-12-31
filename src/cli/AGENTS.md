# CLI KNOWLEDGE BASE

## OVERVIEW

Command-line interface for oh-my-opencode. Interactive installer, health diagnostics (doctor), and runtime commands. Entry point: `bunx oh-my-opencode`.

## STRUCTURE

```
cli/
├── index.ts              # Commander.js entry point, subcommand routing
├── install.ts            # Interactive TUI installer
├── config-manager.ts     # Config detection, parsing, merging (669 lines)
├── types.ts              # CLI-specific types
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   ├── constants.ts      # Check categories, descriptions
│   ├── types.ts          # Check result interfaces
│   └── checks/           # 17 individual health checks
├── get-local-version/    # Version detection utility
│   ├── index.ts
│   └── formatter.ts
└── run/                  # OpenCode session launcher
    ├── index.ts
    └── completion.test.ts
```

## CLI COMMANDS

| Command | Purpose | Key File |
|---------|---------|----------|
| `install` | Interactive setup wizard | `install.ts` |
| `doctor` | Environment health checks | `doctor/index.ts` |
| `run` | Launch OpenCode session | `run/index.ts` |

## DOCTOR CHECKS

17 checks in `doctor/checks/`:

| Check | Validates |
|-------|-----------|
| `version.ts` | OpenCode version >= 1.0.150 |
| `config.ts` | Plugin registered in opencode.json |
| `bun.ts` | Bun runtime available |
| `node.ts` | Node.js version compatibility |
| `git.ts` | Git installed |
| `anthropic-auth.ts` | Claude authentication |
| `openai-auth.ts` | OpenAI authentication |
| `google-auth.ts` | Google/Gemini authentication |
| `lsp-*.ts` | Language server availability |
| `mcp-*.ts` | MCP server connectivity |

## INSTALLATION FLOW

1. **Detection**: Find existing `opencode.json` / `opencode.jsonc`
2. **TUI Prompts**: Claude subscription? ChatGPT? Gemini?
3. **Config Generation**: Build `oh-my-opencode.json` based on answers
4. **Plugin Registration**: Add to `plugin` array in opencode.json
5. **Auth Guidance**: Instructions for `opencode auth login`

## CONFIG-MANAGER

The largest file (669 lines) handles:

- **JSONC support**: Parses comments and trailing commas
- **Multi-source detection**: User (~/.config/opencode/) + Project (.opencode/)
- **Schema validation**: Zod-based config validation
- **Migration**: Handles legacy config formats
- **Error collection**: Aggregates parsing errors for doctor

## HOW TO ADD A DOCTOR CHECK

1. Create `src/cli/doctor/checks/my-check.ts`:
   ```typescript
   import type { DoctorCheck } from "../types"
   
   export const myCheck: DoctorCheck = {
     name: "my-check",
     category: "environment",
     check: async () => {
       // Return { status: "pass" | "warn" | "fail", message: string }
     }
   }
   ```
2. Add to `src/cli/doctor/checks/index.ts`
3. Update `constants.ts` if new category

## ANTI-PATTERNS (CLI)

- **Blocking prompts in non-TTY**: Check `process.stdout.isTTY` before TUI
- **Hardcoded paths**: Use shared utilities for config paths
- **Ignoring JSONC**: User configs may have comments
- **Silent failures**: Doctor checks must return clear status/message

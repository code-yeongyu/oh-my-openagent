# src/cli/ — CLI: install, run, doctor, config, mcp (oauth), refresh-model-capabilities, get-local-version, version, boulder, worktree-sweep, cleanup, ulw-loop

**Generated:** 2026-07-03

## OVERVIEW

Commander.js CLI with 12 commands (`sparkshell` removed 2026-07). Entry: `index.ts` → `runCli()` in `cli-program.ts`; runtime commands registered via `configureRuntimeCommands()` in `runtime-commands.ts`.

## COMMANDS

| Command | Purpose | Key Logic |
|---------|---------|-----------|
| `install` | Interactive/non-interactive setup | Provider selection → config gen → plugin registration |
| `run <message>` | Non-interactive session launcher | Agent resolution (flag → env → config → Sisyphus) |
| `doctor` | 4-category health checks | System, Config, Tools, Models |
| `config migrate` | Migrate legacy OMO config into `~/.omo/omo.jsonc` | `config-migrate.ts` over `runOpenCodeStartupMigration`; `--dry-run` prints transform + backup move plan, `--json` machine-readable |
| `get-local-version` | Version detection | Installed vs npm latest |
| `version` | Print plugin version | Trivial 2-line subcommand |
| `mcp` | MCP management; nested `oauth` group | `mcp oauth login <server-name>` (PKCE), `logout`, `status` |
| `refresh-model-capabilities` | Refresh models.dev cache | Model capabilities refresh |
| `boulder` | Boulder state inspector | Format work-state + tasks from `.omo/boulder-state/` |
| `worktree-sweep` | Sweep stale git worktrees | `worktree-sweep/`: classify + delete merged/stale worktrees; excludes externally-owned roots (`~/.codex/worktrees`, `~/.codex-gui-cli-remote/worktrees`) by default |
| `cleanup` (alias `uninstall`) | Remove Codex Light state | Clean managed Codex cache/marketplace + repair project-local legacy Codex artifacts |
| `ulw-loop` | Codex ulw-loop CLI | Run the Codex LazyCodex ulw-loop CLI |

`install` accepts `--platform=opencode|codex|both` (default `opencode`). `codex`/`both` route through `install-codex/` to install the Codex CLI Light edition (also `npx lazycodex-ai install`). See `packages/omo-codex/AGENTS.md`. A `senpi` choice appears (hidden from help) only when `SENPI_PLATFORM_ENV_FLAG=1` is set from a source checkout; it routes through `install-senpi/` (re-export of `@oh-my-opencode/omo-senpi/install`). `install-ast-grep-sg.ts` provisions the `sg` binary at install time.

## STRUCTURE

```
cli/
├── index.ts                     # Entry point → runCli()
├── cli-program.ts               # Commander.js program (10 commands)
├── install.ts                   # Routes to TUI or CLI installer
├── cli-installer.ts             # Non-interactive (console output)
├── tui-installer.ts             # Interactive (@clack/prompts)
├── model-fallback.ts            # Model config gen by provider availability
├── provider-availability.ts     # Provider detection
├── fallback-chain-resolution.ts # Fallback chain logic
├── config-manager/              # 27 config utilities
│   ├── plugin registration, provider config
│   ├── JSONC operations, auth plugins
│   └── npm dist-tags, binary detection
├── doctor/
│   ├── runner.ts                # Parallel check execution
│   ├── formatter.ts             # Output formatting
│   └── checks/                  # 25 check files (8 registered + 3 Codex-only) — see [doctor/AGENTS.md](doctor/AGENTS.md)
├── run/                         # Session launcher
│   ├── runner.ts                # Main orchestration
│   ├── agent-resolver.ts        # Flag → env → config → Sisyphus
│   ├── session-resolver.ts      # Create/resume sessions
│   ├── event-handlers.ts        # Event processing
│   └── poll-for-completion.ts   # Wait for todos/background tasks
├── worktree-sweep/               # Stale git worktree classification + sweep
└── mcp-oauth/                   # OAuth token management
```

## MODEL FALLBACK SYSTEM

No single global priority. CLI install-time resolution uses per-agent fallback chains from `model-fallback-requirements.ts`.

Common patterns: Claude/OpenAI/Gemini are preferred when an agent chain includes them, `librarian` follows its fallback chain before GLM providers, `sisyphus` falls back through Kimi then GLM-5, and `hephaestus` requires OpenAI-compatible providers.

## DOCTOR CHECKS

| Category | Validates |
|----------|-----------|
| **System** | Binary found, version >=1.0.150, plugin registered, version match |
| **Config** | JSONC validity, Zod schema, model override syntax |
| **Tools** | AST-Grep, comment-checker, LSP servers, GH CLI, MCP servers |
| **Models** | Cache exists, model resolution, agent/category overrides, availability |

## HOW TO ADD A DOCTOR CHECK

1. Create `src/cli/doctor/checks/{name}.ts`
2. Export check function matching `DoctorCheck` interface
3. Register in `checks/index.ts`

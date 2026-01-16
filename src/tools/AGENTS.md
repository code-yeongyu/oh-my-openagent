# TOOLS KNOWLEDGE BASE

## OVERVIEW
Custom tools extending agent capabilities: LSP (3 tools), AST-aware search/replace, background tasks, and multimodal analysis.

## STRUCTURE
```
tools/
├── ast-grep/           # AST-aware search/replace (25 languages)
│   ├── cli.ts          # @ast-grep/cli fallback
│   └── napi.ts         # @ast-grep/napi native binding (preferred)
├── background-task/    # Async agent task management
├── call-omo-agent/     # Spawn explore/librarian agents
├── glob/               # File pattern matching (timeout-safe)
├── grep/               # Content search (timeout-safe)
├── interactive-bash/   # Tmux session management
├── look-at/            # Multimodal analysis (PDF, images)
├── lsp/                # IDE-like code intelligence
│   ├── client.ts       # LSP connection lifecycle (632 lines)
│   ├── tools.ts        # Tool implementations
│   └── config.ts, types.ts, utils.ts
├── session-manager/    # OpenCode session history management
├── sisyphus-task/      # Category-based delegation (667 lines)
├── skill/              # Skill loading/execution
├── skill-mcp/          # Skill-embedded MCP invocation
├── slashcommand/       # Slash command execution
└── index.ts            # builtinTools export (75 lines)
```

## TOOL CATEGORIES
| Category | Tools | Purpose |
|----------|-------|---------|
| LSP | lsp_diagnostics, lsp_prepare_rename, lsp_rename | IDE-grade code intelligence (3 tools) |
| AST | ast_grep_search, ast_grep_replace | Structural pattern matching/rewriting |
| Search | grep, glob | Timeout-safe file and content search |
| Session | session_list, session_read, session_search, session_info | History navigation and retrieval |
| Background | sisyphus_task, background_output, background_cancel | Parallel agent orchestration |
| UI/Terminal | look_at, interactive_bash | Visual analysis and tmux control |
| Execution | slashcommand, skill, skill_mcp | Command and skill-based extensibility |

## HOW TO ADD A TOOL
1. Create directory `src/tools/my-tool/`.
2. Implement `tools.ts` (factory), `types.ts`, and `constants.ts`.
3. Export via `index.ts` and register in `src/tools/index.ts`.

## LSP SPECIFICS
- **Lifecycle**: Lazy initialization on first call; auto-shutdown on idle.
- **Config**: Merges `opencode.json` and `oh-my-opencode.json`.
- **Capability**: Supports full LSP spec including `rename` and `prepareRename`.

## AST-GREP SPECIFICS
- **Precision**: Uses tree-sitter for structural matching (avoids regex pitfalls).
- **Binding**: Uses `@ast-grep/napi` for performance; ensure patterns are valid AST nodes.
- **Variables**: Supports `$VAR` and `$$$` meta-variables for capture.

## ANTI-PATTERNS
- **Sync Ops**: Never use synchronous file I/O; blocking the main thread kills responsiveness.
- **No Timeouts**: Always wrap external CLI/LSP calls in timeouts (default 60s).
- **Direct Subprocess**: Avoid raw `spawn` for ast-grep; use NAPI binding.
- **Manual Pathing**: Use `shared/utils` for path normalization across platforms.

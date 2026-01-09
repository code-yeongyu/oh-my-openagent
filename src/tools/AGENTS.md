# TOOLS KNOWLEDGE BASE

## OVERVIEW

Custom tools extending agent capabilities: LSP integration (11 tools), AST-aware code search/replace, file operations with timeouts, background task management.

## STRUCTURE

```
tools/
├── ast-grep/           # AST-aware code search/replace (25 languages)
│   ├── cli.ts          # @ast-grep/cli subprocess
│   ├── napi.ts         # @ast-grep/napi native binding (preferred)
│   ├── constants.ts, types.ts, tools.ts, utils.ts
├── background-task/    # Async agent task management
├── call-omo-agent/     # Spawn explore/librarian agents
├── glob/               # File pattern matching (timeout-safe)
├── grep/               # Content search (timeout-safe)
├── interactive-bash/   # Tmux session management
├── look-at/            # Multimodal analysis (PDF, images)
├── lsp/                # 11 LSP tools
│   ├── client.ts       # LSP connection lifecycle (612 lines)
│   ├── utils.ts        # LSP utilities (461 lines)
│   ├── config.ts       # Server configurations
│   ├── tools.ts        # Tool implementations (405 lines)
│   └── types.ts
├── session-manager/    # OpenCode session file management
│   ├── constants.ts    # Storage paths, descriptions
│   ├── types.ts        # Session data interfaces
│   ├── storage.ts      # File I/O operations
│   ├── utils.ts        # Formatting, filtering
│   └── tools.ts        # Tool implementations
├── sisyphus-task/      # Category-based task delegation (493 lines)
├── skill/              # Skill loading and execution
├── skill-mcp/          # Skill-embedded MCP invocation
├── slashcommand/       # Slash command execution
└── index.ts            # builtinTools export
```

## TOOL CATEGORIES

| Category | Tools | Purpose |
|----------|-------|---------|
| LSP | lsp_hover, lsp_goto_definition, lsp_find_references, lsp_document_symbols, lsp_workspace_symbols, lsp_diagnostics, lsp_servers, lsp_prepare_rename, lsp_rename, lsp_code_actions, lsp_code_action_resolve | IDE-like code intelligence |
| AST | ast_grep_search, ast_grep_replace | Pattern-based code search/replace |
| File Search | grep, glob | Content and file pattern matching |
| Session | session_list, session_read, session_search, session_info | OpenCode session file management |
| Background | sisyphus_task, background_output, background_cancel | Async agent orchestration |
| Multimodal | look_at | PDF/image analysis via Gemini |
| Terminal | interactive_bash | Tmux session control |
| Commands | slashcommand | Execute slash commands |
| Skills | skill, skill_mcp | Load skills, invoke skill-embedded MCPs |
| Agents | call_omo_agent | Spawn explore/librarian |

## HOW TO ADD A TOOL

1. Create directory: `src/tools/my-tool/`
2. Create files:
   - `constants.ts`: `TOOL_NAME`, `TOOL_DESCRIPTION`
   - `types.ts`: Parameter/result interfaces
   - `tools.ts`: Tool implementation (returns OpenCode tool object)
   - `index.ts`: Barrel export
   - `utils.ts`: Helpers (optional)
3. Add to `builtinTools` in `src/tools/index.ts`

## LSP SPECIFICS

- **Client lifecycle**: Lazy init on first use, auto-shutdown on idle
- **Config priority**: opencode.json > oh-my-opencode.json > defaults
- **Supported servers**: typescript-language-server, pylsp, gopls, rust-analyzer, etc.
- **Custom servers**: Add via `lsp` config in oh-my-opencode.json

## AST-GREP SPECIFICS

- **Meta-variables**: `$VAR` (single node), `$$$` (multiple nodes)
- **Languages**: 25 supported (typescript, tsx, python, rust, go, etc.)
- **Binding**: Prefers @ast-grep/napi (native), falls back to @ast-grep/cli
- **Pattern must be valid AST**: `export async function $NAME($$$) { $$$ }` not fragments

## ANTI-PATTERNS (TOOLS)

- **No timeout**: Always use timeout for file operations (default 60s)
- **Blocking main thread**: Use async/await, never sync file ops
- **Ignoring LSP errors**: Gracefully handle server not found/crashed
- **Raw subprocess for ast-grep**: Prefer napi binding for performance

# TOOLS KNOWLEDGE BASE

## OVERVIEW

20+ tools: LSP (6), AST-Grep (2), Search (2), Session (4), Agent delegation (4), System (2), Skill (3).

## STRUCTURE

```
tools/
├── [tool-name]/
│   ├── index.ts      # Barrel export
│   ├── tools.ts      # ToolDefinition
│   ├── types.ts      # Zod schemas
│   └── constants.ts  # Fixed values
├── lsp/              # 6 tools: definition, references, symbols, diagnostics, rename
├── ast-grep/         # 2 tools: search, replace (25 languages)
├── delegate-task/    # Category-based routing (1039 lines)
├── session-manager/  # 4 tools: list, read, search, info
├── grep/             # Custom grep with timeout
├── glob/             # 60s timeout, 100 file limit
├── interactive-bash/ # Tmux session management
├── look-at/          # Multimodal PDF/image
├── skill/            # Skill execution
├── skill-mcp/        # Skill MCP operations
├── slashcommand/     # Slash command dispatch
├── call-omo-agent/   # Direct agent invocation
└── background-task/  # background_output, background_cancel (513 lines)
```

## TOOL CATEGORIES

| Category | Tools | Purpose |
|----------|-------|---------|
| LSP | lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_diagnostics, lsp_prepare_rename, lsp_rename | Semantic code intelligence |
| Search | ast_grep_search, ast_grep_replace, grep, glob | Pattern discovery |
| Session | session_list, session_read, session_search, session_info | History navigation |
| Agent | delegate_task, call_omo_agent, background_output, background_cancel | Task orchestration |
| System | interactive_bash, look_at | CLI, multimodal |
| Skill | skill, skill_mcp, slashcommand | Skill execution |

## HOW TO ADD

1. Create `src/tools/[name]/` with standard files
2. Use `tool()` from `@opencode-ai/plugin/tool`
3. Export from `src/tools/index.ts`
4. Add to `builtinTools` object

## LSP SPECIFICS

- **Client**: `client.ts` manages stdio, JSON-RPC (596 lines)
- **Singleton**: `LSPServerManager` with ref counting
- **Capabilities**: definition, references, symbols, diagnostics, rename

## AST-GREP SPECIFICS

- **Engine**: `@ast-grep/napi` for 25+ languages
- **Patterns**: `$VAR` (single), `$$$` (multiple)

## ANTI-PATTERNS

- **Sequential bash**: Use `&&` or delegation
- **Raw file ops**: Never mkdir/touch in tool logic
- **Sleep**: Use polling loops

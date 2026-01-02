# TOOLS KNOWLEDGE BASE

## OVERVIEW

Custom tools: 11 LSP tools, AST-aware search/replace, file ops with timeouts, background task management, session navigation.

## STRUCTURE

```
tools/
├── ast-grep/           # AST-aware code search/replace (25 languages)
│   ├── napi.ts         # @ast-grep/napi binding (preferred)
│   └── cli.ts          # @ast-grep/cli fallback
├── background-task/    # Async agent task management
├── call-omo-agent/     # Spawn explore/librarian agents
├── glob/               # File pattern matching (60s timeout)
├── grep/               # Content search (60s timeout)
├── interactive-bash/   # Tmux session management
├── look-at/            # Multimodal analysis (PDF, images)
├── lsp/                # 11 LSP tools (611 lines client.ts)
│   ├── client.ts       # LSP connection lifecycle
│   ├── config.ts       # Server configurations
│   └── tools.ts        # Tool implementations
├── session-manager/    # OpenCode session file ops
├── skill/              # Skill loading and execution
├── skill-mcp/          # Skill-embedded MCP invocation
├── slashcommand/       # Slash command execution
└── index.ts            # builtinTools export
```

## TOOL CATEGORIES

| Category | Tools |
|----------|-------|
| LSP | lsp_hover, lsp_goto_definition, lsp_find_references, lsp_document_symbols, lsp_workspace_symbols, lsp_diagnostics, lsp_servers, lsp_prepare_rename, lsp_rename, lsp_code_actions, lsp_code_action_resolve |
| AST | ast_grep_search, ast_grep_replace |
| File Search | grep, glob |
| Session | session_list, session_read, session_search, session_info |
| Background | background_task, background_output, background_cancel |
| Multimodal | look_at |
| Terminal | interactive_bash |
| Skills | skill, skill_mcp |
| Agents | call_omo_agent |

## HOW TO ADD

1. Create `src/tools/my-tool/`
2. Files: `constants.ts`, `types.ts`, `tools.ts`, `index.ts`
3. Add to `builtinTools` in `src/tools/index.ts`

## LSP SPECIFICS

- Lazy init on first use, auto-shutdown on idle
- Config priority: opencode.json > oh-my-opencode.json > defaults
- Servers: typescript-language-server, pylsp, gopls, rust-analyzer

## AST-GREP SPECIFICS

- Meta-variables: `$VAR` (single), `$$$` (multiple)
- Pattern must be valid AST node, not fragment
- Prefers napi binding for performance

## ANTI-PATTERNS

- No timeout on file ops (always use, default 60s)
- Sync file operations (use async/await)
- Ignoring LSP errors (graceful handling required)
- Raw subprocess for ast-grep (prefer napi)

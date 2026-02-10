# TOOLS KNOWLEDGE BASE

## OVERVIEW

24 tools across 14 directories. Two patterns: Direct ToolDefinition (static) and Factory Function (context-dependent).

## STRUCTURE
```
tools/
├── delegate-task/    # Category routing (constants.ts 569 lines, tools.ts 213 lines)
├── task/             # Unified CRUD: create/list/get/update/delete (task.ts 58 lines)
├── lsp/              # 6 LSP tools: goto_definition, find_references, symbols, diagnostics, prepare_rename, rename
├── ast-grep/         # 2 tools: search, replace (25 languages)
├── grep/             # Custom grep (60s timeout, 10MB limit)
├── glob/             # File search (60s timeout, 100 file limit)
├── session-manager/  # 4 tools: list, read, search, info (151 lines)
├── call-omo-agent/   # Direct agent invocation (57 lines)
├── background-task/  # background_output, background_cancel
├── interactive-bash/ # Tmux session management (135 lines)
├── look-at/          # Multimodal PDF/image analysis (156 lines)
├── skill/            # Skill execution with MCP support (211 lines)
├── skill-mcp/        # MCP tool/resource/prompt operations (182 lines)
└── slashcommand/     # Slash command dispatch
```

## TOOL INVENTORY

| Tool | Category | Pattern | Key Logic |
|------|----------|---------|-----------|
| `task` | Task | Factory | Unified 5-action dispatch (create/list/get/update/delete) |
| `call_omo_agent` | Agent | Factory | Direct explore/librarian invocation |
| `background_output` | Background | Factory | Retrieve background task result |
| `background_cancel` | Background | Factory | Cancel running background tasks |
| `lsp_goto_definition` | LSP | Direct | Jump to symbol definition |
| `lsp_find_references` | LSP | Direct | Find all usages across workspace |
| `lsp_symbols` | LSP | Direct | Document or workspace symbol search |
| `lsp_diagnostics` | LSP | Direct | Get errors/warnings from language server |
| `lsp_prepare_rename` | LSP | Direct | Validate rename is possible |
| `lsp_rename` | LSP | Direct | Rename symbol across workspace |
| `ast_grep_search` | Search | Factory | AST-aware code search (25 languages) |
| `ast_grep_replace` | Search | Factory | AST-aware code replacement |
| `grep` | Search | Factory | Regex content search with safety limits |
| `glob` | Search | Factory | File pattern matching |
| `session_list` | Session | Factory | List all sessions |
| `session_read` | Session | Factory | Read session messages |
| `session_search` | Session | Factory | Search across sessions |
| `session_info` | Session | Factory | Session metadata and stats |
| `interactive_bash` | System | Direct | Tmux session management |
| `look_at` | System | Factory | Multimodal PDF/image analysis |
| `skill` | Skill | Factory | Execute skill with MCP capabilities |
| `skill_mcp` | Skill | Factory | Call MCP tools/resources/prompts |
| `slashcommand` | Command | Factory | Slash command dispatch |

## DELEGATION SYSTEM (delegate-task)

8 built-in categories: `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, `writing`

Each category defines: model, variant, temperature, max tokens, thinking/reasoning config, prompt append, stability flag.

## HOW TO ADD

1. Create `src/tools/[name]/` with index.ts, tools.ts, types.ts, constants.ts
2. Static tools → `builtinTools` export, Factory → separate export
3. Register in `src/plugin/tool-registry.ts`

## NAMING

- **Tool names**: snake_case (`lsp_goto_definition`)
- **Functions**: camelCase (`createDelegateTask`)
- **Directories**: kebab-case (`delegate-task/`)

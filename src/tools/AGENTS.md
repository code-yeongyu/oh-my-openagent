# TOOLS KNOWLEDGE BASE

## OVERVIEW

26 tools across 14 directories. Two patterns: Direct ToolDefinition (static) and Factory Function (context-dependent).

## STRUCTURE
```
tools/
├── delegate-task/    # Category routing (constants.ts 569 lines, tools.ts 213 lines)
├── task/             # 4 tools: create, list, get, update (task-create.ts, task-list.ts, task-get.ts, task-update.ts)
├── lsp/              # 6 LSP tools: goto_definition, find_references, symbols, diagnostics, prepare_rename, rename
├── ast-grep/         # 2 tools: search, replace (25 languages)
├── grep/             # Content search (60s timeout, 10MB limit)
├── glob/             # File pattern matching (60s timeout, 100 file limit)
├── session-manager/  # 4 tools: list, read, search, info
├── call-omo-agent/   # Direct agent invocation (explore/librarian)
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
| `task_create` | Task | Factory | Auto-generated T-{uuid} ID, threadID recording, dependency management |
| `task_list` | Task | Factory | Active tasks with summary (excludes completed/deleted), filters unresolved blockers |
| `task_get` | Task | Factory | Full task object by ID |
| `task_update` | Task | Factory | Status/field updates, additive addBlocks/addBlockedBy for dependencies |
| `task` | Delegation | Factory | Category routing with skill injection, background execution |
| `call_omo_agent` | Agent | Factory | Direct explore/librarian invocation |
| `background_output` | Background | Factory | Retrieve background task result (block, timeout, full_session) |
| `background_cancel` | Background | Factory | Cancel running/all background tasks |
| `lsp_goto_definition` | LSP | Direct | Jump to symbol definition |
| `lsp_find_references` | LSP | Direct | Find all usages across workspace |
| `lsp_symbols` | LSP | Direct | Document or workspace symbol search |
| `lsp_diagnostics` | LSP | Direct | Get errors/warnings from language server |
| `lsp_prepare_rename` | LSP | Direct | Validate rename is possible |
| `lsp_rename` | LSP | Direct | Rename symbol across workspace |
| `ast_grep_search` | Search | Factory | AST-aware code search (25 languages) |
| `ast_grep_replace` | Search | Factory | AST-aware code replacement (dry-run default) |
| `grep` | Search | Factory | Regex content search with safety limits |
| `glob` | Search | Factory | File pattern matching |
| `session_list` | Session | Factory | List all sessions |
| `session_read` | Session | Factory | Read session messages with filters |
| `session_search` | Session | Factory | Search across sessions |
| `session_info` | Session | Factory | Session metadata and stats |
| `interactive_bash` | System | Direct | Tmux session management |
| `look_at` | System | Factory | Multimodal PDF/image analysis via dedicated agent |
| `skill` | Skill | Factory | Load skill instructions with MCP support |
| `skill_mcp` | Skill | Factory | Call MCP tools/resources/prompts from skill-embedded servers |
| `slashcommand` | Command | Factory | Slash command dispatch with argument substitution |

## DELEGATION SYSTEM (delegate-task)

8 built-in categories with domain-optimized models:

| Category | Model | Domain |
|----------|-------|--------|
| `visual-engineering` | gemini-3-pro | UI/UX, design, styling |
| `ultrabrain` | gpt-5.3-codex xhigh | Deep logic, architecture |
| `deep` | gpt-5.3-codex medium | Autonomous problem-solving |
| `artistry` | gemini-3-pro high | Creative, unconventional |
| `quick` | claude-haiku-4-5 | Trivial tasks |
| `unspecified-low` | claude-sonnet-4-5 | Moderate effort |
| `unspecified-high` | claude-opus-4-6 max | High effort |
| `writing` | kimi-k2p5 | Documentation, prose |

## HOW TO ADD

1. Create `src/tools/[name]/` with index.ts, tools.ts, types.ts, constants.ts
2. Static tools → `builtinTools` export, Factory → separate export
3. Register in `src/plugin/tool-registry.ts`

## NAMING

- **Tool names**: snake_case (`lsp_goto_definition`)
- **Functions**: camelCase (`createDelegateTask`)
- **Directories**: kebab-case (`delegate-task/`)

# TOOLS KNOWLEDGE BASE

## OVERVIEW
Core toolset implementing LSP, structural search, and system orchestration. Extends OpenCode with high-performance C++ bindings and multi-agent delegation.

## STRUCTURE
```
tools/
├── [tool-name]/
│   ├── index.ts      # Tool factory entry
│   ├── tools.ts      # Business logic & implementation
│   ├── types.ts      # Zod schemas & TS types
│   └── constants.ts  # Tool-specific fixed values
├── lsp/              # 11 tools via JSON-RPC client (596 lines client.ts)
├── ast-grep/         # Structural search (NAPI bindings)
├── delegate-task/    # Category-based agent routing (770 lines tools.ts)
├── session-manager/  # OpenCode session history (9 files)
└── interactive-bash/ # Tmux session management (5 files)
```

## TOOL CATEGORIES
| Category | Purpose | Key Implementations |
|----------|---------|---------------------|
| **LSP** | Semantic code intelligence | `lsp_goto_definition`, `lsp_find_references`, `lsp_rename` |
| **Search** | Fast discovery & matching | `glob`, `grep`, `ast_grep_search`, `ast_grep_replace` |
| **System** | CLI & Environment | `bash`, `interactive_bash` (tmux), `look_at` (vision) |
| **Session** | History & Context | `session_read`, `session_search`, `session_select` |
| **Agent** | Task Orchestration | `delegate_task`, `call_omo_agent` |

## HOW TO ADD
1. **Directory**: Create `src/tools/[name]/` with standard files.
2. **Factory**: Use `tool()` from `@opencode-ai/plugin/tool`.
3. **Parameters**: Define strict Zod schemas in `types.ts`.
4. **Registration**: Export from `src/tools/index.ts` and add to `builtinTools`.

## LSP SPECIFICS
- **Client**: `lsp/client.ts` manages stdio lifecycle and JSON-RPC.
- **Capabilities**: Supports definition, references, symbols, diagnostics, and workspace-wide rename.
- **Protocol**: Maps standard LSP methods to tool-compatible responses.

## AST-GREP SPECIFICS
- **Engine**: Uses `@ast-grep/napi` for 25+ language support.
- **Patterns**: Supports meta-variables (`$VAR`) and multi-node matching (`$$$`).
- **Performance**: Structural matching executed in Rust/C++ layer.

## ANTI-PATTERNS
- **Sequential Calls**: Don't call `bash` in loops; use `&&` or delegation.
- **Raw File Ops**: Never use `mkdir/touch` inside tool logic.
- **Heavy Sync**: Keep `PreToolUse` light; heavy computation belongs in `tools.ts`.
- **Sleep**: Never use `sleep N`; use polling loops or tool-specific wait flags.

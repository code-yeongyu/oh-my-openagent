# TOOLS KNOWLEDGE BASE

## OVERVIEW

20+ tools: LSP (6), AST-Grep (2), Search (2), Session (4), Agent delegation (4), System (2), Skill (3).

## STRUCTURE

```
tools/
├── [tool-name]/
│   ├── index.ts      # Barrel export
│   ├── tools.ts      # ToolDefinition or factory
│   ├── types.ts      # Zod schemas
│   └── constants.ts  # Fixed values
├── lsp/              # 6 tools: definition, references, symbols, diagnostics, rename (client.ts 596 lines)
├── ast-grep/         # 2 tools: search, replace (25 languages)
├── delegate-task/    # Category-based routing (1070 lines)
├── session-manager/  # 4 tools: list, read, search, info
├── grep/             # Custom grep with timeout (60s, 10MB)
├── glob/             # 60s timeout, 100 file limit
├── interactive-bash/ # Tmux session management
├── look-at/          # Multimodal PDF/image
├── skill/            # Skill execution
├── skill-mcp/        # Skill MCP operations
├── slashcommand/     # Slash command dispatch
├── call-omo-agent/   # Direct agent invocation
└── background-task/  # background_output, background_cancel
```

## TOOL CATEGORIES

| Category | Tools | Pattern |
|----------|-------|---------|
| LSP | lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_diagnostics, lsp_prepare_rename, lsp_rename | Direct |
| Search | ast_grep_search, ast_grep_replace, grep, glob | Direct |
| Session | session_list, session_read, session_search, session_info | Direct |
| Agent | delegate_task, call_omo_agent | Factory |
| Background | background_output, background_cancel | Factory |
| System | interactive_bash, look_at | Mixed |
| Skill | skill, skill_mcp, slashcommand | Factory |

## HOW TO ADD

1. Create `src/tools/[name]/` with standard files
2. Use `tool()` from `@opencode-ai/plugin/tool`
3. Export from `src/tools/index.ts`
4. Static tools → `builtinTools`, Factory → separate export

## TOOL PATTERNS

**Direct ToolDefinition**:
```typescript
export const grep: ToolDefinition = tool({
  description: "...",
  args: { pattern: tool.schema.string() },
  execute: async (args) => result,
})
```

**Factory Function** (context-dependent):
```typescript
export function createDelegateTask(ctx, manager): ToolDefinition {
  return tool({ execute: async (args) => { /* uses ctx */ } })
}
```

## NAMING

- **Tool names**: snake_case (`lsp_goto_definition`)
- **Functions**: camelCase (`createDelegateTask`)
- **Directories**: kebab-case (`delegate-task/`)

## ANTI-PATTERNS

- **Sequential bash**: Use `&&` or delegation
- **Raw file ops**: Never mkdir/touch in tool logic
- **Sleep**: Use polling loops

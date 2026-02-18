# src/tools/ — 26 Tools Across 14 Directories

**Generated:** 2026-02-17

## OVERVIEW

26 tools registered via `createToolRegistry()`. Two patterns: factory functions (`createXXXTool`) for 19 tools, direct `ToolDefinition` for 7 (LSP + interactive_bash).

## TOOL CATALOG

### Task Management (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `task_create` | `createTaskCreateTool` | subject, description, blockedBy, blocks, metadata, parentID |
| `task_list` | `createTaskList` | (none) |
| `task_get` | `createTaskGetTool` | id |
| `task_update` | `createTaskUpdateTool` | id, subject, description, status, addBlocks, addBlockedBy, owner, metadata |

### Delegation (1)

| Tool | Factory | Parameters |
|------|---------|------------|
| `task` | `createDelegateTask` | description, prompt, category, subagent_type, run_in_background, session_id, load_skills, command |

**8 Built-in Categories**: visual-engineering, ultrabrain, deep, artistry, quick, unspecified-low, unspecified-high, writing

### Agent Invocation (1)

| Tool | Factory | Parameters |
|------|---------|------------|
| `call_omo_agent` | `createCallOmoAgent` | description, prompt, subagent_type, run_in_background, session_id |

### Background Tasks (2)

| Tool | Factory | Parameters |
|------|---------|------------|
| `background_output` | `createBackgroundOutput` | task_id, block, timeout, full_session, include_thinking, message_limit |
| `background_cancel` | `createBackgroundCancel` | taskId, all |

### LSP Refactoring (6) — Direct ToolDefinition

| Tool | Parameters |
|------|------------|
| `lsp_goto_definition` | filePath, line, character |
| `lsp_find_references` | filePath, line, character, includeDeclaration |
| `lsp_symbols` | filePath, scope (document/workspace), query, limit |
| `lsp_diagnostics` | filePath, severity |
| `lsp_prepare_rename` | filePath, line, character |
| `lsp_rename` | filePath, line, character, newName |

### Code Search (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `ast_grep_search` | `createAstGrepTools` | pattern, lang, paths, globs, context |
| `ast_grep_replace` | `createAstGrepTools` | pattern, rewrite, lang, paths, globs, dryRun |
| `grep` | `createGrepTools` | pattern, path, include (60s timeout, 10MB limit) |
| `glob` | `createGlobTools` | pattern, path (60s timeout, 100 file limit) |

### Session History (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `session_list` | `createSessionManagerTools` | (none) |
| `session_read` | `createSessionManagerTools` | session_id, include_todos, limit |
| `session_search` | `createSessionManagerTools` | query, session_id, case_sensitive, limit |
| `session_info` | `createSessionManagerTools` | session_id |

### Skill/Command (3)

| Tool | Factory | Parameters |
|------|---------|------------|
| `skill` | `createSkillTool` | name |
| `skill_mcp` | `createSkillMcpTool` | mcp_name, tool_name/resource_name/prompt_name, arguments, grep |
| `slashcommand` | `createSlashcommandTool` | command, user_message |

### System (2)

| Tool | Factory | Parameters |
|------|---------|------------|
| `interactive_bash` | Direct | tmux_command |
| `look_at` | `createLookAt` | file_path, image_data, goal |

### Editing (1) — Conditional

| Tool | Factory | Parameters |
|------|---------|------------|
| `hashline_edit` | `createHashlineEditTool` | file, edits[] |

## DELEGATION CATEGORIES

| Category | Model | Domain |
|----------|-------|--------|
| visual-engineering | gemini-3-pro | Frontend, UI/UX |
| ultrabrain | gpt-5.3-codex xhigh | Hard logic |
| deep | gpt-5.3-codex medium | Autonomous problem-solving |
| artistry | gemini-3-pro high | Creative approaches |
| quick | claude-haiku-4-5 | Trivial tasks |
| unspecified-low | claude-sonnet-4-6 | Moderate effort |
| unspecified-high | claude-opus-4-6 max | High effort |
| writing | kimi-k2p5 | Documentation |

## HOW TO ADD A TOOL

1. Create `src/tools/{name}/index.ts` exporting factory
2. Create `src/tools/{name}/types.ts` for parameter schemas
3. Create `src/tools/{name}/tools.ts` for implementation
4. Register in `src/plugin/tool-registry.ts`

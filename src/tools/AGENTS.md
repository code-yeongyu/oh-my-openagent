# TOOLS KNOWLEDGE BASE

## OVERVIEW

24 tools across 14 directories. Two patterns: Direct ToolDefinition (static) and Factory Function (context-dependent).

## STRUCTURE
```
tools/
├── delegate-task/    # Category routing (constants.ts 569 lines, tools.ts 213 lines)
├── task/             # 4 individual tools: create, list, get, update (task-create.ts, task-list.ts, task-get.ts, task-update.ts)
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
| `task_create` | Task | Factory | Create task with auto-generated T-{uuid} ID, threadID recording |
| `task_list` | Task | Factory | List active tasks with summary (excludes completed/deleted) |
| `task_get` | Task | Factory | Retrieve full task object by ID |
| `task_update` | Task | Factory | Update task fields, supports addBlocks/addBlockedBy for dependencies |
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

## TASK TOOLS

Task management system with auto-generated T-{uuid} IDs, dependency tracking, and OpenCode Todo API sync.

### task_create

Create a new task with auto-generated ID and threadID recording.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `subject` | string | Yes | Task subject/title |
| `description` | string | No | Task description |
| `activeForm` | string | No | Active form (present continuous) |
| `metadata` | Record<string, unknown> | No | Task metadata |
| `blockedBy` | string[] | No | Task IDs that must complete before this task |
| `blocks` | string[] | No | Task IDs this task blocks |
| `repoURL` | string | No | Repository URL |
| `parentID` | string | No | Parent task ID |

**Example:**
```typescript
task_create({
  subject: "Implement user authentication",
  description: "Add JWT-based auth to API endpoints",
  blockedBy: ["T-abc123"] // Wait for database migration
})
```

**Returns:** `{ task: { id, subject } }`

### task_list

List all active tasks with summary information.

**Args:** None

**Returns:** Array of task summaries with id, subject, status, owner, blockedBy. Excludes completed and deleted tasks. The blockedBy field is filtered to only include unresolved (non-completed) blockers.

**Example:**
```typescript
task_list() // Returns all active tasks
```

**Response includes reminder:** "1 task = 1 task. Maximize parallel execution by running independent tasks (tasks with empty blockedBy) concurrently."

### task_get

Retrieve a full task object by ID.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | Yes | Task ID (format: T-{uuid}) |

**Example:**
```typescript
task_get({ id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694" })
```

**Returns:** `{ task: TaskObject | null }` with all fields: id, subject, description, status, activeForm, blocks, blockedBy, owner, metadata, repoURL, parentID, threadID.

### task_update

Update an existing task with new values. Supports additive updates for dependencies.

**Args:**
| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `id` | string | Yes | Task ID to update |
| `subject` | string | No | New subject |
| `description` | string | No | New description |
| `status` | "pending" \| "in_progress" \| "completed" \| "deleted" | No | Task status |
| `activeForm` | string | No | Active form (present continuous) |
| `owner` | string | No | Task owner (agent name) |
| `addBlocks` | string[] | No | Task IDs to add to blocks (additive) |
| `addBlockedBy` | string[] | No | Task IDs to add to blockedBy (additive) |
| `metadata` | Record<string, unknown> | No | Metadata to merge (set key to null to delete) |

**Example:**
```typescript
task_update({
  id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694",
  status: "completed"
})

// Add dependencies
task_update({
  id: "T-2a200c59-1a36-4dad-a9c3-3064d180f694",
  addBlockedBy: ["T-other-task"]
})
```

**Returns:** `{ task: TaskObject }` with full updated task.

**Dependency Management:** Use `addBlockedBy` to declare dependencies on other tasks. Properly managed dependencies enable maximum parallel execution.

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

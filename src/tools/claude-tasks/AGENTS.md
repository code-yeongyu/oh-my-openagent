# CLAUDE TASKS TOOLS KNOWLEDGE BASE

## OVERVIEW

Claude Code compatible task management tools. 4 separate tools (TaskCreate, TaskGet, TaskUpdate, TaskList) matching Claude Code's ENABLE_TASKS system 100%.

## STRUCTURE

```
claude-tasks/
├── task-create.ts       # Create new tasks
├── task-create.test.ts  # 7 tests
├── task-get.ts          # Retrieve task by ID
├── task-get.test.ts     # 4 tests
├── task-update.ts       # Update task with claim validation
├── task-update.test.ts  # 9 tests
├── task-list.ts         # List all tasks (summary view)
└── task-list.test.ts    # 6 tests
```

## TOOLS

### TaskCreate

**Factory**: `createTaskCreate(config, teamName)`

**Input**:
- `subject` (required): Imperative form ("Run tests")
- `description` (required): Detailed description
- `activeForm` (optional): Present continuous ("Running tests")
- `metadata` (optional): Arbitrary metadata object

**Output** (JSON string):
```json
{
  "task": {
    "id": "1",
    "subject": "Run tests"
  }
}
```

**Behavior**:
- Sequential ID generation (read existing, increment)
- Lock-based concurrency control
- All tasks created with `status: "pending"`

### TaskGet

**Factory**: `createTaskGet(config, teamName)`

**Input**:
- `taskId` (required): Task ID to retrieve

**Output** (JSON string):
```json
{
  "task": {
    "id": "1",
    "subject": "Run tests",
    "description": "Execute test suite",
    "status": "pending",
    "blocks": [],
    "blockedBy": [],
    "activeForm": "Running tests",
    "owner": "sisyphus",
    "metadata": { "priority": "high" }
  }
}
```

Returns `{ "task": null }` if not found.

### TaskUpdate

**Factory**: `createTaskUpdate(config, teamName)`

**Input**:
- `taskId` (required): Task ID to update
- `subject` (optional): New subject
- `description` (optional): New description
- `activeForm` (optional): New activeForm
- `status` (optional): New status (`pending`, `in_progress`, `completed`, `deleted`)
- `addBlocks` (optional): Task IDs to add to blocks array
- `addBlockedBy` (optional): Task IDs to add to blockedBy array
- `owner` (optional): Agent name to assign
- `metadata` (optional): Metadata to merge

**Output** (JSON string):
```json
{
  "success": true,
  "taskId": "1",
  "updatedFields": ["subject", "status"],
  "statusChange": {
    "from": "pending",
    "to": "in_progress"
  }
}
```

**Claim Validation** (5 failure modes):
1. `task_not_found`: Task doesn't exist
2. `already_resolved`: Task is `completed` or `deleted`
3. `blocked`: `blockedBy` contains incomplete tasks
4. `agent_busy`: Owner has another `in_progress` task
5. (implicit) Already claimed by different owner

### TaskList

**Factory**: `createTaskList(config, teamName)`

**Input**: None

**Output** (JSON string):
```json
{
  "tasks": [
    {
      "id": "1",
      "subject": "Run tests",
      "status": "pending",
      "owner": "sisyphus",
      "blockedBy": ["2"]
    }
  ]
}
```

**Behavior**:
- Summary view only (id, subject, status, owner?, blockedBy)
- Excludes `deleted` tasks
- Sorted by numeric ID

## USAGE

Tools are factory functions requiring config and teamName:

```typescript
import { createTaskCreate, createTaskGet, createTaskUpdate, createTaskList } from "./tools/claude-tasks"

const config = { sisyphus: { tasks: { storage_path: ".sisyphus/tasks" } } }
const teamName = "default-team"

const taskCreate = createTaskCreate(config, teamName)
const taskGet = createTaskGet(config, teamName)
const taskUpdate = createTaskUpdate(config, teamName)
const taskList = createTaskList(config, teamName)

// All tools return JSON strings
const resultStr = await taskCreate.execute({ subject: "Test", description: "Test task" }, context)
const result = JSON.parse(resultStr)
```

## STORAGE

- **Path**: `.sisyphus/tasks/{team-name}/{id}.json`
- **Schema**: See `src/features/claude-tasks/types.ts`
- **Concurrency**: File-based locks (30s stale threshold)

## TESTING

- **Total**: 26 tests, 56 assertions
- **Pattern**: TDD with BDD comments (`//#given`, `//#when`, `//#then`)
- **Coverage**: All CRUD operations, claim validation, edge cases

## ANTI-PATTERNS

- Direct file manipulation (use storage utilities)
- Skipping claim validation checks
- Ignoring return value error fields
- Modifying deleted tasks

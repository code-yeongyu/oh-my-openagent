# src/tools/delegate-task/ — Task Delegation Engine

**Generated:** 2026-02-18

## OVERVIEW

41 files. The `task` tool implementation — delegates work to subagents via background or sync sessions. Resolves categories, models, skills, and manages both async and synchronous execution flows.

## TWO EXECUTION MODES

| Mode | Flow | Use Case |
|------|------|----------|
| **Background** (`run_in_background=true`) | Launch → BackgroundManager → poll → notify parent | Explore, librarian, parallel work |
| **Sync** (`run_in_background=false`) | Create session → send prompt → poll until idle → return result | Sequential tasks needing immediate result |

## KEY FILES

| File | Purpose |
|------|---------|
| `tools.ts` | `createDelegateTask()` factory — main entry point |
| `executor.ts` | Route to background or sync execution |
| `types.ts` | `DelegateTaskArgs`, `DelegateTaskToolOptions`, `ToolContextWithMetadata` |
| `category-resolver.ts` | Map category name → model + config |
| `subagent-resolver.ts` | Map subagent_type → agent + model |
| `model-selection.ts` | Model availability checking + fallback |
| `skill-resolver.ts` | Resolve `load_skills[]` → skill content for injection |
| `prompt-builder.ts` | Build system/user prompt with skill content, categories |

## SYNC EXECUTION CHAIN

```
sync-task.ts → sync-session-creator.ts → sync-prompt-sender.ts → sync-session-poller.ts → sync-result-fetcher.ts
```

Each file handles one step. `sync-continuation.ts` handles session continuation (resume with session_id).

## BACKGROUND EXECUTION

```
background-task.ts → BackgroundManager.launch() → (async polling) → background-continuation.ts
```

`background-continuation.ts` handles `session_id` resume for existing background tasks.

## CATEGORY RESOLUTION

1. Check user-defined categories (`pluginConfig.categories`)
2. Fall back to built-in 8 categories
3. Resolve model from category config
4. Check model availability → fallback if unavailable

## MODEL STRING PARSER

`model-string-parser.ts` handles `"model variant"` format (e.g., `"gpt-5.3-codex medium"` → model=`gpt-5.3-codex`, variant=`medium`).

## UNSTABLE AGENT TRACKING

`unstable-agent-task.ts` marks tasks from categories/agents known to be unstable (e.g., free models). Enables `unstableAgentBabysitter` hook monitoring.

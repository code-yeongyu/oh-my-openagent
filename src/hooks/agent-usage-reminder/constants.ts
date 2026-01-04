import { join } from "node:path";
import { getOpenCodeStorageDir } from "../../shared/data-path";

export const OPENCODE_STORAGE = getOpenCodeStorageDir();
export const AGENT_USAGE_REMINDER_STORAGE = join(
  OPENCODE_STORAGE,
  "agent-usage-reminder",
);

// All tool names normalized to lowercase for case-insensitive matching
export const TARGET_TOOLS = new Set([
  "grep",
  "safe_grep",
  "glob",
  "safe_glob",
  "webfetch",
  "context7_resolve-library-id",
  "context7_get-library-docs",
  "websearch_exa_web_search_exa",
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
  "background_task",
]);

// Remind again after this many direct tool calls without using agents
export const DIRECT_TOOL_CALLS_BEFORE_REMINDER = 5;

export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use background_task with explore/librarian agents for better results:

\`\`\`
// Parallel exploration - fire multiple agents simultaneously
background_task(agent="explore", prompt="Find all files matching pattern X")
background_task(agent="explore", prompt="Search for implementation of Y") 
background_task(agent="librarian", prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
\`\`\`

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel background_task calls > Direct tool calls
`;

export const IMPLEMENTATION_PHASE_REMINDER = `
[Parallelism Reminder - Implementation Phase]

You're doing direct tool calls. Consider delegating to background agents:

\`\`\`typescript
// Instead of sequential work, PARALLELIZE:
background_task(agent="frontend-ui-ux-engineer", prompt="Build the UI...")
background_task(agent="document-writer", prompt="Write the docs...")
// Meanwhile YOU work on core logic
\`\`\`

**Ask before each task**: Can a specialist agent handle this while I work on something else?
`;

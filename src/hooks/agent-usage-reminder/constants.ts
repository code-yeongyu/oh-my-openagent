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
  "context7_query-docs",
  "websearch_web_search_exa",
  "context7_get-library-docs",
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "batch",
  "task",
  "call_omo_agent",
  "delegate_task",
]);

export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use native \`task\` (and \`batch\` for parallel) with explore/librarian agents for better results:

\`\`\`
// Parallel exploration (max 10 at a time). Blocks until ALL results return.
batch(tool_calls=[
  { tool: "task", parameters: { description: "Find pattern X", subagent_type: "explore", prompt: "Find all files matching pattern X" } },
  { tool: "task", parameters: { description: "Search impl Y", subagent_type: "explore", prompt: "Search for implementation of Y" } },
  { tool: "task", parameters: { description: "Lookup docs Z", subagent_type: "librarian", prompt: "Lookup documentation for Z" } }
])
\`\`\`

WHY:
- Agents can perform deeper, more thorough searches
- \`task\` creates a visible, enterable child session in the UI
- \`batch\` runs tasks in parallel and blocks until all complete (deterministic)
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: \`task\` / \`batch\` > Direct tool calls
`;

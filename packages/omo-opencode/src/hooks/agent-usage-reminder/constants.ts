import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
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
  "grep_app_searchgithub",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
]);

export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

\`\`\`
// Parallel read-only exploration - fire independent agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
\`\`\`

WHY:
- Agents can perform deeper, more thorough searches
- Independent read-only background tasks can run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

Prefer parallel task calls for independent read-only exploration.
For mutation-capable work, serialize write agents unless each agent has an isolated worktree/branch and clearly scoped ownership.
`;
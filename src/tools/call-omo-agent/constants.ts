export const ALLOWED_AGENTS = ["explore", "librarian"] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks autonomously.

This is a restricted version of the Task tool that only allows spawning explore and librarian agents.

Available agent types:
{agents}

When using this tool, you must specify a subagent_type parameter to select which agent type to use.

**IMPORTANT: run_in_background parameter is REQUIRED**
- \`run_in_background=true\`: Task runs asynchronously in background. Returns immediately with task_id.
  Use \`background_output\` tool with the returned task_id to check progress or retrieve results.
- \`run_in_background=false\`: Task runs synchronously. Waits for completion and returns full result.

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. When the agent is done, it will return a single message back to you
3. Each agent invocation is stateless unless you provide a session_id
4. Your prompt should contain a highly detailed task description for the agent to perform autonomously
5. Clearly tell the agent whether you expect it to write code or just to do research
6. For long-running research tasks, use run_in_background=true to avoid blocking`

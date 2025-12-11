export const ALLOWED_AGENTS = ["explore", "librarian"] as const

export const TASK_TOOL_DESCRIPTION_TEMPLATE = `Launch a new agent to handle complex, multi-step tasks autonomously.

This is a restricted version of the Task tool that only allows spawning explore and librarian agents.

Available agent types:
{agents}

When using this tool, you must specify a subagent_type parameter to select which agent type to use.

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. When the agent is done, it will return a single message back to you
3. Each agent invocation is stateless unless you provide a session_id
4. Your prompt should contain a highly detailed task description for the agent to perform autonomously
5. Clearly tell the agent whether you expect it to write code or just to do research`

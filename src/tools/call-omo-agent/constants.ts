export const ALLOWED_AGENTS = [
  "explore",
  "librarian",
] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn explore/librarian agent. run_in_background REQUIRED (true=async with task_id, false=sync).

Allowed agents:
{agents}

Other built-in agents, custom agents, and task categories are intentionally not supported by this tool.

Pass \`session_id=<id>\` to continue previous agent with full context. Nested subagent depth is tracked automatically and blocked past the configured limit. Prompts MUST be in English. Use \`background_output\` for async results.`

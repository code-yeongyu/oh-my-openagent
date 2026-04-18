export const ALLOWED_AGENTS = [
  "explore",
  "librarian",
  "oracle",
  "hephaestus",
  "metis",
  "momus",
  "multimodal-looker",
] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn explore/librarian agent or custom agents. run_in_background REQUIRED (true=async with task_id, false=sync).

Built-in agents:
{agents}

Custom agents registered via user or project agent directories are also supported.

Pass \`session_id=<id>\` to continue previous agent with full context. Nested subagent depth is tracked automatically and blocked past the configured limit. Prompts MUST be in English. Use \`background_output\` for async results.`

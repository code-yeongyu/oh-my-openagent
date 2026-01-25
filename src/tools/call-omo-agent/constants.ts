export const ALLOWED_AGENTS = ["explore", "librarian"] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn explore/librarian agent. run_in_background REQUIRED (true=async with task_id, false=sync).

Available: {agents}

Pass \`session_id=<id>\` to continue previous agent with full context. Prompts MUST be in English. Use \`background_output\` for async results.`

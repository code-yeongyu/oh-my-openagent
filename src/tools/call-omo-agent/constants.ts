import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

/**
 * Built-in agents derived from AGENT_MODEL_REQUIREMENTS.
 * Custom agents from user config are merged at runtime in createCallOmoAgent().
 */
export const BUILTIN_AGENTS = Object.keys(AGENT_MODEL_REQUIREMENTS)

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn explore/librarian agent. run_in_background REQUIRED (true=async with task_id, false=sync).

Available: {agents}

Pass \`session_id=<id>\` to continue previous agent with full context. Nested subagent depth is tracked automatically and blocked past the configured limit. Prompts MUST be in English. Use \`background_output\` for async results.`

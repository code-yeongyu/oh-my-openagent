export const ALLOWED_AGENTS = [
  "explore",
  "librarian",
  "oracle",
  "hephaestus",
  "metis",
  "momus",
  "multimodal-looker",
  "credit-planner",
  "credit-plan-reviewer",
  "credit-executor",
  "credit-tester",
  "credit-server",
] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Spawn specialized agent. run_in_background REQUIRED (true=async with task_id, false=sync).

Available: {agents}

Pass \`session_id=<id>\` to continue previous agent with full context. Prompts MUST be in English. Use \`background_output\` for async results.

Credit Agents (for Euler LSP):
- credit-planner: Creates detailed Change Plans for feature implementation
- credit-plan-reviewer: Reviews plans for architectural compliance
- credit-executor: Implements approved Change Plans
- credit-tester: Validates implementations against plans
- credit-server: Manages LSP server lifecycle and infrastructure`

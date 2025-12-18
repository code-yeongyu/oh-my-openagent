/**
 * Agents allowed for delegation via call_omo_agent tool.
 * 
 * LIF-62: Expanded to include manager and specialist agents for multi-layered orchestration.
 * 
 * Role-based restrictions are applied at runtime via getToolConfigForRole():
 * - team-lead (OmO): Can delegate to any agent
 * - manager (implementation-specialist): Can delegate to specialists only
 * - specialist/advisor/utility: Cannot delegate (task tool disabled)
 */
export const ALLOWED_AGENTS = [
  // Utility agents (read-only)
  "explore",
  "librarian",
  "multimodal-looker",
  // Specialist agents (can modify files) - existing
  "frontend-ui-ux-engineer",
  "document-writer",
  // LIF-62 Phase 4A: Manager agent (can delegate to specialists)
  "implementation-specialist",
  // LIF-62 Phase 4A: Initial specialists (cannot delegate further)
  "backend-typescript",
  "frontend-react",
  // LIF-62 Phase 4B: Language/Platform Specialists
  "backend-rust",
  "backend-python",
  "mobile-xcode",
  "mobile-react-native",
  // LIF-62 Phase 4B: AI/ML Specialists
  "ai-ml-expert",
  "agent-specialist",
  // LIF-62 Phase 4B: Cross-Cutting Specialists
  "security-specialist",
  "test-specialist",
  "optimization-specialist",
] as const

export const CALL_OMO_AGENT_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks autonomously.

This tool allows spawning specialized agents for different tasks. Role-based restrictions apply.

Available agent types:
{agents}

When using this tool, you must specify a subagent_type parameter to select which agent type to use.

**IMPORTANT: run_in_background parameter is REQUIRED**
- \`run_in_background=true\`: Task runs asynchronously in background. Returns immediately with task_id.
  The system will notify you when the task completes.
  Use \`background_output\` tool with task_id to check progress (block=false returns full status info).
- \`run_in_background=false\`: Task runs synchronously. Waits for completion and returns full result.

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. When the agent is done, it will return a single message back to you
3. Each agent invocation is stateless unless you provide a session_id
4. Your prompt should contain a highly detailed task description for the agent to perform autonomously
5. Clearly tell the agent whether you expect it to write code or just to do research
6. For long-running research tasks, use run_in_background=true to avoid blocking
7. **IMPORTANT**: Always write prompts in English regardless of user's language. LLMs perform significantly better with English prompts.`

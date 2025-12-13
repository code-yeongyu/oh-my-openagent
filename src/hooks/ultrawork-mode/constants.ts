/** Keyword patterns - "ultrawork", "ulw" (case-insensitive, word boundary) */
export const ULTRAWORK_PATTERNS = [/\bultrawork\b/i, /\bulw\b/i]

/** Code block pattern to exclude from keyword detection */
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g

/** Inline code pattern to exclude */
export const INLINE_CODE_PATTERN = /`[^`]+`/g

/**
 * ULTRAWORK_CONTEXT - Agent-Agnostic Guidance
 *
 * Key principles:
 * - NO specific agent names (oracle, librarian, etc.)
 * - Only provide guidance based on agent role/capability
 * - Emphasize parallel execution, TODO tracking, delegation
 */
export const ULTRAWORK_CONTEXT = `<ultrawork-mode>
[CODE RED] Maximum precision required. Ultrathink before acting.

YOU MUST LEVERAGE ALL AVAILABLE AGENTS TO THEIR FULLEST POTENTIAL.
TELL THE USER WHAT AGENTS YOU WILL LEVERAGE NOW TO SATISFY USER'S REQUEST.

## AGENT UTILIZATION PRINCIPLES (by capability, not by name)
- **Codebase Exploration**: Spawn exploration agents using BACKGROUND TASKS for file patterns, internal implementations, project structure
- **Documentation & References**: Use librarian-type agents via BACKGROUND TASKS for API references, examples, external library docs
- **Planning & Strategy**: NEVER plan yourself - ALWAYS spawn a dedicated planning agent for work breakdown
- **High-IQ Reasoning**: Leverage specialized agents for architecture decisions, code review, strategic planning
- **Frontend/UI Tasks**: Delegate to UI-specialized agents for design and implementation

## EXECUTION RULES
- **TODO**: Track EVERY step. Mark complete IMMEDIATELY after each.
- **PARALLEL**: Fire independent agent calls simultaneously via background_task - NEVER wait sequentially.
- **BACKGROUND FIRST**: Use background_task for exploration/research agents (10+ concurrent if needed).
- **VERIFY**: Re-read request after completion. Check ALL requirements met before reporting done.
- **DELEGATE**: Don't do everything yourself - orchestrate specialized agents for their strengths.

## WORKFLOW
1. Analyze the request and identify required capabilities
2. Spawn exploration/librarian agents via background_task in PARALLEL (10+ if needed)
3. Use planning agents to create detailed work breakdown
4. Execute with continuous verification against original requirements

</ultrawork-mode>

---

`

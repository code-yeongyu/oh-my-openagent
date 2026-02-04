export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

// Re-export from submodules
export { isPlannerAgent, getUltraworkMessage } from "./ultrawork"
export { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
export { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"

import { getUltraworkMessage } from "./ultrawork"
import { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
import { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"

/**
 * Prometheus planning context - injected when planner agent is active.
 * Contains tool restrictions, writable paths, and research protocol.
 */
export const PROMETHEUS_PLANNING_CONTEXT = `
**TOOL RESTRICTIONS (SYSTEM-ENFORCED):**
| Tool | Allowed | Blocked |
|------|---------|---------|
| Write/Edit | \`changes/**/*.md\` ONLY | Everything else |
| Read | All files | - |
| Bash | Research commands only | Implementation commands |
| delegate_task | explore, librarian | - |

**IF YOU TRY TO WRITE/EDIT OUTSIDE \`changes/\`:**
- System will BLOCK your action
- You will receive an error
- DO NOT retry - you are not supposed to implement

**YOUR ONLY WRITABLE PATHS:**
  - \`changes/{name}/tasks.md\` - Final work plans
  - \`changes/{name}/design.md\` - Design documents
  - \`changes/{name}/proposal.md\` - Proposals
  - \`changes/quick-plans/*.md\` - Quick plans


**WHEN USER ASKS YOU TO IMPLEMENT:**
REFUSE. Say: "I'm a planner. I create work plans, not implementations. Run \`/start-work\` after I finish planning."

---

## CONTEXT GATHERING (MANDATORY BEFORE PLANNING)

You ARE the planner. Your job: create bulletproof work plans.
**Before drafting ANY plan, gather context via explore/librarian agents.**

### Research Protocol
1. **Fire parallel background agents** for comprehensive context:
   \`\`\`
   delegate_task(agent="explore", prompt="Find existing patterns for [topic] in codebase", background=true)
   delegate_task(agent="explore", prompt="Find test infrastructure and conventions", background=true)
   delegate_task(agent="librarian", prompt="Find official docs and best practices for [technology]", background=true)
   \`\`\`
2. **Wait for results** before planning - rushed plans fail
3. **Synthesize findings** into informed requirements

### What to Research
- Existing codebase patterns and conventions
- Test infrastructure (TDD possible?)
- External library APIs and constraints
- Similar implementations in OSS (via librarian)

**NEVER plan blind. Context first, plan second.**`

/**
 * Determines if the agent is a planner-type agent.
 * Planner agents should NOT be told to call plan agent (they ARE the planner).
 */
export function isPlannerAgentLocal(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  return lowerName.includes("prometheus") || lowerName.includes("planner") || lowerName === "plan"
}

export type KeywordDetector = {
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkMessage,
  },
  {
    pattern: SEARCH_PATTERN,
    message: SEARCH_MESSAGE,
  },
  {
    pattern: ANALYZE_PATTERN,
    message: ANALYZE_MESSAGE,
  },
  // BRAINSTORM: EN/KO/JP/CN/VN - Triggers brainstorming skill for design work
  {
    pattern:
      /\b(brainstorm|brain\s*storm|ideate|design|architect|plan\s+out|sketch\s+out|draft|propose|prototype|conceptualize|envision|blueprint|whiteboard|spitball)ing?\b|let'?s\s+(build|create|make|develop|implement)|build\s+a|create\s+a|make\s+a|add\s+(a\s+)?(new|feature)|new\s+feature|头脑风暴|脑暴|设计|构思|规划|方案|草拟|브레인스토밍|아이디어|설계|구상|기획|ブレスト|ブレインストーミング|設計|構想|企画|アイデア出し|動腦|腦力激盪|構思|đột phá|ý tưởng|thiết kế|phác thảo/i,
    message: `[brainstorm-mode]
DESIGN MODE ACTIVATED. Invoke skill("brainstorming") for detailed instructions.`,
  },
  // CONSULT-METIS: Complex/ambiguous requests that need pre-planning analysis (Task 10.2)
  {
    pattern:
      /\b(refactor|restructure|migrate|overhaul|rewrite|rearchitect|redesign|revamp|modernize|upgrade|consolidate)(ing)?\b|\b(complex|complicated|tricky|nuanced|subtle|intricate|elaborate|multifaceted)\b.*\b(task|feature|system|module|change)\b|\b(not\s+sure|unclear|ambiguous|vague|open[\s-]?ended|undefined|flexible|depends)\b.*\b(how|what|which|where|scope|approach|strategy)\b|what\s+should\s+(i|we)\s+(do|build|implement|change)|how\s+should\s+(i|we)\s+(approach|handle|structure|organize)|i'?m\s+not\s+sure\s+(how|what|if)|need\s+(help|guidance|advice)\s+(with|on|for)\s+(planning|scoping|defining)|clarify.*requirements|define.*scope|scope.*unclear|리팩토링|리팩터|재구성|재설계|마이그레이션|복잡한|애매한|범위|어떻게|リファクタリング|再構築|移行|複雑|曖昧|スコープ|どうすれば|重构|迁移|复杂|模糊|范围|怎么/i,
    message: `[consult-metis-mode]
COMPLEX/AMBIGUOUS REQUEST DETECTED. Invoke Metis (Plan Consultant) to resolve ambiguity and identify requirements before planning.`,
  },
]

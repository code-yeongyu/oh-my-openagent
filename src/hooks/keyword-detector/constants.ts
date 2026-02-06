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
  // BRAINSTORM: Exploration/ideation phase - thinking about possibilities
  // Triggers skill("brainstorming") for requirements exploration
  {
    pattern:
      /\b(brainstorm|brain\s*storm|ideate|think\s+about|explore|discuss|consider|ponder|mull\s+over|想|思考|探讨|构思|想法|아이디어|생각|ブレスト|ブレインストーミング|考える|アイデア出し|動腦|腦力激盪)\b|let'?s\s+think|what\s+if|how\s+about|what\s+about|怎么样|어떨까|どうかな/i,
    message: `[brainstorm-mode]
EXPLORATION MODE ACTIVATED.

**Skill:** \`skill("brainstorming")\`
**Purpose:** Explore user intent, requirements and design approaches through collaborative dialogue.

**When to use:**
- User wants to discuss possibilities before committing
- Unclear requirements need clarification
- Multiple approaches should be evaluated

**Workflow:** brainstorming → creating-changes → implementation

Consider invoking \`skill("brainstorming")\` to explore requirements first.`,
  },
  // PLAN/DESIGN: Planning phase - ready to write specs
  // Triggers skill("creating-changes") for design.md and tasks.md
  {
    pattern:
      /\b(plan|design|architect|spec|requirement|blueprint|roadmap|规划|设计|方案|架构|仕様|計画|設計|기획|설계)\b|write\s+a\s+plan|create\s+a\s+design|make\s+a\s+plan|写(个|一个)?计划|做(个|一个)?方案/i,
    message: `[plan-mode]
PLANNING MODE ACTIVATED.

**Skill:** \`skill("creating-changes")\`
**Purpose:** Write design.md and tasks.md with structured task breakdown.

**When to use:**
- Requirements are clear and ready to be documented
- Need to create implementation plan with phases
- Moving from exploration to execution

Consider invoking \`skill("creating-changes")\` to write the design document.`,
  },
  // BUILD/CREATE: Implementation requests - need brainstorming first
  // Suggests brainstorming before jumping to implementation
  {
    pattern:
      /let'?s\s+(build|create|make|develop|implement)|build\s+a|create\s+a|make\s+a|add\s+(a\s+)?(new|feature)|new\s+feature|实现|开发|做一个|만들|作る|開発/i,
    message: `[brainstorm-mode]
IMPLEMENTATION REQUEST DETECTED.

Before implementing, consider exploring requirements first.

**Recommended workflow:**
1. \`skill("brainstorming")\` - Clarify intent and explore approaches
2. \`skill("creating-changes")\` - Write design and task breakdown
3. Implementation

Consider invoking \`skill("brainstorming")\` to ensure requirements are clear.`,
  },
  // DEBUG/FIX: Bug fixing and debugging - requires systematic approach
  // Triggers skill("systematic-debugging") for root cause analysis
  {
    pattern:
      /\b(debug|debugging|fix|fixing|bug|bugs|bugfix|error|errors|issue|issues|problem|problems|broken|crash|crashes|failing|failure|not\s+working|doesn't\s+work|won't\s+work|调试|修复|bug|错误|问题|崩溃|不工作|디버그|버그|수정|오류|문제|デバッグ|バグ|修正|エラー|問題|動かない)\b/i,
    message: `[debug-mode]
BUG/ERROR DETECTED.

**Skill:** \`skill("systematic-debugging")\`
**Purpose:** Find root cause BEFORE attempting fixes. Symptom fixes are failure.

**The Iron Law:** NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

**Phase 1 (MANDATORY before any fix):**
1. Read error messages carefully - they often contain the solution
2. Reproduce consistently - can you trigger it reliably?
3. Check recent changes - git diff, new dependencies, config
4. Gather evidence at component boundaries

**When to use:**
- Test failures, bugs, unexpected behavior
- Performance problems, build failures
- "Just one quick fix" seems obvious (that's when you need this most)

Consider invoking \`skill("systematic-debugging")\` for structured root cause analysis.`,
  },
  // CONSULT-METIS: Complex/ambiguous requests that need pre-planning analysis (Task 10.2)
  {
    pattern:
      /\b(refactor|restructure|migrate|overhaul|rewrite|rearchitect|redesign|revamp|modernize|upgrade|consolidate)(ing)?\b|\b(complex|complicated|tricky|nuanced|subtle|intricate|elaborate|multifaceted)\b.*\b(task|feature|system|module|change)\b|\b(not\s+sure|unclear|ambiguous|vague|open[\s-]?ended|undefined|flexible|depends)\b.*\b(how|what|which|where|scope|approach|strategy)\b|what\s+should\s+(i|we)\s+(do|build|implement|change)|how\s+should\s+(i|we)\s+(approach|handle|structure|organize)|i'?m\s+not\s+sure\s+(how|what|if)|need\s+(help|guidance|advice)\s+(with|on|for)\s+(planning|scoping|defining)|clarify.*requirements|define.*scope|scope.*unclear|리팩토링|리팩터|재구성|재설계|마이그레이션|복잡한|애매한|범위|어떻게|リファクタリング|再構築|移行|複雑|曖昧|スコープ|どうすれば|重构|迁移|复杂|模糊|范围|怎么/i,
    message: `[consult-metis-mode]
COMPLEX/AMBIGUOUS REQUEST DETECTED. Invoke Metis (Plan Consultant) to resolve ambiguity and identify requirements before planning.`,
  },
]

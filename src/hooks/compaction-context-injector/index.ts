import { injectHookMessage } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { AntiPatternTracker } from "../../shared/anti-pattern-tracker"
import { join } from "node:path"
import { markCompaction, isCompactionInProgress, markCompactionInProgress, clearCompactionInProgress } from "../compaction-state"

export interface SummarizeContext {
  sessionID: string
  providerID: string
  modelID: string
  usageRatio: number
  directory: string
}

const SUMMARIZE_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Key code snippets, function signatures, or data structures under active development
- **External References**: Documentation URLs, library APIs, or external resources being consulted
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that failed and should not be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session

## 7. Todo List Preservation (CRITICAL)
**DO NOT modify the todo list during compaction.**
- Preserve ALL existing todo items exactly as they are
- Do NOT consolidate multiple todos into a single generic item
- Do NOT rewrite todo descriptions
- Do NOT change todo statuses (pending/in_progress/completed)
- The todo list is managed by external hooks - your job is ONLY to summarize the conversation

## 8. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

This section is CRITICAL for reviewer agents (momus, oracle) to maintain continuity.

This context is critical for maintaining continuity after compaction.
`

function buildFailedPatternsSection(directory: string): string {
  const storagePath = join(directory, ".opencode", "anti-patterns.json")
  const tracker = new AntiPatternTracker(storagePath)
  const patterns = tracker
    .getFailedPatterns()
    .sort((a, b) => b.count - a.count || b.timestamp - a.timestamp)
    .slice(0, 5)

  if (patterns.length === 0) {
    return "\n## 9. Known Failed Patterns\n- None recorded in anti-pattern tracker."
  }

  const lines = patterns.map((pattern) => {
    return `- ${pattern.pattern}: ${pattern.reason} (count: ${pattern.count})`
  })

  return `\n## 9. Known Failed Patterns\n${lines.join("\n")}`
}

export function createCompactionContextInjector() {
  return async (ctx: SummarizeContext): Promise<void> => {
    log("[compaction-context-injector] injecting context", { sessionID: ctx.sessionID })

    // Check shared compaction guard (bidirectional prevention with Anthropic recovery)
    if (isCompactionInProgress(ctx.sessionID)) {
      log("[compaction-context-injector] skipped: shared compaction already in progress", { sessionID: ctx.sessionID })
      return
    }

    // Mark shared compaction in progress before starting
    markCompactionInProgress(ctx.sessionID)

    try {
      // Mark compaction time for cooldown tracking
      markCompaction(ctx.sessionID)
      log("[compaction-context-injector] marked compaction for cooldown", { sessionID: ctx.sessionID })

      const promptWithFailedPatterns = `${SUMMARIZE_CONTEXT_PROMPT}${buildFailedPatternsSection(ctx.directory)}`

      const success = injectHookMessage(ctx.sessionID, promptWithFailedPatterns, {
        agent: "general",
        model: { providerID: ctx.providerID, modelID: ctx.modelID },
        path: { cwd: ctx.directory },
      })

      if (success) {
        log("[compaction-context-injector] context injected", { sessionID: ctx.sessionID })
      } else {
        log("[compaction-context-injector] injection failed", { sessionID: ctx.sessionID })
      }
    } finally {
      // Clear shared compaction flag when done
      clearCompactionInProgress(ctx.sessionID)
    }
  }
}

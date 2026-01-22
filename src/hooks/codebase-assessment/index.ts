import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { HOOK_NAME } from "./constants"
import { collectProjectConfig } from "./collector"

export * from "./constants"
export * from "./collector"

// Cache assessment results per directory to avoid repeated file system checks
const assessmentCache = new Map<string, { result: string; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Creates the Codebase Assessment hook.
 *
 * This hook collects project configuration information at session start
 * and injects the assessment result into the context, enabling the agent
 * to adapt its behavior based on the codebase state (disciplined, transitional,
 * legacy, or greenfield).
 */
export function createCodebaseAssessmentHook(ctx: PluginInput) {
  const injectedSessions = new Set<string>()

  return {
    "tool.execute.before": async (
      input: {
        sessionID: string
        tool: string
        args?: Record<string, unknown>
      },
      output: {
        parts?: Array<{ type: string; text?: string }>
        args?: Record<string, unknown>
      }
    ): Promise<void> => {
      const { sessionID, tool } = input

      // Only inject once per session, on first substantive tool use
      if (injectedSessions.has(sessionID)) {
        return
      }

      // Skip for tools that don't indicate real work starting
      const substantiveTools = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
      if (!substantiveTools.includes(tool)) {
        return
      }

      injectedSessions.add(sessionID)

      // Check cache
      const cached = assessmentCache.get(ctx.directory)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        log(`[${HOOK_NAME}] Using cached assessment`, { sessionID })
        output.parts?.push({ type: "text", text: cached.result })
        return
      }

      // Collect fresh assessment
      try {
        const assessment = collectProjectConfig(ctx.directory)
        
        const assessmentText = `📊 **Codebase Assessment (PHASE 1)**

| Property | Value |
|----------|-------|
| **State** | ${assessment.state} |
| **Has Linter** | ${assessment.hasLinter ? "✅" : "❌"} |
| **Has Formatter** | ${assessment.hasFormatter ? "✅" : "❌"} |
| **Has TypeScript** | ${assessment.hasTypeScript ? "✅" : "❌"} |
| **Has Tests** | ${assessment.hasTests ? "✅" : "❌"} |
| **Package Manager** | ${assessment.packageManager} |

**Recommendation**: ${assessment.recommendation}

**Config files found**: ${assessment.configFilesFound.join(", ") || "None"}`

        assessmentCache.set(ctx.directory, {
          result: assessmentText,
          timestamp: Date.now(),
        })

        log(`[${HOOK_NAME}] Assessment completed`, { 
          sessionID, 
          state: assessment.state,
          configCount: assessment.configFilesFound.length,
        })
        
        output.parts?.push({ type: "text", text: assessmentText })
      } catch (err) {
        log(`[${HOOK_NAME}] Assessment failed`, { sessionID, error: String(err) })
      }
    },
  }
}

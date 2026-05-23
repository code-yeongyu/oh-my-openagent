import { log } from "../../shared/logger"
import { detectDeviations, formatDeviations } from "./deviation-detector"
import { evaluateDeviations } from "./decision-engine"
import { recordDecision, type ModeratorRecord } from "./store"

export type ModeratorGateHook = ReturnType<typeof createModeratorGateHook>

function getProjectDir(): string | undefined {
  try {
    // Try to infer project dir from known workspace conventions
    const possibleDirs = [
      process.env.OMO_WORKSPACE_ROOT,
      process.env.PROJECT_ROOT,
      process.env.INIT_CWD,
      process.cwd(),
    ]
    for (const dir of possibleDirs) {
      if (dir && dir.length > 0) return dir
    }
  } catch {
    // Fallback to undefined
  }
  return undefined
}

export function createModeratorGateHook() {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> => {
      const toolName = input.tool.toLowerCase()
      const callId = input.callID

      const outputLength = output.output?.length ?? 0
      const metadataKeys = output.metadata ? Object.keys(output.metadata) : []

      // Phase 1: Always log
      log(`[moderator-gate] Tool executed: ${input.tool}`, {
        sessionID: input.sessionID,
        callID: callId,
        outputLength,
        metadataKeys: metadataKeys.length > 0 ? metadataKeys : undefined,
      })

      // Notable events logging
      if (toolName === "write" || toolName === "edit") {
        const filePath =
          (output.metadata?.filePath as string) ??
          (output.metadata?.file_path as string) ??
          "unknown"
        log(`[moderator-gate] File modification: ${filePath}`, {
          sessionID: input.sessionID,
          callID: callId,
          filePath,
        })
      }

      if (toolName === "bash") {
        const commandPreview =
          typeof output.metadata?.command === "string"
            ? output.metadata.command.slice(0, 120)
            : undefined
        log(`[moderator-gate] Command executed: ${commandPreview ?? "unknown"}`, {
          sessionID: input.sessionID,
          callID: callId,
        })
      }

      if (toolName === "task" || toolName === "delegate_task") {
        const agentType = (output.metadata?.agent as string) ?? "unknown"
        log(`[moderator-gate] Task delegation: ${agentType}`, {
          sessionID: input.sessionID,
          callID: callId,
          agentType,
        })
      }

      if (outputLength > 50000) {
        log(`[moderator-gate] Large output warning: ${outputLength} bytes`, {
          sessionID: input.sessionID,
          callID: callId,
          outputLength,
        })
      }

      // Phase 2: Deviation detection
      const deviations = detectDeviations(
        {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: callId,
          output: output.output ?? "",
          metadata: output.metadata ?? {},
        },
        getProjectDir(),
      )

      // Phase 3: Decision engine
      if (deviations.length > 0) {
        const decision = evaluateDeviations(deviations)
        log(`[moderator-gate] ${decision.message}`, {
          sessionID: input.sessionID,
          callID: callId,
          deviationCount: deviations.length,
          action: decision.action,
        })

        // Inject warning into output for user visibility
        if (decision.injectedWarning) {
          const header = [
            "",
            "---",
            `[Moderator Gate] ${deviations.length} deviation(s) detected`,
            `Worst severity: ${decision.action === 'warn' ? 'grave' : 'leve'}`, // from decision
            "---",
            "",
          ].join("\n")

          // Prepend warning to output
          output.output = output.output
            ? `${header}${decision.injectedWarning}\n${output.output}`
            : `${header}${decision.injectedWarning}`
          output.title = `⚠️ ${input.tool} (Moderator: ${deviations.length} deviation(s))`
        }

        // Phase 4: Record decision
        const record: ModeratorRecord = {
          timestamp: new Date().toISOString(),
          tool: input.tool,
          callID: callId,
          sessionID: input.sessionID,
          deviationCount: deviations.length,
          severity: deviations.some((d) => d.severity === 'grave') ? 'grave'
            : deviations.some((d) => d.severity === 'media') ? 'media' : 'leve',
          action: decision.action,
          categories: [...new Set(deviations.map((d) => d.category))],
        }
        await recordDecision(record)
      }
    },
  }
}

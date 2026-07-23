import { log } from "../../shared/logger"

const V4_VERIFICATION_REMINDER =
  "\n\n--- V4 VERIFICATION REQUIRED ---\nDeepSeek V4 has a 94% hallucination rate. Inspect touched files and rerun checks before accepting these results."

const DELEGATION_TOOLS = new Set(["task", "call_omo_agent"])

function isV4Model(modelID: string): boolean {
  const lower = modelID.toLowerCase()
  return lower.includes("deepseek-v4") || lower.includes("deepseek_v4")
}

type SessionModelCache = Map<string, string>

export function createV4VerificationGateHook() {
  const sessionModels: SessionModelCache = new Map()

  return {
    event: (input: {
      event: {
        type: string
        properties: {
          info?: {
            sessionID?: string
            modelID?: string
            role?: string
          }
        }
      }
    }): void => {
      if (input.event.type !== "message.updated") return
      const info = input.event.properties?.info
      if (!info?.modelID || !info?.sessionID) return
      sessionModels.set(info.sessionID, info.modelID)
    },

    "tool.execute.after": (
      input: { tool: string; sessionID: string; callID: string },
      output?: { title?: string; output?: string; metadata?: unknown },
    ): void => {
      if (!DELEGATION_TOOLS.has(input.tool)) return
      const modelID = sessionModels.get(input.sessionID)
      if (!modelID || !isV4Model(modelID)) return
      if (!output) return

      output.output = (output.output ?? "") + V4_VERIFICATION_REMINDER
      log("[v4-verification-gate] Appended verification reminder", {
        sessionID: input.sessionID,
        tool: input.tool,
        modelID,
      })
    },
  }
}
